/**
 * LLM router — config helpers pra escolher provider + model por callsite (motor#21).
 *
 * Spec: docs/specs/2026-04-24-debug-mode.md (extension).
 *
 * Não chama LLM aqui — apenas decide CONFIG. Cada workspace implementa
 * sua própria chamada com Anthropic SDK ou OpenAI SDK + Infomaniak baseURL,
 * baseado no que getProviderForStep retorna.
 *
 * Defaults: TUDO Kimi K2.5 via Infomaniak (zero dependência de Anthropic credit).
 * Override per-callsite via env <STEP>_PROVIDER + <STEP>_MODEL.
 *
 * Ex:
 *   PLANEJADOR_PROVIDER=anthropic
 *   PLANEJADOR_MODEL=claude-sonnet-4-6
 *   PERSONA_SIM_PROVIDER=infomaniak
 *   PERSONA_SIM_MODEL=mistral3
 */

export type LlmProvider = "anthropic" | "infomaniak";

/** Steps válidos com config defaults. */
export const LLM_STEPS = [
  "planejador",
  "drota",
  "persona-sim",
  "haiku-triage",
  "haiku-bullying",
  "signal-extractor", // motor#25 — captura signals semânticos antes de Environment Assessor
  "mood-extractor", // motor#35 — extração de mood absoluto da criança (F1-mood PART B)
  "unified-assessor", // motor-simplificacao-v1 — Haiku unificado: signals + mood + engagement em 1 chamada
] as const;
export type LlmStep = (typeof LLM_STEPS)[number];

/**
 * Default provider por step.
 * motor#21 + motor-simplificacao-v1: TUDO Infomaniak — zero Anthropic dependency.
 *
 * unified-assessor migrou de Anthropic Haiku → Infomaniak granite (Jun, 28-abr,
 * downsizing): zero custo Anthropic + um único provider em toda stack.
 */
export const DEFAULT_PROVIDERS: Record<LlmStep, LlmProvider> = {
  planejador: "infomaniak",
  drota: "infomaniak",
  "persona-sim": "infomaniak",
  "haiku-triage": "infomaniak",
  "haiku-bullying": "infomaniak",
  "signal-extractor": "infomaniak",
  "mood-extractor": "infomaniak",
  "unified-assessor": "infomaniak",
};

/**
 * Default model por step.
 *
 * motor-simplificacao-v1 (Jun, 28-abr): TUDO `granite` (IBM small chat, ~3B,
 * ~3-5s/call). Downsizing radical: um único modelo em toda stack pra cortar
 * custos + simplificar debug. Trade-off conhecido: qualidade conversacional
 * cai vs Kimi K2.6 reasoning. Aceitável pra Kids (respostas curtas) e
 * classification (signal/mood/triage).
 *
 * Override per-step via env <STEP>_MODEL (ex: DROTA_MODEL=moonshotai/Kimi-K2.6
 * pra subir qualidade só do drota).
 */
export const DEFAULT_MODELS: Record<LlmStep, string> = {
  planejador: "granite",
  drota: "granite",
  "persona-sim": "granite",
  "haiku-triage": "granite",
  "haiku-bullying": "granite",
  "signal-extractor": "granite",
  "mood-extractor": "granite",
  "unified-assessor": "granite",
};

/**
 * Anthropic-specific defaults (usado só se provider=anthropic).
 * Mapeamento: step → modelo Claude equivalente.
 */
export const ANTHROPIC_FALLBACK_MODELS: Record<LlmStep, string> = {
  planejador: "claude-sonnet-4-6",
  drota: "claude-sonnet-4-6",
  "persona-sim": "claude-sonnet-4-6",
  "haiku-triage": "claude-haiku-4-5-20251001",
  "haiku-bullying": "claude-haiku-4-5-20251001",
  "signal-extractor": "claude-haiku-4-5-20251001",
  "mood-extractor": "claude-haiku-4-5-20251001",
  "unified-assessor": "claude-haiku-4-5-20251001",
};

function envKey(step: string, suffix: string): string {
  return `${step.toUpperCase().replace(/-/g, "_")}_${suffix}`;
}

