/**
 * LLM config — robustness primitives (motor#20) + pricing/cost (Sprint 0 PR1, motor#71).
 *
 * Motor#20 spec: timeouts + retries compartilhados por todos os callsites.
 * Sprint 0 PR1 (ops#497): pricing table + cost calc em USD por modelo.
 *
 * Defaults conservadores pra evitar hang (Kimi K2.5 travou 54min na sessão).
 * Override via env var por step ou global.
 */

import type { LlmProvider } from "./llm-router.js";

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
  // Sprint 5 #4 — Unified Assessor (Haiku, JSON estruturado, rápido).
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
  "unified-assessor": 2, // Sprint 5 #4 — fail-fast, rule-based degraded fallback
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

// ============================================================================
// Sprint 0 PR1 (motor#71) — Pricing + Cost calc
// Stories: ops#498 (S-J-01-01) + ops#499 (S-J-01-02)
// Capability: ops#483 (C-J-01) — Curador rastreia custo e usage por run
// Issue âncora: ops#403 (F1-A006 — cost_usd_est=null em 378/378 events)
// ============================================================================

/** Estrutura de preço por token (USD). Campos em float — divisão de preço/M
 * tokens por 1_000_000 mantém precisão suficiente. */
export interface ModelPricing {
  /** Custo USD por token de input. */
  price_in_per_token: number;
  /** Custo USD por token de output. */
  price_out_per_token: number;
}

/** Metadata da tabela de preços. Atualizar `last_updated` + bumpar `version`
 * quando preços forem revisados. */
export const PRICING_TABLE_METADATA = {
  /** Versão semântica da tabela. Bumpa minor quando adiciona modelo;
   * bumpa major quando muda valores significativamente. */
  version: "v0.1",
  /** Data ISO da última atualização. */
  last_updated: "2026-05-08",
  /** Fonte/origem dos preços. Anthropic: pricing público (anthropic.com/pricing).
   * Infomaniak: estimativa baseada em pricing público Moonshot/Mistral.
   * Verificação completa pendente em ops#476. */
  source:
    "Anthropic public pricing + Moonshot/Mistral public pricing (Infomaniak resells); v0.1 estimates pending verification in ops#476",
} as const;

/** Tabela canônica de preços. Chaves são strings de modelo EXATAS como
 * aparecem em `shared/src/llm-router.ts` defaults — nada de aliasing aqui.
 *
 * Adicionar novo modelo: incluir na tabela + bumpar PRICING_TABLE_METADATA.version. */
const PRICING_TABLE: Record<string, ModelPricing> = {
  // ===== LLM LOCAL (zero custo de API) =====
  // Roda em llama.cpp SYCL no host do desenvolvedor (Intel Arc B580).
  // Custo de API = 0; custo de electricidade/hardware fora do escopo deste tracking.
  "qwen3-8b": {
    price_in_per_token: 0,
    price_out_per_token: 0,
  },

  // ===== INFOMANIAK (Moonshot Kimi K2.5 + Mistral) =====
  // Pricing aproximado baseado em fontes públicas; Infomaniak resells.
  // Kimi K2.5 = reasoning model, output cobra mais que input.
  // ~$0.15/M input, ~$0.60/M output (aproximação Moonshot pricing 2026).
  "moonshotai/Kimi-K2.5": {
    price_in_per_token: 0.00000015,
    price_out_per_token: 0.0000006,
  },
  // Mistral Small 3.2 24B — small classification model.
  // ~$0.20/M input, ~$0.60/M output (aproximação Mistral pricing).
  mistral3: {
    price_in_per_token: 0.0000002,
    price_out_per_token: 0.0000006,
  },

  // ===== ANTHROPIC =====
  // Pricing público anthropic.com/pricing (2026 cutoff).
  // Haiku 4.5: $1/M input, $5/M output.
  "claude-haiku-4-5-20251001": {
    price_in_per_token: 0.000001,
    price_out_per_token: 0.000005,
  },
  // Sonnet 4.6: $3/M input, $15/M output.
  "claude-sonnet-4-6": {
    price_in_per_token: 0.000003,
    price_out_per_token: 0.000015,
  },
};

/** Lookup de preços por nome de modelo. Retorna null se modelo não
 * estiver na tabela — caller decide (warn + emit cost=null em geral). */
export function getPricesForModel(model: string): ModelPricing | null {
  if (!model) return null;
  return PRICING_TABLE[model] ?? null;
}

/** Calcula cost_usd_est dado modelo + tokens de input/output (+ provider).
 *
 * Retorno:
 *  - 0 se ambos tokens=0 (steps stub não custam — distingue 'sem tokens'
 *    de 'modelo desconhecido'; S-J-01-03)
 *  - 0 se provider="openai-compat" (LLM local, sem custo de API —
 *    D-3-PROV ops#1055; distingue de `null` que é "modelo desconhecido")
 *  - null se model é null OR modelo desconhecido (com warn na console)
 *  - número positivo caso contrário (qwen3-8b sempre = 0 por price=0
 *    mesmo sem passar provider)
 *
 * O parâmetro `provider` é OPCIONAL pra preservar back-compat com callers
 * pré-D-3-PROV. Quando ausente, a lookup pela PRICING_TABLE continua
 * autoritativa (qwen3-8b cadastrado lá com price=0).
 *
 * Tokens negativos são tratados como 0 (defensivo — não deve acontecer
 * em produção mas evita cost negativo se serializer falhar). */
export function calculateCostUsd(
  model: string | null,
  tokensIn: number,
  tokensOut: number,
  provider?: LlmProvider | null,
): number | null {
  const safeIn = Math.max(0, tokensIn);
  const safeOut = Math.max(0, tokensOut);
  // S-J-01-03: zero tokens overrides everything — sem tokens consumidos = sem custo
  if (safeIn === 0 && safeOut === 0) return 0;
  // D-3-PROV: openai-compat = LLM local, custo de API = 0 mesmo se modelo
  // não estiver cadastrado no PRICING_TABLE. Resolve o caso de runtime
  // alias do llama-server (qwen3-30b, ministral-q4, etc.) sem precisar
  // de whitelist por modelo. Cadastro explícito na PRICING_TABLE continua
  // sendo defensive layer pros casos onde caller não passa provider.
  if (provider === "openai-compat") return 0;
  if (model == null) return null;
  const prices = getPricesForModel(model);
  if (prices == null) {
    // eslint-disable-next-line no-console
    console.warn(`[llm-config] Unknown model for cost calculation: ${model}`);
    return null;
  }
  return safeIn * prices.price_in_per_token + safeOut * prices.price_out_per_token;
}
