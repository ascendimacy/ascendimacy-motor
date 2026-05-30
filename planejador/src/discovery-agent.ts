/**
 * Discovery Agent v0.2.8 — gera opções de pergunta aberta para fase de descoberta.
 *
 * Quando o Tutor emite `move_type=discover`, este agent faz chamada LLM extra
 * que retorna N opções de pergunta/probe ancoradas no histórico recente +
 * sinais detectados + necessidades latentes parentais.
 *
 * Motivação: STS realista mostrou que o materializer LLM ignora MOVIMENTO:
 * descobrir e empurra conteúdo do contentPool estático. Solução: dar ao
 * materializer um pool DIFERENTE — questões de descoberta em vez de items
 * de conteúdo — quando o move é discover.
 *
 * Spec base: 2026-05-25-session-phases-journey-stages-strategist.md
 *            + 2026-05-25-subject-knowledge-bridge.md
 *
 * Arquitetura: chamada single-LLM stateless. Sem retry sofisticado.
 * Fallback determinístico (lista hardcoded) quando LLM falhar.
 */

import { callLlm, callLlmMock } from "./llm-client.js";
import { shouldUseMockLlm } from "@ascendimacy/shared";

export type DiscoveryOptionKind =
  | "interest_probe"     // pergunta sobre algo que o sujeito mencionou
  | "gap_check"          // identifica algo não-mencionado pra explorar
  | "agency_offer"       // convida o sujeito a propor direção
  | "value_observation"  // pergunta como mede algo importante
  | "bridge_to_artifact"; // refere o baralho ou outro artefato concreto

export interface DiscoveryOption {
  /** Tipo de probe (semântica pra trace/selector). */
  kind: DiscoveryOptionKind;
  /** Texto da pergunta/probe — proposta para o materializer formular ao redor. */
  text: string;
  /** Tópico/conceito ao qual o probe ancora (do que o sujeito disse). */
  anchor: string;
}

export interface DiscoveryAgentInput {
  /** Histórico recente da conversa (últimos N turns). */
  recentTurns: Array<{ role: "user" | "assistant"; content: string }>;
  /** Sinais extraídos do turn atual. */
  extractedSignals: string[];
  /** Necessidades latentes do perfil parental. */
  latentNeeds: string[];
  /** Tópicos já mencionados pelo sujeito. */
  topicMentions: string[];
  /** Mensagem mais recente do sujeito. */
  incomingMessage?: string;
  /** Nome do sujeito (pra contexto humano). */
  subjectName: string;
}

/**
 * Fallback determinístico — usado quando LLM falha OU em mock mode.
 * 5 opções genéricas mas semanticamente válidas, ancoradas no incomingMessage
 * ou em tópicos comuns.
 */
function buildFallbackOptions(input: DiscoveryAgentInput): DiscoveryOption[] {
  const lastTopic = input.topicMentions[0] ?? "o que você trouxe";
  const subj = input.subjectName;
  return [
    {
      kind: "interest_probe",
      text: `Você falou de ${lastTopic} — me conta uma vez em que isso te fez sentir vivo?`,
      anchor: lastTopic,
    },
    {
      kind: "agency_offer",
      text: `${subj}, qual parte disso vale a pena a gente explorar primeiro?`,
      anchor: "agency",
    },
    {
      kind: "gap_check",
      text: `Tem alguma coisa que te incomoda e que ninguém parou pra ouvir ainda?`,
      anchor: "unspoken",
    },
    {
      kind: "value_observation",
      text: `Quando você sabe que algo deu certo — qual é a marca disso pra você?`,
      anchor: "self_measure",
    },
    {
      kind: "bridge_to_artifact",
      text: `Quer pegar o baralho de virtudes e ver qual carta combina com isso que você tá descrevendo?`,
      anchor: "baralho",
    },
  ];
}

/**
 * Tenta parsear JSON do LLM. Defensive — vários LLMs adicionam
 * texto antes/depois do array.
 */
function parseDiscoveryOptions(raw: string): DiscoveryOption[] | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  // Tenta achar um array JSON no meio do texto
  const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  const candidate = arrayMatch ? arrayMatch[0] : cleaned;
  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return null;
    const out: DiscoveryOption[] = [];
    for (const item of parsed) {
      if (typeof item?.kind === "string" && typeof item?.text === "string" && typeof item?.anchor === "string") {
        out.push({
          kind: item.kind as DiscoveryOptionKind,
          text: item.text,
          anchor: item.anchor,
        });
      }
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function buildSystemPrompt(input: DiscoveryAgentInput): string {
  return `Você é o Discovery Agent do Ascendimacy. Seu papel: gerar 5 opções de PERGUNTA ABERTA pra um tutor usar com um sujeito jovem (provavelmente 10-14 anos) durante a FASE DE DESCOBERTA.

REGRAS ABSOLUTAS:
- NÃO gere conteúdo educacional, fatos, metáforas ou conceitos a ensinar
- NÃO seja terapeuta nem psicólogo — sem framing "como você se sente"
- Cada opção é UMA PERGUNTA curta + ancorada
- Variedade obrigatória entre os 5 kinds disponíveis

KINDS DISPONÍVEIS:
- interest_probe: pergunta sobre algo que o sujeito mencionou
- gap_check: identifica algo não-mencionado pra explorar
- agency_offer: convida o sujeito a propor direção
- value_observation: pergunta como o sujeito mede algo importante
- bridge_to_artifact: refere o baralho de 4 virtudes que ele recebeu

CONTEXTO DO SUJEITO:
Nome: ${input.subjectName}
Tópicos já mencionados: ${input.topicMentions.length > 0 ? input.topicMentions.join(", ") : "(ainda nenhum)"}
Necessidades latentes (parental input): ${input.latentNeeds.length > 0 ? input.latentNeeds.slice(0, 4).join("; ") : "(nenhuma declarada)"}
Sinais extraídos do turn atual: ${input.extractedSignals.length > 0 ? input.extractedSignals.join(", ") : "(nenhum)"}
Mensagem mais recente do sujeito: "${input.incomingMessage ?? ""}"

OUTPUT — RETORNE APENAS JSON ARRAY com 5 opções:
[
  { "kind": "interest_probe", "text": "...", "anchor": "..." },
  { "kind": "gap_check", "text": "...", "anchor": "..." },
  { "kind": "agency_offer", "text": "...", "anchor": "..." },
  { "kind": "value_observation", "text": "...", "anchor": "..." },
  { "kind": "bridge_to_artifact", "text": "...", "anchor": "..." }
]`;
}

/**
 * Gera opções de descoberta via chamada LLM (ou fallback se falhar).
 * Sempre retorna ≥3 opções (fallback se LLM gerar lixo).
 */
export async function generateDiscoveryOptions(
  input: DiscoveryAgentInput,
): Promise<DiscoveryOption[]> {
  const useMock = shouldUseMockLlm("planejador");
  if (useMock) {
    return buildFallbackOptions(input);
  }

  const systemPrompt = buildSystemPrompt(input);
  const userMessage = `Gere 5 opções de pergunta aberta, em JSON array.`;

  try {
    const result = await callLlm(systemPrompt, userMessage);
    const parsed = parseDiscoveryOptions(result.content);
    if (parsed && parsed.length >= 3) {
      return parsed;
    }
    // LLM gerou lixo — fallback
    return buildFallbackOptions(input);
  } catch {
    // Network/timeout/etc — fallback determinístico
    return buildFallbackOptions(input);
  }
}
