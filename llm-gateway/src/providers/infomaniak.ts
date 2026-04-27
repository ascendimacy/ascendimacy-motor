/**
 * Infomaniak provider — wraps OpenAI SDK with Infomaniak baseURL (motor#28a).
 *
 * Auto-cache: Infomaniak detecta prefixos idênticos por API key.
 * `cacheableSystemPrefix` é prepended ao systemPrompt (concat) — não há
 * cache_control explícito como em Anthropic.
 */

import OpenAI from "openai";
import type { ChatCompletionInput, ProviderCallResult, ProviderClient } from "../types.js";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env["INFOMANIAK_API_KEY"] ?? "mock",
      baseURL: process.env["INFOMANIAK_BASE_URL"] ?? "https://api.infomaniak.com/1/ai",
    });
  }
  return client;
}

/** For tests — inject a mock SDK. */
export function _setClientForTests(c: OpenAI | null): void {
  client = c;
}

export const infomaniakProvider: ProviderClient = {
  async call(req: ChatCompletionInput, model: string): Promise<ProviderCallResult> {
    const c = getClient();
    const maxTokens = req.maxTokens ?? 2048;

    const fullSystem = req.cacheableSystemPrefix
      ? req.cacheableSystemPrefix + "\n\n" + req.systemPrompt
      : req.systemPrompt;

    const t0 = Date.now();
    const r = await c.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: fullSystem },
          { role: "user", content: req.userMessage },
        ],
        max_tokens: maxTokens,
      },
      { timeout: 60_000, maxRetries: 0 },
    );
    const latency_ms = Date.now() - t0;

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
        cacheRead: usage?.prompt_tokens_details?.cached_tokens,
      },
      model,
      latency_ms,
    };
  },
};
