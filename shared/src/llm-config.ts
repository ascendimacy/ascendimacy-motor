/**
 * LLM robustness config — timeouts + retries compartilhados por todos os callsites.
 *
 * Motor#20 spec: docs/specs/... (inline aqui).
 *
 * Defaults conservadores pra evitar hang (Kimi K2.5 travou 54min na sessão).
 * Override via env var por step ou global.
 */

/** Timeouts default em ms, por step. */
export const LLM_TIMEOUT_DEFAULTS: Record<string, number> = {
  // Sonnet 4.6 planejador — prompts moderados, reasoning budget 1024
  planejador: 30_000,
  // Haiku 4.5 rerank — prompts curtos
  "haiku-triage": 15_000,
  // Haiku 4.5 bullying check
  "haiku-bullying": 15_000,
  // Infomaniak reasoning models (Kimi K2.5, DeepSeek-R1) — reasoning chains longas
  drota: 90_000,
  // Sonnet 4.6 persona-simulator
  "persona-sim": 30_000,
  // motor#25 — Signal Extractor (Mistral3 default, classification curta)
  "signal-extractor": 15_000,
  // motor#35 PART B — Mood Extractor (Mistral3 default, classification curta)
  "mood-extractor": 15_000,
  // motor-simplificacao-v1 — Unified Assessor (Haiku, JSON estruturado)
  "unified-assessor": 10_000,
};

/** MaxRetries default por step. */
export const LLM_MAX_RETRIES_DEFAULTS: Record<string, number> = {
  planejador: 3,
  "haiku-triage": 2, // rerank é recuperável via rule_based fallback — menos retries
  "haiku-bullying": 2,
  drota: 2, // reasoning model retry é caro, fail-fast é melhor
  "persona-sim": 3,
  "signal-extractor": 2, // motor#25 — fail-fast, fallback rule-based existe
  "mood-extractor": 2, // motor#35 PART B — fail-fast, fallback rule-based existe
  "unified-assessor": 2, // motor-simplificacao-v1 — fail-fast, rule-based degraded fallback
};

/**
 * Timeout em ms pra um step específico.
 *
 * Ordem de precedência:
 * 1. ASC_LLM_TIMEOUT_<STEP_UPPER> (ex: ASC_LLM_TIMEOUT_DROTA=120)
 * 2. ASC_LLM_TIMEOUT_SECONDS (global override)
 * 3. LLM_TIMEOUT_DEFAULTS[step]
 * 4. 30_000 (fallback)
 */
export function getLlmTimeoutMs(step: string): number {
  const normalized = step.toUpperCase().replace(/-/g, "_");
  const perStep = process.env[`ASC_LLM_TIMEOUT_${normalized}`];
  if (perStep) {
    const n = Number.parseInt(perStep, 10);
    if (!Number.isNaN(n) && n > 0) return n * 1000;
  }
  const global = process.env["ASC_LLM_TIMEOUT_SECONDS"];
  if (global) {
    const n = Number.parseInt(global, 10);
    if (!Number.isNaN(n) && n > 0) return n * 1000;
  }
  return LLM_TIMEOUT_DEFAULTS[step] ?? 30_000;
}

/**
 * MaxRetries pra um step específico.
 *
 * Ordem de precedência:
 * 1. ASC_LLM_MAX_RETRIES_<STEP_UPPER>
 * 2. ASC_LLM_MAX_RETRIES (global)
 * 3. LLM_MAX_RETRIES_DEFAULTS[step]
 * 4. 2 (fallback)
 */
export function getLlmMaxRetries(step: string): number {
  const normalized = step.toUpperCase().replace(/-/g, "_");
  const perStep = process.env[`ASC_LLM_MAX_RETRIES_${normalized}`];
  if (perStep) {
    const n = Number.parseInt(perStep, 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  const global = process.env["ASC_LLM_MAX_RETRIES"];
  if (global) {
    const n = Number.parseInt(global, 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  return LLM_MAX_RETRIES_DEFAULTS[step] ?? 2;
}

/**
 * Classifica erro de LLM pra decisão de retry/fail-fast.
 * Anthropic/OpenAI SDKs jogam errors com status HTTP numérico.
 */
export function classifyLlmError(err: unknown): {
  status: number | null;
  retriable: boolean;
  class: string;
} {
  if (err == null || typeof err !== "object") {
    return { status: null, retriable: false, class: "UnknownError" };
  }
  const e = err as { status?: number; name?: string; message?: string };
  const status = typeof e.status === "number" ? e.status : null;
  const name = e.name ?? "Error";

  // Timeout detection (AbortError from SDK timeouts)
  if (name === "AbortError" || (e.message ?? "").includes("timeout")) {
    return { status, retriable: false, class: "TimeoutError" };
  }
  // Auth / permission — fail fast
  if (status === 401 || status === 403) {
    return { status, retriable: false, class: "AuthError" };
  }
  // Bad request — fail fast
  if (status === 400) {
    return { status, retriable: false, class: "BadRequestError" };
  }
  // Rate limit — retry
  if (status === 429) {
    return { status, retriable: true, class: "RateLimitError" };
  }
  // Server errors — retry
  if (status != null && status >= 500 && status < 600) {
    return { status, retriable: true, class: "ServerError" };
  }
  // Network / fetch errors — retry cautiously
  if (name === "FetchError" || (e.message ?? "").includes("ECONN") || (e.message ?? "").includes("ENOTFOUND")) {
    return { status, retriable: true, class: "NetworkError" };
  }
  // OpenAI SDK length-finish (cobra caracterıstico)
  if ((e.message ?? "").includes("Could not parse response content as the length limit")) {
    return { status, retriable: false, class: "LengthFinishError" };
  }
  // Default: fail fast
  return { status, retriable: false, class: name };
}
