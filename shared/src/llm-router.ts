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

/**
 * Provider canônicos:
 *  - "anthropic"      — Anthropic API direta (claude-sonnet-4-6, etc.)
 *  - "infomaniak"     — Infomaniak OpenAI-compat (Kimi K2.5, Mistral3, etc.)
 *  - "openai-compat"  — endpoint OpenAI-compat genérico (LLM local
 *                       llama.cpp SYCL, vLLM-XPU, etc.). Não tem entrada
 *                       no DEFAULT_PROVIDERS porque é override per-callsite
 *                       (ex: LLM-LOCAL integration tests, dev iteration).
 *                       D-3-PROV (ops#1055).
 */
export type LlmProvider = "anthropic" | "infomaniak" | "openai-compat";

/**
 * Subconjunto de `LlmProvider` que passa pelo `llm-gateway` (rede paga,
 * retry/fallback/bucket coordinado). `openai-compat` NÃO faz parte —
 * é local, accessed direto per-callsite, sem retry coordenado.
 *
 * Usado pelos maps exhaustivos do Router (`FALLBACK_MAP`, `providers`,
 * `buckets`). Mantém invariante: gateway só conhece anthropic/infomaniak.
 * D-3-PROV (ops#1055).
 */
export type GatewayLlmProvider = "anthropic" | "infomaniak";

/** Steps válidos com config defaults. */
export const LLM_STEPS = [
  "planejador",
  "drota",
  "persona-sim",
  "haiku-triage",
  "haiku-bullying",
  "signal-extractor", // motor#25 — captura signals semânticos antes de Environment Assessor
  "mood-extractor", // motor#35 — extração de mood absoluto da criança (F1-mood PART B)
] as const;
export type LlmStep = (typeof LLM_STEPS)[number];

/**
 * Default provider por step.
 * motor#21: TUDO Infomaniak por default — zero Anthropic dependency.
 */
export const DEFAULT_PROVIDERS: Record<LlmStep, LlmProvider> = {
  planejador: "infomaniak",
  drota: "infomaniak",
  "persona-sim": "infomaniak",
  "haiku-triage": "infomaniak",
  "haiku-bullying": "infomaniak",
  "signal-extractor": "infomaniak",
  "mood-extractor": "infomaniak",
};

/**
 * Default model por step.
 * Reasoning models (Kimi K2.5) pra steps onde reasoning ajuda.
 * mistral3 (Mistral-Small-3.2-24B) pra triage/bullying — small, fast, deterministic.
 */
export const DEFAULT_MODELS: Record<LlmStep, string> = {
  planejador: "moonshotai/Kimi-K2.5",
  drota: "moonshotai/Kimi-K2.5",
  "persona-sim": "moonshotai/Kimi-K2.5",
  "haiku-triage": "mistral3",
  "haiku-bullying": "mistral3",
  // Signal Extractor: Mistral3 default — não-reasoning, ~5s/call.
  // Tarefa é classificação de signals em texto curto, não exige reasoning.
  "signal-extractor": "mistral3",
  // Mood Extractor (motor#35 PART B): Mistral3 default — classificação curta
  // ("humor 1-10 + rationale"), não-reasoning. Mesmo perfil do signal-extractor.
  "mood-extractor": "mistral3",
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
  if (perStep === "anthropic" || perStep === "infomaniak" || perStep === "openai-compat") {
    return perStep;
  }
  const global = process.env["LLM_PROVIDER"];
  if (global === "anthropic" || global === "infomaniak" || global === "openai-compat") {
    return global;
  }
  return DEFAULT_PROVIDERS[step as LlmStep] ?? "infomaniak";
}

/**
 * Decide se step deve cair em mock-LLM fixture.
 *
 * Provider-aware (D-3-PROV ops#1055 follow-up): openai-compat = LLM local
 * (llama.cpp/vLLM-XPU) e NÃO exige API key — sem essa exceção, o gate
 * caía no branch legacy (checava INFOMANIAK_API_KEY) e forçava mock
 * mesmo com llama-server up. Reproduzido em smoke STS 2026-05-24 contra
 * Qwen3-30B (`signals=[]`, `"Mock: contexto inicial"` em strategicRationale).
 *
 * Ordem de precedência:
 * 1. USE_MOCK_LLM=true → mock (override explícito do operador)
 * 2. provider=anthropic + sem ANTHROPIC_API_KEY → mock
 * 3. provider=infomaniak + sem INFOMANIAK_API_KEY → mock
 * 4. provider=openai-compat → NUNCA mock por key (LLM local, sem API key)
 */
export function shouldUseMockLlm(step: string): boolean {
  if (process.env["USE_MOCK_LLM"] === "true") return true;
  const provider = getProviderForStep(step);
  if (provider === "anthropic") return !process.env["ANTHROPIC_API_KEY"];
  if (provider === "infomaniak") return !process.env["INFOMANIAK_API_KEY"];
  // openai-compat: LLM local, no key required
  return false;
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
  // D-3-PROV (ops#1055): openai-compat = LLM local. Modelo vem da env
  // específica LLM_LOCAL_MODEL (canônico nos LLM-LOCAL integration tests),
  // não dos defaults por step. "unknown" quando env ausente — força
  // o operador a setar explicitamente o modelo que está rodando.
  if (p === "openai-compat") {
    return process.env["LLM_LOCAL_MODEL"] ?? "unknown";
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
  // D-3-PROV (ops#1055): openai-compat (LLM local) não tem thinking mode
  // equivalente — qwen3-30b-a3b-instruct-2507 não emite reasoning_content
  // separado do conteúdo. Sempre false; tratado igual a infomaniak.
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
