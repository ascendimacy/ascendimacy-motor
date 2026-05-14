/**
 * generateActionMenu — gerador LLM-backed do ActionMenu pós-compaction.
 *
 * Sprint 1 PR2 — S-T-09-02 (ops#993) combinada com H-AC-02 (motor#88).
 *
 * Função pura (mod. LLM side-effect): recebe profile + trustLevel + eixos +
 * onboarding + persona_hint, chama LLM via gateway, valida output contra
 * schema v0.2 (shared/contracts/action-menu), aplica regras auto de
 * is_critical, e devolve ActionMenu pronto pra persistir.
 *
 * Comportamento de robustez:
 *
 * 1. **Retry once on Zod failure**: se primeiro output do LLM falhar parse,
 *    re-pede com instrução de correção explícita (mensagem do Zod no prompt).
 *
 * 2. **Graceful degradation on retry failure**: se segundo output também
 *    falhar SÓ pelos campos ISA opcionais (`played_as`/`intensity`/
 *    `is_critical`), o gerador *strips* esses campos e tenta parse de novo.
 *    Items sem rótulo continuam válidos (campos opcionais no schema v0.2);
 *    warning `isa_labels_stripped` emitido.
 *
 * 3. **Null on hard failure**: LLM lança em ambas as tentativas, OU output
 *    não é JSON parseável de jeito nenhum, OU schema rejeita por motivo
 *    estrutural (não-ISA) → retorna `null` + warning.
 *
 * 4. **Auto is_critical** (regra do prompt §3): item com `played_as=recovery`
 *    OU `played_as=diamante` + `intensity=firm` é forçado a `is_critical=true`
 *    mesmo se LLM omitir.
 *
 * Telemetria: emite evento `menu_generation` via `logDebugEvent` (NDJSON)
 * com cost/latency/tokens — visível no painel longitudinal futuro (H-AC-08).
 *
 * Refs:
 * - ops#993 (S-T-09-02 — escopo da gen function)
 * - motor#88 (H-AC-02 — rotulagem ISA)
 * - motor#89 (H-AC-01 — schema v0.2)
 * - ops#991 (Sprint 1 tracker)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTION_MENU_SCHEMA_VERSION,
  ActionMenuSchema,
  logDebugEvent,
  type ActionMenu,
  type ActionMenuItem,
  type Intensity,
  type LlmProvider,
  type PlayedAs,
} from "@ascendimacy/shared";

import { callLlm, type LlmCallResult } from "./llm-client.js";
import {
  renderPersonaHintForPrompt,
  type PersonaHint,
} from "./persona-hints.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Caminho default do template — em prod/test vem do mesmo lugar.
 *
 * v0.3 (2026-05-14, post-baseline N=30): adiciona §6b explicitando "NUNCA
 * invente hash". 2 errors do baseline foram degeneration loops em
 * profile_hash/eixos_state_hash. Schema motor#101 reforça com .max(128).
 *
 * v0.2 (motor#99): adiciona §4b clarificando distinção `type` ↔ `played_as`.
 *
 * v0.1 (motor#94): nascimento.
 *
 * Versões anteriores preservadas em `menu-generator-v0.{1,2}.txt` pra
 * reversão emergencial.
 */
const PROMPT_TEMPLATE_PATH = join(
  __dirname,
  "prompts",
  "menu-generator-v0.3.txt",
);

/** Versão do prompt — bump quando estrutura mudar (não conteúdo). */
export const PROMPT_TEMPLATE_VERSION = "v0.3";

/** Input canônico do gerador. */
export interface GenerateActionMenuInput {
  personaId: string;
  /** Trust level em [0, 1]. */
  trustLevel: number;
  /** Profile do learner (shape livre v0; consumer principal é o LLM). */
  profile: unknown;
  /** Snapshot opcional do estado de eixos. */
  eixosState?: unknown;
  /** Snapshot opcional do onboarding. */
  onboarding?: unknown;
  /**
   * Calibração persona-aware. Quando ausente, gerador faz lookup via
   * `resolvePersonaHint(personaId)`; se ainda assim ausente, gerador
   * roda sem hint (LLM cai em distribuição neutra).
   */
  personaHint?: PersonaHint;
  /**
   * Trace correlation. Quando fornecido, o evento de telemetria inclui
   * este `session_id`. Default: undefined (debug-logger usa scope global).
   */
  sessionId?: string;
}

