/**
 * Debug logger — observability completa do pipeline LLM (motor#19, sts#10).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-24-debug-mode.md
 *
 * Escrito no shared/ porque ambos lados (motor + sts) precisam usar.
 * Thread-safe via fsync síncrono em cada write (debug mode não é hot path).
 */

import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { calculateCostUsd } from "./llm-config.js";
import type { LlmProvider } from "./llm-router.js";

export const DEBUG_MODE_SCHEMA_VERSION = "1.1"; // 1.1 — Sprint 0 PR3: adiciona scope_id (motor#75)

/** Flag de ativação via env. Qualquer valor truthy liga. */
export function isDebugModeEnabled(): boolean {
  const v = process.env["ASC_DEBUG_MODE"];
  return v === "true" || v === "1";
}

/** Dir base dos logs. Default = process.cwd()/logs/debug. */
export function getDebugDir(): string {
  return process.env["ASC_DEBUG_DIR"] ?? join(process.cwd(), "logs", "debug");
}

/** Run ID — STS scenario-runner seta, outros processos herdam. */
export function getDebugRunId(): string | null {
  return process.env["ASC_DEBUG_RUN_ID"] ?? null;
}

/** Seta run ID (usado pelo scenario-runner na inicialização).
 *
 * Sprint 0 PR3 (motor#75): também regenera o scope_id, garantindo que cada
 * "novo run" tenha contadores frescos. Crítico para ops#398 F1-G5 (correlação
 * cross-process). */
export function setDebugRunId(runId: string): void {
  process.env["ASC_DEBUG_RUN_ID"] = runId;
  _currentScopeId = null; // força regeneração no próximo getDebugScopeId
}

/** Sprint 0 PR3 — scope_id state.
 *
 * scope_id identifica unicamente um "contador de seq" dentro do NDJSON.
 * Em single-process: 1 scope = 1 run. Em multi-process (Ryo + Kei em paralelo):
 * cada processo tem seu próprio scope_id, mesmo run_id, e seq pode repetir
 * entre scopes mas é monotônico dentro de cada scope.
 *
 * Resolução:
 * 1. ASC_DEBUG_SCOPE_ID env var (override explícito — útil para tests + multi-process)
 * 2. Cached value (gerado lazily na primeira chamada)
 * 3. Auto-gen: `${runId}-${randomUUID().slice(0,8)}`
 */
let _currentScopeId: string | null = null;

export function getDebugScopeId(): string {
  const envOverride = process.env["ASC_DEBUG_SCOPE_ID"];
  if (envOverride) return envOverride;
  if (_currentScopeId != null) return _currentScopeId;
  const runId = getDebugRunId() ?? "no-run";
  _currentScopeId = `${runId}-${randomUUID().slice(0, 8)}`;
  return _currentScopeId;
}

export interface DebugEventInput {
  side: "sts" | "motor";
  step: string; // "planejador" | "drota" | "haiku-triage" | "persona-sim" | "haiku-bullying" | "execute_playbook" | ...
  user_id: string;
  partner_user_id?: string | null;
  user_kind?: string | null;
  motor_target?: string; // "kids" | "eprumo" | ...
  session_id?: string | null;
  scenario_day?: number | null;
  turn_number?: number | null;
  /** Sprint 0 PR3 (motor#75): override per-event do scope_id. Útil quando
   * caller emite events de "outro contexto" (ex: simulando 2 personas). Se
   * omitido, usa scope_id global do processo (getDebugScopeId). */
  scope_id?: string;
  model?: string | null;
  provider?: string | null;
  tokens?: { in?: number; out?: number; reasoning?: number } | null;
  latency_ms?: number | null;
  cost_usd_est?: number | null;
  prompt?: string | null;
  response?: string | null;
  reasoning?: string | null;
  snapshots_pre?: Record<string, unknown> | null;
  snapshots_post?: Record<string, unknown> | null;
  /**
   * Granularidade de outcome (D-4-TELO, ops#1056):
   *  - "ok"       — sucesso na primeira tentativa
   *  - "ok-retry" — sucesso após retry (ex: schema invalid no primeiro output, recuperado)
   *  - "degraded" — sucesso parcial (ex: ISA labels stripped, dados secundários perdidos)
   *  - "error"    — falha hard (null retornado, exception)
   *  - "skip"     — step ignorado (config/feature flag)
   *
   * Legado ("ok" | "error" | "skip") continua válido — só amplia o enum.
   */
  outcome: "ok" | "ok-retry" | "degraded" | "error" | "skip";
  error_class?: string | null;
}

