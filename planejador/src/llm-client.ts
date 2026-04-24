import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
  }
  return client;
}

export async function callLlm(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const c = getClient();
  const model = process.env["PLANEJADOR_MODEL"] ?? "claude-sonnet-4-6";
  const response = await c.messages.create({
    model,
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from LLM");
  return block.text;
}

/**
 * Mock: planejador Bloco 2a devolve só rationale + hints.
 * Scoring de conteúdo é determinístico, fora do LLM.
 */
export async function callLlmMock(
  _systemPrompt: string,
  _userMessage: string,
): Promise<string> {
  return JSON.stringify({
    strategicRationale: "Mock: contexto inicial, foco em receptividade.",
    contextHints: { language: "pt-br", mood: "receptive", urgency: "low" },
  });
}
