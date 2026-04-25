/**
 * Debug logger — observability completa do pipeline LLM (motor#19, sts#10).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-24-debug-mode.md
 *
 * Escrito no shared/ porque ambos lados (motor + sts) precisam usar.
 * Thread-safe via fsync síncrono em cada write (debug mode não é hot path).
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEBUG_MODE_SCHEMA_VERSION = "1.0";

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

/** Seta run ID (usado pelo scenario-runner na inicialização). */
export function setDebugRunId(runId: string): void {
  process.env["ASC_DEBUG_RUN_ID"] = runId;
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
  outcome: "ok" | "error" | "skip";
  error_class?: string | null;
}

export interface DebugEventLine {
  run_id: string;
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
  outcome: "ok" | "error" | "skip";
  error_class: string | null;
}

/** Computa sha256 hex + prefixo "sha256:". */
function hashContent(s: string): string {
  return "sha256:" + createHash("sha256").update(s, "utf-8").digest("hex");
}

/** Seq monotônico por processo. Persistido in-memory. */
let _seqCounter = 0;
function nextSeq(): number {
  _seqCounter += 1;
  return _seqCounter;
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

    const line: DebugEventLine = {
      run_id: runId,
      seq: nextSeq(),
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
      cost_usd_est: input.cost_usd_est ?? null,
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