/** Tipo do callback de telemetria/warning. */
export interface MenuGeneratorWarning {
  code:
    | "invalid_input"
    | "llm_error"
    | "parse_error_first"
    | "parse_error_retry"
    | "schema_error_first"
    | "schema_error_retry"
    | "isa_labels_stripped";
  message: string;
  details?: Record<string, unknown>;
}

/** Tipo do LLM call — injetável para testes (mock). */
export type LlmCall = (
  systemPrompt: string,
  userMessage: string,
) => Promise<LlmCallResult>;

export interface GenerateActionMenuOptions {
  llmCall?: LlmCall;
  onWarning?: (w: MenuGeneratorWarning) => void;
  /** Override path do template (testes). */
  promptTemplatePath?: string;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Lê template + cacheia em memória (idempotente entre chamadas).
 *
 * `postbuild` em motor-drota/package.json copia `src/prompts/*.txt` para
 * `dist/prompts/`, então `__dirname/prompts/` resolve igual em dev (vitest
 * sobre src/) e prod (Node sobre dist/). Ref: ops#1057 (D-5-PBLD).
 */
let _cachedTemplate: string | null = null;
function loadPromptTemplate(pathOverride?: string): string {
  if (pathOverride) return readFileSync(pathOverride, "utf-8");
  if (_cachedTemplate) return _cachedTemplate;
  _cachedTemplate = readFileSync(PROMPT_TEMPLATE_PATH, "utf-8");
  return _cachedTemplate;
}

/** Substitui `{{var}}` no template. */
function fillTemplate(
  tpl: string,
  vars: Record<string, string>,
): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

/** Constrói o system + user prompts para a chamada LLM. */
function buildPrompts(input: GenerateActionMenuInput, templatePath?: string): {
  systemPrompt: string;
  userMessage: string;
} {
  const template = loadPromptTemplate(templatePath);
  const personaHintBlock = input.personaHint
    ? renderPersonaHintForPrompt(input.personaHint)
    : "(sem hint registrado para este persona — distribuição neutra)";

  const filled = fillTemplate(template, {
    persona_hint_block: personaHintBlock,
    trust_level: String(input.trustLevel),
    profile_json: JSON.stringify(input.profile, null, 2),
    eixos_state_json: JSON.stringify(input.eixosState ?? null, null, 2),
    onboarding_json: JSON.stringify(input.onboarding ?? null, null, 2),
  });

  // O template inteiro vira system prompt; user message é gatilho curto.
  const systemPrompt = filled;
  const userMessage =
    `Gere agora o ActionMenu para persona_id="${input.personaId}". ` +
    "Retorne SOMENTE o JSON, sem code fence, sem comentários fora do JSON.";
  return { systemPrompt, userMessage };
}

/** Extrai JSON de string que pode vir com code fence ou prosa. */
function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  // Tenta direto.
  if (trimmed.startsWith("{")) {
    return trimmed;
  }
  // Tenta ```json ... ``` fence.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1]!.trim();
  }
  // Tenta primeiro { ... } balanceado (best-effort).
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1).trim();
  }
  return null;
}

/** Aplica regras auto de is_critical (idempotente). */
function applyAutoCritical(menu: ActionMenu): ActionMenu {
  for (const item of menu.items) {
    if (item.played_as === "recovery") {
      item.is_critical = true;
    } else if (item.played_as === "diamante" && item.intensity === "firm") {
      item.is_critical = true;
    }
  }
  return menu;
}

/** Strip campos ISA opcionais de todos os items. Mutação in-place. */
function stripIsaLabels(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  const items = obj["items"];
  if (!Array.isArray(items)) return raw;
  for (const item of items) {
    if (item && typeof item === "object") {
      const it = item as Record<string, unknown>;
      delete it["played_as"];
      delete it["intensity"];
      delete it["is_critical"];
    }
  }
  return raw;
}

/**
 * Tenta extrair + parsear menu. Retorna discriminated union.
 */
function tryParseMenu(
  llmContent: string,
): { ok: true; menu: ActionMenu } | { ok: false; reason: "no_json"; raw: string } | { ok: false; reason: "schema_invalid"; rawJson: string; zodMessage: string } {
  const jsonStr = extractJson(llmContent);
  if (!jsonStr) {
    return { ok: false, reason: "no_json", raw: llmContent };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonStr);
  } catch {
    return { ok: false, reason: "no_json", raw: llmContent };
  }
  const safe = ActionMenuSchema.safeParse(parsedJson);
  if (!safe.success) {
    return {
      ok: false,
      reason: "schema_invalid",
      rawJson: jsonStr,
      zodMessage: safe.error.message,
    };
  }
  return { ok: true, menu: safe.data };
}

