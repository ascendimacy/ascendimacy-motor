import OpenAI from "openai";

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

export async function callLlm(systemPrompt: string, userMessage: string): Promise<string> {
  const c = getClient();
  const model = process.env["MOTOR_DROTA_MODEL"] ?? "mistral24b";
  const response = await c.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    max_tokens: 512,
  });
  return response.choices[0]?.message?.content ?? "{}";
}

export async function callLlmMock(_systemPrompt: string, _userMessage: string): Promise<string> {
  return JSON.stringify({
    selectionRationale: "Mock: Icebreaker tem maior score ajustado ao trust_level inicial baixo.",
    linguisticMaterialization: "Olá! Que bom ter você aqui. Posso te apresentar algo que pode facilitar muito o seu dia?",
  });
}
