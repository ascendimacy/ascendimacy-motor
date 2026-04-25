/**
 * Planejador LLM client — motor#21 dual-provider (Anthropic + Infomaniak).
 *
 * Provider escolhido per-callsite via env:
 *   PLANEJADOR_PROVIDER=anthropic|infomaniak (default: infomaniak)
 *   PLANEJADOR_MODEL=...                     (default: moonshotai/Kimi-K2.5)
 *   HAIKU_TRIAGE_PROVIDER=...
 *   HAIKU_TRIAGE_MODEL=...                   (default: mistral3)
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-24-debug-mode.md (router extension).
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  isDebugModeEnabled,
  getLlmTimeoutMs,
  getLlmMaxRetries,
  getProviderForStep,
  getModelForStep,
  getMaxTokensForStep,
  shouldEnableThinking,
  getThinkingBudgetTokens,
  type LlmProvider,
} from "@ascendimacy/shared";

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
  }
  return anthropicClient;
}

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env["INFOMANIAK_API_KEY"] ?? "mock",
      baseURL: process.env["INFOMANIAK_BASE_URL"] ?? "https://api.infomaniak.com/1/ai",
    });
  }
  return openaiClient;
}

export interface LlmCallResult {
  content: string;
  reasoning?: string;
  tokens: { in: number; out: number; reasoning: number };
  /** Provider efetivamente usado (útil pra debug log). */
  provider: LlmProvider;
  /** Model efetivamente usado. */
  model: string;
}

async function callAnthropic(
  step: string,
  systemPrompt: string,
  userMessage: string,
): Promise<LlmCallResult> {
  const c = getAnthropic();
  const model = getModelForStep(step, "anthropic");
  const maxTokens = getMaxTokensForStep(step, model);
  const thinking = shouldEnableThinking(step, "anthropic", isDebugModeEnabled());

  const params: Anthropic.MessageCreateParams = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };
  if (thinking) {
    (params as Anthropic.MessageCreateParams & { thinking?: unknown }).thinking = {
      type: "enabled",
      budget_tokens: getThinkingBudgetTokens(),
    };
  }

  const response = await c.messages.create(params, {
    timeout: getLlmTimeoutMs(step),
    maxRetries: getLlmMaxRetries(step),
  });

  let content = "";
  let reasoning: string | undefined;
  for (const block of response.content) {
    if (block.type === "text") content += block.text;
    else if ((block as { type: string }).type === "thinking") {
      reasoning = (block as { thinking?: string }).thinking;
    }
  }
  if (!content) {
    throw new Error("Unexpected response: no text block from Anthropic");
  }
  const usage = response.usage as { input_tokens: number; output_tokens: number };
  return {
    content,
    reasoning,
    tokens: { in: usage.input_tokens, out: usage.output_tokens, reasoning: 0 },
    provider: "anthropic",
    model,
  };
}

async function callInfomaniak(
  step: string,
  systemPrompt: string,
  userMessage: string,
): Promise<LlmCallResult> {
  const c = getOpenAI();
  const model = getModelForStep(step, "infomaniak");
  const maxTokens = getMaxTokensForStep(step, model);

  const response = await c.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: maxTokens,
    },
    {
      timeout: getLlmTimeoutMs(step),
      maxRetries: getLlmMaxRetries(step),
    },
  );

  const msg = response.choices[0]?.message;
  const content = msg?.content ?? "";
  const reasoning = (msg as { reasoning?: string } | undefined)?.reasoning;
  const usage = response.usage;
  return {
    content: content || "{}",
    reasoning,
    tokens: {
      in: usage?.prompt_tokens ?? 0,
      out: usage?.completion_tokens ?? 0,
      reasoning: 0,
    },
    provider: "infomaniak",
    model,
  };
}

/**
 * callLlm — motor#21 dispatcher pelo provider escolhido pra `planejador`.
 */
export async function callLlm(
  systemPrompt: string,
  userMessage: string,
): Promise<LlmCallResult> {
  const provider = getProviderForStep("planejador");
  if (provider === "anthropic") {
    return callAnthropic("planejador", systemPrompt, userMessage);
  }
  return callInfomaniak("planejador", systemPrompt, userMessage);
}

/**
 * callHaiku — triage rerank Haiku (Bloco 4 #17).
 *
 * Default agora é Infomaniak/mistral3 (small fast). Opt-in pra Anthropic Haiku
 * via HAIKU_TRIAGE_PROVIDER=anthropic.
 */
export async function callHaiku(
  systemPrompt: string,
  userMessage: string,
): Promise<LlmCallResult> {
  const provider = getProviderForStep("haiku-triage");
  if (provider === "anthropic") {
    return callAnthropic("haiku-triage", systemPrompt, userMessage);
  }
  return callInfomaniak("haiku-triage", systemPrompt, userMessage);
}

export async function callLlmMock(
  _systemPrompt: string,
  _userMessage: string,
): Promise<LlmCallResult> {
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
