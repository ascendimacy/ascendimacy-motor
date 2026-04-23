import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
  }
  return client;
}

export async function callLlm(systemPrompt: string, userMessage: string): Promise<string> {
  const c = getClient();
  const model = process.env["PLANEJADOR_MODEL"] ?? "claude-sonnet-4-6";
  const response = await c.messages.create({
    model,
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from LLM");
  return block.text;
}

export async function callLlmMock(_systemPrompt: string, _userMessage: string): Promise<string> {
  return JSON.stringify({
    strategicRationale: "Mock: contexto inicial, usuário se apresentou. Foco em receptividade.",
    candidateActions: [
      { playbookId: "icebreaker.primeiro-contato", priority: 1, rationale: "Primeira interação", estimatedSacrifice: 1, estimatedConfidenceGain: 4 },
      { playbookId: "onboarding.apresentacao-produto", priority: 2, rationale: "Momento certo para apresentar", estimatedSacrifice: 2, estimatedConfidenceGain: 3 },
    ],
    contextHints: { mood: "receptive", urgency: "low" },
  });
}