/** Constrói mensagem de retry com instrução de correção explícita. */
function buildRetryPrompt(
  originalUserMessage: string,
  zodMessage: string,
): string {
  return [
    originalUserMessage,
    "",
    "**RETRY — o JSON anterior foi INVÁLIDO contra o schema v0.2.**",
    "",
    "Erro reportado pelo validador:",
    "```",
    zodMessage,
    "```",
    "",
    "Corrija o JSON. Atenção especial aos enums:",
    "- `played_as`: APENAS bridge | espelho | canal | diamante | arena | recovery",
    "- `intensity`: APENAS soft | medium | firm",
    "- `is_critical`: APENAS true | false (booleano)",
    "",
    "Se em dúvida sobre algum item, OMITA os campos ISA opcionais nesse " +
      "item (eles são opcionais; melhor um item sem rótulo do que rótulo " +
      "inválido). Retorne SOMENTE o JSON corrigido.",
  ].join("\n");
}

/**
 * Tenta emitir telemetria — silencia falhas (telemetria não pode quebrar prod).
 *
 * D-4-TELO (ops#1056): outcome passa direto, sem colapsar:
 *  - "ok"       — sucesso na primeira tentativa (1 LLM call)
 *  - "ok-retry" — sucesso após retry (2 LLM calls; primeiro output rejeitado)
 *  - "degraded" — sucesso parcial: ISA labels stripped após 2 retries falharem
 *  - "error"    — falha hard: null retornado, exception, ou JSON garbage 2x
 *
 * Granularidade necessária pra análise longitudinal (H-AC-08 painel, H-AC-12
 * pass-rate). Antes a função colapsava tudo não-"error" em "ok", perdendo
 * sinal entre runs saudáveis e runs que precisaram de retry/degradação.
 */
