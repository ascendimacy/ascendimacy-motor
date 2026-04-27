/**
 * Anthropic provider — wraps SDK call with prompt cache support (motor#28a).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ChatCompletionInput, ProviderCallResult, ProviderClient } from "../types.js";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
  return client;
}

/** For tests — inject a mock SDK. */
export function _setClientForTests(c: Anthropic | null): void {
  client = c;
}

export const anthropicProvider: ProviderClient = {
  async call(req: ChatCompletionInput, model: string): Promise<ProviderCallResult> {
    const c = getClient();
    const maxTokens = req.maxTokens ?? 2048;

    const systemValue: Anthropic.MessageCreateParams["system"] = req.cacheableSystemPrefix
      ? ([
          {
            type: "text",
            text: req.cacheableSystemPrefix,
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: req.systemPrompt },
        ] as unknown as Anthropic.MessageCreateParams["system"])
      : req.systemPrompt;

    const params: Anthropic.MessageCreateParams = {
      model,
      max_tokens: maxTokens,
      system: systemValue,
      messages: [{ role: "user", content: req.userMessage }],
    };
    if (req.enableThinking) {
      (params as Anthropic.MessageCreateParams & { thinking?: unknown }).thinking = {
        type: "enabled",
        budget_tokens: req.thinkingBudgetTokens ?? 1024,
      };
    }

    const t0 = Date.now();
    // Per-attempt timeout/retry handled by retry layer above. SDK retries=0.
    const r = await c.messages.create(params, { timeout: 60_000, maxRetries: 0 });
    const latency_ms = Date.now() - t0;

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
      model,
      latency_ms,
    };
  },
};
