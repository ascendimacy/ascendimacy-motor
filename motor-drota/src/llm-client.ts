import OpenAI from "openai";
import { getLlmTimeoutMs, getLlmMaxRetries } from "@ascendimacy/shared";

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

export interface LlmCallResult {
  content: string;
  reasoning?: string;
  tokens: { in: number; out: number; reasoning: number };
}

/**
 * motor#19: bump max_tokens 512→2048 (4096 quando reasoning model detectado).
 * Captura campo `reasoning` expostos por modelos OpenAI-compat reasoning
 * (Kimi K2.5, DeepSeek-R1 via Infomaniak).
 */
export async function callLlm(systemPrompt: string, userMessage: string): Promise<LlmCallResult> {
  const c = getClient();
  const model = process.env["MOTOR_DROTA_MODEL"] ?? "mistral24b";
  // Heurística simples: modelos reasoning drenam tokens em CoT. Se nome sugere
  // reasoning, dobra o budget pra deixar espaço pro content visível.
  const isReasoningModel = /kimi|deepseek-r|o1|o3|reason/i.test(model);
  const maxTokens = isReasoningModel ? 4096 : 2048;

  // motor#20: timeout + retries explícitos.
  // OpenAI SDK retries 408/409/429/5xx automaticamente.
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
      timeout: getLlmTimeoutMs("drota"),
      maxRetries: getLlmMaxRetries("drota"),
    },
  );

  const msg = response.choices[0]?.message;
  const content = msg?.content ?? "";
  // `reasoning` é campo não-standard expostos por Infomaniak em modelos reasoning.
  const reasoning = (msg as { reasoning?: string } | undefined)?.reasoning;

  const usage = response.usage;
  return {
    content: content || "{}",
    reasoning,
    tokens: {
      in: usage?.prompt_tokens ?? 0,
      out: usage?.completion_tokens ?? 0,
      reasoning: 0, // Infomaniak não separa reasoning_tokens; fica embutido no completion
    },
  };
}

export async function callLlmMock(_systemPrompt: string, _userMessage: string): Promise<LlmCallResult> {
  return {
    content: JSON.stringify({
      selectionRationale: "Mock: Icebreaker tem maior score ajustado ao trust_level inicial baixo.",
      linguisticMaterialization:
        "Olá! Que bom ter você aqui. Posso te apresentar algo que pode facilitar muito o seu dia?",
    }),
    tokens: { in: 0, out: 0, reasoning: 0 },
  };
}
