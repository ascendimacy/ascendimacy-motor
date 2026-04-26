/**
 * Motor-drota LLM client — motor#21 dual-provider (Anthropic + Infomaniak).
 *
 * Default: Infomaniak / Kimi K2.5. Override via env DROTA_PROVIDER + DROTA_MODEL.
 *
 * Spec: docs/specs/2026-04-24-debug-mode.md.
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
  tokens: {
    in: number;
    out: number;
    reasoning: number;
    /** motor#25: cache write (prefix sendo cacheado pela 1ª vez). */
    cacheCreation?: number;
    /** motor#25: cache read (prefix lido do cache, custo reduzido). */
    cacheRead?: number;
  };
  provider: LlmProvider;
  model: string;
}

/**
 * motor#21 dispatcher. Default: Infomaniak / Kimi K2.5. Anthropic via DROTA_PROVIDER=anthropic.
 *
 * motor#25 (handoff #24 Tarefa 2): aceita opcional cacheableSystemPrefix —
 * se passado e provider=anthropic, envia como system block array com
 * cache_control: ephemeral. callInfomaniak ignora (no-op — Infomaniak/OpenAI
 * fazem cache automático em prefixos consistentes).
 */
export async function callLlm(
  systemPrompt: string,
  userMessage: string,
  options: { cacheableSystemPrefix?: string } = {},
): Promise<LlmCallResult> {
  const provider = getProviderForStep("drota");
  if (provider === "anthropic") {
    const c = getAnthropic();
    const model = getModelForStep("drota", "anthropic");
    const maxTokens = getMaxTokensForStep("drota", model);
    const thinking = shouldEnableThinking("drota", "anthropic", isDebugModeEnabled());
    // motor#25: se cacheableSystemPrefix foi passado, usa block array com cache_control.
    // Senão, system string direto (compat anterior).
    const systemValue: Anthropic.MessageCreateParams["system"] = options.cacheableSystemPrefix
      ? ([
          {
            type: "text",
            text: options.cacheableSystemPrefix,
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: systemPrompt },
        ] as unknown as Anthropic.MessageCreateParams["system"])
      : systemPrompt;
    const params: Anthropic.MessageCreateParams = {
      model,
      max_tokens: maxTokens,
      system: systemValue,
      messages: [{ role: "user", content: userMessage }],
    };
    if (thinking) {
      (params as Anthropic.MessageCreateParams & { thinking?: unknown }).thinking = {
        type: "enabled",
        budget_tokens: getThinkingBudgetTokens(),
      };
    }
    const r = await c.messages.create(params, {
      timeout: getLlmTimeoutMs("drota"),
      maxRetries: getLlmMaxRetries("drota"),
    });
    let content = "";
    let reasoning: string | undefined;
    for (const block of r.content) {
      if (block.type === "text") content += block.text;
      else if ((block as { type: string }).type === "thinking") {
        reasoning = (block as { thinking?: string }).thinking;
      }
    }
    const usage = r.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    return {
      content: content || "{}",
      reasoning,
      tokens: {
        in: usage.input_tokens,
        out: usage.output_tokens,
        reasoning: 0,
        cacheCreation: usage.cache_creation_input_tokens,
        cacheRead: usage.cache_read_input_tokens,
      },
      provider: "anthropic",
      model,
    };
  }
  // Infomaniak (default)
  // motor#25: pra Infomaniak, concatena prefix+dynamic em system string única.
  // OpenAI-compat fazem prefix caching automático (>1024 tokens). Não tem
  // parameter explícito tipo cache_control — confiamos na consistência do prefix.
  const c = getOpenAI();
  const model = getModelForStep("drota", "infomaniak");
  const maxTokens = getMaxTokensForStep("drota", model);
  const fullSystem = options.cacheableSystemPrefix
    ? options.cacheableSystemPrefix + "\n\n" + systemPrompt
    : systemPrompt;
  const r = await c.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: fullSystem },
        { role: "user", content: userMessage },
      ],
      max_tokens: maxTokens,
    },
    {
      timeout: getLlmTimeoutMs("drota"),
      maxRetries: getLlmMaxRetries("drota"),
    },
  );
  const msg = r.choices[0]?.message;
  const content = msg?.content ?? "";
  const reasoning = (msg as { reasoning?: string } | undefined)?.reasoning;
  const usage = r.usage as
    | {
        prompt_tokens: number;
        completion_tokens: number;
        prompt_tokens_details?: { cached_tokens?: number };
      }
    | undefined;
  return {
    content: content || "{}",
    reasoning,
    tokens: {
      in: usage?.prompt_tokens ?? 0,
      out: usage?.completion_tokens ?? 0,
      reasoning: 0,
      // OpenAI-compat reporta cached_tokens em prompt_tokens_details quando aplicável
      cacheRead: usage?.prompt_tokens_details?.cached_tokens,
    },
    provider: "infomaniak",
    model,
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