/**
 * Resolve provider pra um step.
 *
 * Ordem:
 * 1. Env <STEP>_PROVIDER (ex: PLANEJADOR_PROVIDER)
 * 2. Env LLM_PROVIDER (global override)
 * 3. DEFAULT_PROVIDERS[step]
 * 4. "infomaniak" (Kimi-first fallback)
 */
export function getProviderForStep(step: string): LlmProvider {
  const perStep = process.env[envKey(step, "PROVIDER")];
  if (perStep === "anthropic" || perStep === "infomaniak") return perStep;
  const global = process.env["LLM_PROVIDER"];
  if (global === "anthropic" || global === "infomaniak") return global;
  return DEFAULT_PROVIDERS[step as LlmStep] ?? "infomaniak";
}

/**
 * Resolve model pra um step. Provider-aware:
 * - Se provider=anthropic e env <STEP>_MODEL é Anthropic-style ou ausente → Claude default
 * - Se provider=infomaniak → Infomaniak model name
 *
 * Ordem:
 * 1. Env <STEP>_MODEL (ex: PLANEJADOR_MODEL=moonshotai/Kimi-K2.5)
 * 2. Default por step + provider
 */
export function getModelForStep(step: string, provider?: LlmProvider): string {
  const explicit = process.env[envKey(step, "MODEL")];
  if (explicit && explicit.length > 0) return explicit;
  // Legacy compat: aceita nomes antigos (PLANEJADOR_MODEL, MOTOR_DROTA_MODEL)
  // que existiam antes da padronização do router.
  const legacyKeys: Record<string, string> = {
    drota: "MOTOR_DROTA_MODEL",
    planejador: "PLANEJADOR_MODEL",
  };
  const legacy = legacyKeys[step];
  if (legacy && process.env[legacy]) return process.env[legacy]!;
  // Fallback aware do provider escolhido
  const p = provider ?? getProviderForStep(step);
  if (p === "anthropic") {
    return ANTHROPIC_FALLBACK_MODELS[step as LlmStep] ?? "claude-sonnet-4-6";
  }
  return DEFAULT_MODELS[step as LlmStep] ?? "moonshotai/Kimi-K2.5";
}

/**
 * Heurística: modelo é reasoning-capable?
 * Reasoning models drenam tokens em CoT antes de emitir content,
 * então max_tokens precisa ser maior.
 */
export function isReasoningModel(model: string): boolean {
  return /kimi|deepseek-r|o1|o3|reason|qwq|thinking/i.test(model);
}

/**
 * max_tokens default por step + reasoning awareness.
 * Override via env <STEP>_MAX_TOKENS.
 */
export function getMaxTokensForStep(step: string, model: string): number {
  const explicit = process.env[envKey(step, "MAX_TOKENS")];
  if (explicit) {
    const n = Number.parseInt(explicit, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const reasoning = isReasoningModel(model);
  switch (step) {
    case "planejador":
      return reasoning ? 4096 : 2048;
    case "drota":
      return reasoning ? 4096 : 2048;
    case "persona-sim":
      return reasoning ? 4096 : 2048;
    case "haiku-triage":
      return reasoning ? 2048 : 512;
    case "haiku-bullying":
      return reasoning ? 2048 : 512;
    default:
      return reasoning ? 4096 : 2048;
  }
}

/**
 * Anthropic extended thinking habilitado pra esse step?
 *
 * Só relevante se provider=anthropic. Para Infomaniak, reasoning vem
 * automático em modelos reasoning (Kimi, DeepSeek-R1).
 *
 * Default: ON em planejador + persona-sim (debug útil), OFF em
 * haiku-* (rerank simples, thinking custa latência).
 */
export function shouldEnableThinking(step: string, provider: LlmProvider, debugMode: boolean): boolean {
  if (provider !== "anthropic") return false;
  if (!debugMode) return false;
  const noThinkSteps = new Set(["haiku-triage", "haiku-bullying"]);
  return !noThinkSteps.has(step);
}

export function getThinkingBudgetTokens(): number {
  const v = process.env["LLM_THINKING_BUDGET_TOKENS"];
  if (v) {
    const n = Number.parseInt(v, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return 1024;
}