export interface DebugEventLine {
  run_id: string;
  /** Sprint 0 PR3 (motor#75): scope_id pareia com seq. Identifica processo/contador
   * único dentro de um run_id. Em concurrent runs (Ryo + Kei), múltiplos scope_ids
   * coexistem no mesmo NDJSON; chave única = (scope_id, seq). */
  scope_id: string;
  seq: number;
  ts: string;
  side: "sts" | "motor";
  step: string;
  user_id: string;
  partner_user_id: string | null;
  user_kind: string | null;
  motor_target: string | null;
  session_id: string | null;
  scenario_day: number | null;
  turn_number: number | null;
  model: string | null;
  provider: string | null;
  tokens: { in: number; out: number; reasoning: number } | null;
  latency_ms: number | null;
  cost_usd_est: number | null;
  prompt_hash: string | null;
  response_hash: string | null;
  reasoning_hash: string | null;
  snapshots_pre: Record<string, string> | null;
  snapshots_post: Record<string, string> | null;
  /** Mesma semântica granular do DebugEventInput.outcome (ver acima, D-4-TELO). */
  outcome: "ok" | "ok-retry" | "degraded" | "error" | "skip";
  error_class: string | null;
}

/** Computa sha256 hex + prefixo "sha256:". */
function hashContent(s: string): string {
  return "sha256:" + createHash("sha256").update(s, "utf-8").digest("hex");
}

/** Seq monotônico per-scope. Sprint 0 PR3 (motor#75): substituiu contador
 * global por Map keyed por scope_id, garantindo monotonicidade dentro de
 * cada scope mesmo em ambientes concorrentes (vide ops#398 F1-G5). */
const _seqCountersByScope = new Map<string, number>();

function nextSeqForScope(scopeId: string): number {
  const current = _seqCountersByScope.get(scopeId) ?? 0;
  const next = current + 1;
  _seqCountersByScope.set(scopeId, next);
  return next;
}

/** Ensures run dir exists + returns the absolute path. Idempotente. */
function ensureRunDir(runId: string): { root: string; content: string; snapshots: string } {
  const root = join(getDebugDir(), runId);
  const content = join(root, "content");
  const snapshots = join(root, "snapshots");
  if (!existsSync(content)) mkdirSync(content, { recursive: true });
  if (!existsSync(snapshots)) mkdirSync(snapshots, { recursive: true });
  return { root, content, snapshots };
}

/** Grava blob em CAS se ainda não existe. Retorna hash. */
function writeBlob(dir: string, content: string, ext: "txt" | "json"): string {
  const hash = hashContent(content);
  const hashHex = hash.slice("sha256:".length);
  const path = join(dir, `${hashHex}.${ext}`);
  if (!existsSync(path)) {
    writeFileSync(path, content, "utf-8");
  }
  return hash;
}

