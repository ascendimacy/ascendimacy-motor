/**
 * Motor-drota LLM client — motor#28b: routes via llm-gateway (MCP).
 *
 * ANTES (motor#21+25): instanciava SDK Anthropic/OpenAI direto, com lógica
 * própria de timeout/retry e cache_control wiring.
 *
 * AGORA (motor#28b): chama `callGateway()` (do shared). Gateway centraliza
 * retry, fallback, undici Agent IPv4-first, NDJSON logging. cache_control
 * + reasoning forward são preservados via `cacheableSystemPrefix` no input
 * do gateway.
 *
 * API pública (`callLlm`, `callLlmMock`) inalterada — drop-in pra evaluate.ts.
 */

import {
  callGateway,
  isDebugModeEnabled,
  getProviderForStep,
  getModelForStep,
  getMaxTokensForStep,
  shouldEnableThinking,
  getThinkingBudgetTokens,
  type LlmProvider,
} from "@ascendimacy/shared";

export interface LlmCallResult {
  content: string;
  reasoning?: string;
  tokens: {
    in: number;
    out: number;
    reasoning: number;
    cacheCreation?: number;
    cacheRead?: number;
  };
  provider: LlmProvider;
  model: string;
}

/**
 * motor#28b: motor-drota chama gateway via MCP. Gateway resolve provider,
 * faz retry/fallback/bucket, chama SDK efetivo e retorna resposta unificada.
 *
 * Aceita `cacheableSystemPrefix` (motor#25) — gateway forward transparente
 * pro provider efetivo (Anthropic via cache_control bloco array, Infomaniak
 * via concat string).
 */
export async function callLlm(
  systemPrompt: string,
  userMessage: string,
  options: { cacheableSystemPrefix?: string } = {},
): Promise<LlmCallResult> {
  const provider = getProviderForStep("drota");
  const model = getModelForStep("drota", provider);
  const maxTokens = getMaxTokensForStep("drota", model);
  const enableThinking = shouldEnableThinking("drota", provider, isDebugModeEnabled());
  const thinkingBudgetTokens = enableThinking ? getThinkingBudgetTokens() : undefined;

  const out = await callGateway({
    step: "drota",
    provider,
    model,
    systemPrompt,
    cacheableSystemPrefix: options.cacheableSystemPrefix,
    userMessage,
    maxTokens,
    enableThinking: enableThinking || undefined,
    thinkingBudgetTokens,
    run_id: process.env["ASC_DEBUG_RUN_ID"],
  });

  return {
    content: out.content,
    reasoning: out.reasoning,
    tokens: {
      in: out.tokens.in,
      out: out.tokens.out,
      reasoning: out.tokens.reasoning,
      cacheCreation: out.tokens.cacheCreation,
      cacheRead: out.tokens.cacheRead,
    },
    provider: out.provider,
    model: out.model,
  };
}

export async function callLlmMock(
  _systemPrompt: string,
  _userMessage: string,
  _options?: { cacheableSystemPrefix?: string },
): Promise<LlmCallResult> {
  return {
    content: JSON.stringify({
      selectionRationale: "Mock: Icebreaker tem maior score ajustado ao trust_level inicial baixo.",
      linguisticMaterialization:
        "Olá! Que bom ter você aqui. Posso te apresentar algo que pode facilitar muito o seu dia?",
    }),
    tokens: { in: 0, out: 0, reasoning: 0 },
    provider: "infomaniak",
    model: "mock",
  };
}
