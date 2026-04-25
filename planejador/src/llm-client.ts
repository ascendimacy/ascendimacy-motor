import Anthropic from "@anthropic-ai/sdk";
import { isDebugModeEnabled } from "@ascendimacy/shared";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
  }
  return client;
}

export interface LlmCallResult {
  content: string;
  reasoning?: string;
  tokens: { in: number; out: number; reasoning: number };
}

/**
 * callLlm — planejador (Sonnet 4.6).
 *
 * motor#19: bump max_tokens 200→2048 (pré-reasoning-model era apertado).
 * Extended thinking habilitado em debug mode (budget 1024).
 */
export async function callLlm(
  systemPrompt: string,
  userMessage: string,
): Promise<LlmCallResult> {
  const c = getClient();
  const model = process.env["PLANEJADOR_MODEL"] ?? "claude-sonnet-4-6";
  const debug = isDebugModeEnabled();

  const params: Anthropic.MessageCreateParams = {
    model,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };

  if (debug) {
    (params as Anthropic.MessageCreateParams & { thinking?: unknown }).thinking = {
      type: "enabled",
      budget_tokens: 1024,
    };
  }

  const response = await c.messages.create(params);

  let content = "";
  let reasoning: string | undefined;
  for (const block of response.content) {
    if (block.type === "text") {
      content += block.text;
    } else if ((block as { type: string }).type === "thinking") {
      reasoning = (block as { thinking?: string }).thinking;
    }
  }
  if (!content) {
    throw new Error("Unexpected response: no text block from LLM");
  }
  const usage = response.usage as {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  return {
    content,
    reasoning,
    tokens: {
      in: usage.input_tokens,
      out: usage.output_tokens,
      reasoning: 0, // thinking_tokens não separado no SDK atual; fica embutido em output
    },
  };
}

/**
 * Haiku chamado pra triagem parental (Bloco 4 #17). Reuso do client global.
 * Modelo default `claude-haiku-4-5-20251001`. Curto (512 tokens) — rerank only.
 *
 * motor#19: bump 150→512; thinking OFF (safety-critical, determinístico-ish).
 */
export async function callHaiku(
  systemPrompt: string,
  userMessage: string,
): Promise<LlmCallResult> {
  const c = getClient();
  const model = process.env["HAIKU_MODEL"] ?? "claude-haiku-4-5-20251001";
  const response = await c.messages.create({
    model,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  let content = "";
  for (const block of response.content) {
    if (block.type === "text") content += block.text;
  }
  if (!content) throw new Error("Unexpected response: no text block from Haiku");
  const usage = response.usage as { input_tokens: number; output_tokens: number };
  return {
    content,
    tokens: { in: usage.input_tokens, out: usage.output_tokens, reasoning: 0 },
  };
}

/**
 * Mock: planejador Bloco 2a devolve só rationale + hints.
 * Scoring de conteúdo é determinístico, fora do LLM.
 */
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
  };
}