/** Serializa snapshot map em hashes (CAS). */
function writeSnapshotMap(
  dir: string,
  snapshots: Record<string, unknown> | null | undefined,
): Record<string, string> | null {
  if (!snapshots || Object.keys(snapshots).length === 0) return null;
  const out: Record<string, string> = {};
  for (const [engine, data] of Object.entries(snapshots)) {
    if (data == null) continue;
    const serialized = JSON.stringify(data, null, 2);
    out[engine] = writeBlob(dir, serialized, "json");
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Loga um evento. Se debug mode off OR run_id ausente, é no-op.
 * Falha de I/O não throw — loga stderr e continua (debug não pode quebrar produção).
 */
export function logDebugEvent(input: DebugEventInput): void {
  if (!isDebugModeEnabled()) return;
  const runId = getDebugRunId();
  if (!runId) return;

  try {
    const { root, content, snapshots } = ensureRunDir(runId);
    const promptHash = input.prompt ? writeBlob(content, input.prompt, "txt") : null;
    const responseHash = input.response ? writeBlob(content, input.response, "txt") : null;
    const reasoningHash = input.reasoning ? writeBlob(content, input.reasoning, "txt") : null;
    const snapshotsPreHashes = writeSnapshotMap(snapshots, input.snapshots_pre);
    const snapshotsPostHashes = writeSnapshotMap(snapshots, input.snapshots_post);

    // Sprint 0 PR3 (motor#75): scope_id pareia com seq.
    // Caller pode override (multi-process, simulação); senão usa scope global.
    const scopeId = input.scope_id ?? getDebugScopeId();

    const line: DebugEventLine = {
      run_id: runId,
      scope_id: scopeId,
      seq: nextSeqForScope(scopeId),
      ts: new Date().toISOString(),
      side: input.side,
      step: input.step,
      user_id: input.user_id,
      partner_user_id: input.partner_user_id ?? null,
      user_kind: input.user_kind ?? null,
      motor_target: input.motor_target ?? null,
      session_id: input.session_id ?? null,
      scenario_day: input.scenario_day ?? null,
      turn_number: input.turn_number ?? null,
      model: input.model ?? null,
      provider: input.provider ?? null,
      tokens: input.tokens
        ? {
            in: input.tokens.in ?? 0,
            out: input.tokens.out ?? 0,
            reasoning: input.tokens.reasoning ?? 0,
          }
        : null,
      latency_ms: input.latency_ms ?? null,
      // Sprint 0 PR1 (motor#71): auto-compute cost_usd_est via pricing table
      // quando caller não fornece explicitamente. Resolve ops#403 (F1-A006:
      // cost_usd_est=null em 378/378 events). Caller-provided wins (override).
      cost_usd_est:
        input.cost_usd_est ??
        (input.tokens
          ? calculateCostUsd(
              input.model ?? null,
              input.tokens.in ?? 0,
              input.tokens.out ?? 0,
              // D-3-PROV (ops#1055): passa provider pro cost calc — distingue
              // LLM local (openai-compat → 0) de modelo desconhecido (null).
              input.provider as LlmProvider | null | undefined,
            )
          : null),
      prompt_hash: promptHash,
      response_hash: responseHash,
      reasoning_hash: reasoningHash,
      snapshots_pre: snapshotsPreHashes,
      snapshots_post: snapshotsPostHashes,
      outcome: input.outcome,
      error_class: input.error_class ?? null,
    };

    appendFileSync(join(root, "events.ndjson"), JSON.stringify(line) + "\n", "utf-8");
  } catch (err) {
    // Debug mode nunca quebra produção — só loga e segue.
    // eslint-disable-next-line no-console
    console.error(`[debug-logger] write failed: ${String(err).slice(0, 200)}`);
  }
}

/**
 * Inicializa run dir + manifest. Chamado uma vez pelo scenario-runner no start.
 * Retorna o runId gerado (útil quando caller não passou ASC_DEBUG_RUN_ID).
 */
export function initDebugRun(opts: {
  scenarioName?: string;
  personas?: string[];
  parents?: string[];
  versions?: Record<string, string>;
}): string | null {
  if (!isDebugModeEnabled()) return null;

  let runId = getDebugRunId();
  if (!runId) {
    const scenario = opts.scenarioName ?? "run";
    const iso = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    runId = `${scenario}_${iso}Z`;
    setDebugRunId(runId);
  }

  try {
    const { root } = ensureRunDir(runId);
    const manifestPath = join(root, "manifest.json");
    if (!existsSync(manifestPath)) {
      writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            run_id: runId,
            scenario_name: opts.scenarioName ?? null,
            started_at: new Date().toISOString(),
            personas: opts.personas ?? [],
            parents: opts.parents ?? [],
            versions: {
              debug_mode_schema: DEBUG_MODE_SCHEMA_VERSION,
              ...(opts.versions ?? {}),
            },
          },
          null,
          2,
        ),
        "utf-8",
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[debug-logger] initDebugRun failed: ${String(err).slice(0, 200)}`);
  }
  return runId;
}

// ============================================================================
// Sprint 0 PR5 (motor#TBD) — Zod schema validation
// Stories: ops#504 (S-N-01-03 model=null marker) + ops#505 (S-N-01-04 Zod validation)
// Bundles fix ops#408 (mood_method enum violation)
// ============================================================================

const TokensSchema = z.object({
  in: z.number().int().min(0),
  out: z.number().int().min(0),
  reasoning: z.number().int().min(0),
});

const HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/**
 * Zod schema espelhando DebugEventLine + invariantes runtime.
 *
 * Invariante S-N-01-04: se `model != null`, então `tokens` deve existir
 * com `tokens.in > 0`. Stub steps DEVEM emitir `model: null`. Catches
 * casos onde caller emite nome de modelo fictício pra step sem LLM real.
 */
export const DebugEventLineSchema = z
  .object({
    run_id: z.string().min(1),
    scope_id: z.string().min(1),
    seq: z.number().int().min(1),
    ts: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
      message: "ts must be ISO 8601",
    }),
    side: z.enum(["sts", "motor"]),
    step: z.string().min(1),
    user_id: z.string().min(1),
    partner_user_id: z.string().nullable(),
    user_kind: z.string().nullable(),
    motor_target: z.string().nullable(),
    session_id: z.string().nullable(),
    scenario_day: z.number().int().nullable(),
    turn_number: z.number().int().nullable(),
    model: z.string().nullable(),
    provider: z.string().nullable(),
    tokens: TokensSchema.nullable(),
    latency_ms: z.number().nullable(),
    cost_usd_est: z.number().nullable(),
    prompt_hash: HashSchema.nullable(),
    response_hash: HashSchema.nullable(),
    reasoning_hash: HashSchema.nullable(),
    snapshots_pre: z.record(z.string(), z.string()).nullable(),
    snapshots_post: z.record(z.string(), z.string()).nullable(),
    // D-4-TELO (ops#1056): outcome ganha "ok-retry" e "degraded" entre
    // sucesso e falha. Legado ("ok" | "error" | "skip") continua válido.
    outcome: z.enum(["ok", "ok-retry", "degraded", "error", "skip"]),
    error_class: z.string().nullable(),
  })
  .refine(
    (data) => {
      // S-N-01-04: model != null implica tokens.in > 0
      if (data.model != null) {
        if (!data.tokens || data.tokens.in === 0) return false;
      }
      return true;
    },
    {
      message:
        "model != null requires tokens.in > 0 (stub steps must emit model: null) — S-N-01-04",
      path: ["model"],
    },
  );

/** Helper: validates a DebugEventLine, returns {ok, errors?}. */
export function validateDebugEventLine(
  data: unknown,
): { ok: true } | { ok: false; errors: string[] } {
  const result = DebugEventLineSchema.safeParse(data);
  if (result.success) return { ok: true };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}