function emitTelemetry(args: {
  personaId: string;
  sessionId?: string;
  result?: LlmCallResult;
  latencyMs: number;
  outcome: "ok" | "ok-retry" | "degraded" | "error";
  prompt?: string;
  response?: string;
}): void {
  try {
    logDebugEvent({
      side: "motor",
      step: "menu_generation",
      user_id: args.personaId,
      motor_target: "planejador-strategist",
      session_id: args.sessionId,
      provider: args.result?.provider as LlmProvider | undefined,
      model: args.result?.model,
      tokens: args.result?.tokens,
      latency_ms: args.latencyMs,
      prompt: args.prompt,
      response: args.response,
      outcome: args.outcome,
    });
  } catch {
    // No-op — telemetria não pode quebrar produção.
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Gera ActionMenu via LLM para o persona dado.
 *
 * @returns ActionMenu válido (schema v0.2) ou `null` em falha hard.
 *   Warnings detalhados via `options.onWarning` callback.
 */
export async function generateActionMenu(
  input: GenerateActionMenuInput,
  options: GenerateActionMenuOptions = {},
): Promise<ActionMenu | null> {
  const warn = (w: MenuGeneratorWarning): void => {
    options.onWarning?.(w);
  };

  // Validação de input — antes de gastar LLM call.
  if (!input.personaId || input.personaId.trim().length === 0) {
    warn({ code: "invalid_input", message: "personaId é obrigatório" });
    return null;
  }
  if (input.trustLevel < 0 || input.trustLevel > 1) {
    warn({
      code: "invalid_input",
      message: `trustLevel fora de [0,1]: ${input.trustLevel}`,
    });
    return null;
  }

  const llmCall: LlmCall = options.llmCall ?? callLlm;
  const { systemPrompt, userMessage } = buildPrompts(
    input,
    options.promptTemplatePath,
  );

  const t0 = Date.now();
  let attempt1: LlmCallResult;
  try {
    attempt1 = await llmCall(systemPrompt, userMessage);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn({ code: "llm_error", message: `LLM call failed (attempt 1): ${msg}` });
    // Retry once on LLM error. Premature `error` emit removido (ops#TBD)
    // — antes emitia evento error pré-retry que era confuso quando retry
    // recuperava (criava 2 events num run só). Só emite no final.
    try {
      attempt1 = await llmCall(systemPrompt, userMessage);
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2);
      warn({
        code: "llm_error",
        message: `LLM call failed (retry): ${msg2}`,
      });
      // Captura prompt — não há response (LLM throw 2x consecutivo).
      emitTelemetry({
        personaId: input.personaId,
        sessionId: input.sessionId,
        latencyMs: Date.now() - t0,
        outcome: "error",
        prompt: systemPrompt + "\n---\n" + userMessage,
      });
      return null;
    }
  }

  const parsed1 = tryParseMenu(attempt1.content);
  if (parsed1.ok) {
    const menu = applyAutoCritical(parsed1.menu);
    emitTelemetry({
      personaId: input.personaId,
      sessionId: input.sessionId,
      result: attempt1,
      latencyMs: Date.now() - t0,
      outcome: "ok",
      prompt: systemPrompt + "\n---\n" + userMessage,
      response: attempt1.content,
    });
    return menu;
  }

  // Primeiro parse falhou — retry com correção.
  const retryUserMessage =
    parsed1.reason === "schema_invalid"
      ? buildRetryPrompt(userMessage, parsed1.zodMessage)
      : buildRetryPrompt(
          userMessage,
          "JSON não foi reconhecido na resposta — verifique se retornou " +
            "apenas o JSON puro, sem code fence ou prosa ao redor.",
        );

  if (parsed1.reason === "schema_invalid") {
    warn({
      code: "schema_error_first",
      message: "Schema invalid on first attempt; retrying with correction",
      details: { zodMessage: parsed1.zodMessage },
    });
  } else {
    warn({
      code: "parse_error_first",
      message: "No JSON extractable on first attempt; retrying",
    });
  }

  let attempt2: LlmCallResult;
  try {
    attempt2 = await llmCall(systemPrompt, retryUserMessage);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn({ code: "llm_error", message: `LLM call failed (retry): ${msg}` });
    // Captura prompt do retry + response do attempt1 (que motivou o retry).
    // Permite debug: "o que LLM emitiu na 1a tentativa que reprovou parse?"
    emitTelemetry({
      personaId: input.personaId,
      sessionId: input.sessionId,
      result: attempt1,
      latencyMs: Date.now() - t0,
      outcome: "error",
      prompt: systemPrompt + "\n---\n" + retryUserMessage,
      response: attempt1.content,
    });
    return null;
  }

  const parsed2 = tryParseMenu(attempt2.content);
  if (parsed2.ok) {
    const menu = applyAutoCritical(parsed2.menu);
    emitTelemetry({
      personaId: input.personaId,
      sessionId: input.sessionId,
      result: attempt2,
      latencyMs: Date.now() - t0,
      outcome: "ok-retry",
      prompt: systemPrompt + "\n---\n" + retryUserMessage,
      response: attempt2.content,
    });
    return menu;
  }

  // Retry também falhou. Tentar graceful degradation: strip ISA labels
  // e tentar parse do segundo output (campos ISA são opcionais, então
  // se o resto do menu é válido, menu sem rótulo ainda é útil).
  if (parsed2.reason === "schema_invalid") {
    warn({
      code: "schema_error_retry",
      message: "Schema invalid on retry; attempting graceful degradation",
      details: { zodMessage: parsed2.zodMessage },
    });
    try {
      const stripped = stripIsaLabels(JSON.parse(parsed2.rawJson));
      const safeStripped = ActionMenuSchema.safeParse(stripped);
      if (safeStripped.success) {
        warn({
          code: "isa_labels_stripped",
          message:
            "ISA labels removed from items after 2 failed retries; " +
            "menu persisted without played_as/intensity/is_critical.",
        });
        emitTelemetry({
          personaId: input.personaId,
          sessionId: input.sessionId,
          result: attempt2,
          latencyMs: Date.now() - t0,
          outcome: "degraded",
          prompt: systemPrompt + "\n---\n" + retryUserMessage,
          response: attempt2.content,
        });
        return safeStripped.data;
      }
    } catch {
      // JSON parsing failed após strip — cai pra erro hard.
    }
  } else {
    warn({
      code: "parse_error_retry",
      message: "No JSON extractable on retry — hard failure",
    });
  }

  // Hard failure. Captura prompt do retry + response do attempt2
  // (último output do LLM que não parseou + não recuperou via strip).
  // Crítico pra debug: permite ver o que LLM emitiu que confundiu o parser.
  emitTelemetry({
    personaId: input.personaId,
    sessionId: input.sessionId,
    result: attempt2,
    latencyMs: Date.now() - t0,
    outcome: "error",
    prompt: systemPrompt + "\n---\n" + retryUserMessage,
    response: attempt2.content,
  });
  return null;
}

/** Re-export para consumers que querem o tipo sem importar do shared. */
export type { ActionMenu, ActionMenuItem, Intensity, PlayedAs };

/** Constante exposta para sanity check de versão pelo consumer. */
export { ACTION_MENU_SCHEMA_VERSION };
