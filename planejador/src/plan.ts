import type { PlanTurnInput, PlanTurnOutput, CandidateAction } from "@ascendimacy/shared";
import { callLlm, callLlmMock } from "./llm-client.js";

function buildSystemPrompt(input: PlanTurnInput): string {
  const { persona, adquirente, inventory, state } = input;
  const inventoryList = inventory
    .map(p => `- ${p.id}: ${p.title} (sacrifício estimado: ${p.estimatedSacrifice}, confiança estimada: +${p.estimatedConfidenceGain})`)
    .join("\n");

  return `Você é o Planejador do motor Ascendimacy. Seu papel é estratégico: dado o contexto do sujeito e o estado da sessão, escolha 2-5 playbooks candidatos em ordem de prioridade.

SUJEITO: ${persona.name}, ${persona.age} anos
Perfil: ${JSON.stringify(persona.profile, null, 2)}

ADQUIRENTE (defaults de contexto):
${JSON.stringify(adquirente.defaults, null, 2)}

ESTADO DA SESSÃO:
- Trust level: ${state.trustLevel.toFixed(2)}
- Budget restante: ${state.budgetRemaining}
- Turno: ${state.turn}

PLAYBOOKS DISPONÍVEIS:
${inventoryList}

Responda APENAS com JSON COMPACTO (sem newlines extras). Máximo 2 candidateActions. strategicRationale max 80 chars. Formato:
{
  "strategicRationale": "string com raciocínio estratégico",
  "candidateActions": [
    {
      "playbookId": "id do playbook",
      "priority": 1,
      "rationale": "por que este playbook agora",
      "estimatedSacrifice": 0,
      "estimatedConfidenceGain": 0
    }
  ],
  "contextHints": {
    "language": "detectar da mensagem e perfil — valores: 'pt-br', 'pt-br limitado', 'pt-br basico', 'ja', 'en', etc."
  }
}

Instrução adicional: detecte a língua e proficiência do sujeito com base na mensagem recebida e no perfil. Registre em contextHints.language. Se o perfil indica falante não-nativo de pt-br (ex: japonês aprendendo), use 'pt-br limitado'. Se a mensagem está em outra língua, use essa língua. Default: 'pt-br'.`;
}

function parseOutput(raw: string): PlanTurnOutput {
  const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
  const parsed = JSON.parse(cleaned) as {
    strategicRationale?: string;
    candidateActions?: CandidateAction[];
    contextHints?: Record<string, unknown>;
  };
  return {
    strategicRationale: parsed.strategicRationale ?? "",
    candidateActions: parsed.candidateActions ?? [],
    contextHints: parsed.contextHints ?? {},
  };
}

export async function planTurn(input: PlanTurnInput): Promise<PlanTurnOutput> {
  const useMock = process.env["USE_MOCK_LLM"] === "true" || !process.env["ANTHROPIC_API_KEY"];
  const systemPrompt = buildSystemPrompt(input);
  const userMessage = `Mensagem recebida do sujeito: "${input.incomingMessage}"\n\nGere o plano estratégico.`;
  const raw = useMock
    ? await callLlmMock(systemPrompt, userMessage)
    : await callLlm(systemPrompt, userMessage);
  return parseOutput(raw);
}
