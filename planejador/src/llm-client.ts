/**
 * Planejador LLM client — motor#28c: routes via llm-gateway (MCP).
 *
 * ANTES (motor#21): instanciava SDK Anthropic/OpenAI direto, com lógica
 * própria de timeout/retry/thinking wiring.
 *
 * AGORA (motor#28c): chama `callGateway()` do shared. Gateway centraliza
 * retry, fallback, undici Agent IPv4-first, NDJSON logging. Trade-off
 * Modelo A — ver motor#28b PR pra discussão.
 *
 * API pública (`callLlm`, `callHaiku`, `callLlmMock`) inalterada — drop-in
 * pra plan.ts.
 */

import {
  callGateway,
  callGatewayWithTracing,
  isDebugModeEnabled,
  getProviderForStep,
  getModelForStep,
  getMaxTokensForStep,
  shouldEnableThinking,
  getThinkingBudgetTokens,
  type LlmProvider,
  type LlmCallRole,
  type LlmTraceCollector,
} from "@ascendimacy/shared";

export interface LlmCallResult {
  content: string;
  reasoning?: string;
  tokens: { in: number; out: number; reasoning: number };
  /** Provider efetivamente usado (útil pra debug log). */
  provider: LlmProvider;
  /** Model efetivamente usado. */
  model: string;
}

/**
 * TV2-3 (spec ops#1136): opções opcionais pra coletar LlmCallTrace.
 * Backward 100% — quando ausente, comporta-se como antes.
 */
export interface CallLlmOpts {
  collector?: LlmTraceCollector;
  /** Role pro trace catalog. Default "planejador". */
  role?: LlmCallRole;
}

async function callViaGateway(
  step: string,
  systemPrompt: string,
  userMessage: string,
  opts?: CallLlmOpts,
): Promise<LlmCallResult> {
  const provider = getProviderForStep(step);
  const model = getModelForStep(step, provider);
  const maxTokens = getMaxTokensForStep(step, model);
  const enableThinking = shouldEnableThinking(step, provider, isDebugModeEnabled());
  const thinkingBudgetTokens = enableThinking ? getThinkingBudgetTokens() : undefined;

  const req = {
    step,
    provider,
    model,
    systemPrompt,
    userMessage,
    maxTokens,
    enableThinking: enableThinking || undefined,
    thinkingBudgetTokens,
    run_id: process.env["ASC_DEBUG_RUN_ID"],
  };
  const out = opts?.collector
    ? await callGatewayWithTracing(req, opts.role ?? "planejador", opts.collector)
    : await callGateway(req);

  return {
    content: out.content,
    reasoning: out.reasoning,
    tokens: { in: out.tokens.in, out: out.tokens.out, reasoning: out.tokens.reasoning },
    provider: out.provider,
    model: out.model,
  };
}

/**
 * callLlm — motor#28c dispatcher via gateway pra step `planejador`.
 */
export async function callLlm(
  systemPrompt: string,
  userMessage: string,
  opts?: CallLlmOpts,
): Promise<LlmCallResult> {
  return callViaGateway("planejador", systemPrompt, userMessage, opts);
}

/**
 * callHaiku — triage rerank Haiku (Bloco 4 #17), via gateway.
 *
 * Default agora é Infomaniak/mistral3 (small fast). Opt-in pra Anthropic Haiku
 * via HAIKU_TRIAGE_PROVIDER=anthropic.
 */
export async function callHaiku(
  systemPrompt: string,
  userMessage: string,
  opts?: CallLlmOpts,
): Promise<LlmCallResult> {
  return callViaGateway("haiku-triage", systemPrompt, userMessage, opts);
}

export async function callLlmMock(_systemPrompt: string, _userMessage: string): Promise<LlmCallResult> {
  return {
    content: JSON.stringify({
      strategicRationale: "Mock: contexto inicial, foco em receptividade.",
      contextHints: { language: "pt-br", mood: "receptive", urgency: "low" },
    }),
    tokens: { in: 0, out: 0, reasoning: 0 },
    provider: "infomaniak",
    model: "mock",
  };
}
