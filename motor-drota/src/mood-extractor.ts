/**
 * Mood Extractor — produtor de MoodReading absoluto via LLM v0
 * com fallback rule-based em distress markers.
 *
 * Estratégia (DT-MOOD-02, Jun 2026-04-27):
 * 1. Tenta LLM (callGateway com step "mood-extractor", Mistral3 default).
 *    Prompt curto pede JSON {score: 1-10, rationale}. Parse + clamp.
 * 2. Se LLM lança erro OU JSON inválido OU score fora do range:
 *    fallback rule-based (regex distress PT/JA + monossilábicos seguidos).
 *
 * Defesa em camadas: clampMoodScore() do shared/mood sanitiza qualquer
 * número arbitrário (NaN, decimal, fora-do-range) pro range válido.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-27-statevector-primitives-inventory-f1.md §2
 * Sub-issue: ascendimacy-motor#35 PART B
 */

import {
  callGateway,
  clampMoodScore,
  MOOD_DEFAULT,
} from "@ascendimacy/shared";
import type { MoodReading } from "@ascendimacy/shared";

export interface MoodExtractInput {
  /** Texto do usuário a analisar (último turn da criança). */
  userText: string;
  /**
   * Histórico recente opcional pra context (1-3 turns prévios).
   * role 'user' = criança; 'assistant' = bot.
   */
  recentHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Run id pra trace propagation no gateway logger. */
  run_id?: string;
}

export interface MoodExtractResult extends MoodReading {
  /** Justificativa LLM ou marker rule-based que disparou. */
  rationale: string;
  /** True se LLM falhou e fallback rule-based foi usado. */
  fallback_used: boolean;
}

const SYSTEM_PROMPT = `Você é um avaliador silencioso de humor infantil em conversas educacionais.

Tarefa: ler a fala da criança e estimar o humor numa escala de 1 a 10:
- 1-2: muito mal (irritado, triste, querendo sair)
- 3: cansado/desinteressado (gate de comfort track — bot deve recuar)
- 4-6: neutro/ok
- 7-8: bem, engajado
- 9-10: ótimo, animado

Responda APENAS em JSON estrito, sem markdown, sem texto fora do JSON:
{"score": <integer 1-10>, "rationale": "<frase curta de até 80 caracteres>"}`;

/**
 * Distress markers — PT-BR e JA. Match em qualquer = mood 2 (low).
 *
 * PT: irritado/triste, querer sair, tédio explícito.
 * JA: 疲 (cansaço), 嫌 (recusa), もういい (chega), さよなら/owari (despedida), つまらん (sem graça).
 *
 * Heurística é tosca por design — refino vira sub-issue F+1 quando
 * piloto Yuji gerar dados reais.
 */
const DISTRESS_PATTERNS: RegExp[] = [
  /\b(t[ôo]\s+mal|t[ôo]\s+triste|estou\s+mal|n[ãa]o\s+quero|chato|t[ée]dio|cansad[oa]|preciso\s+ir|tchau|n[ãa]o\s+t[ôo]\s+afim)\b/i,
  /(疲|つかれ|嫌|やだ|もういい|つまらん|さよなら|sayonara|owari)/i,
];

/** Limiar pra detectar resposta "fechada" (várias palavras curtas em texto curto). */
const SHORT_WORD_THRESHOLD = 2;
const MAX_WORDS_FOR_LOW_ENGAGEMENT = 6;

/**
 * Extrai mood absoluto. Sempre retorna MoodExtractResult válido —
 * nunca lança (LLM error → fallback; fallback sempre produz score).
 */
export async function extractMood(
  input: MoodExtractInput,
  options: { now?: () => string } = {},
): Promise<MoodExtractResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const at = now();

  try {
    const llm = await extractMoodViaLLM(input);
    if (llm) {
      return {
        score: llm.score,
        at,
        source: "llm",
        rationale: llm.rationale,
        fallback_used: false,
      };
    }
    // LLM retornou null (parse falhou) → fallback
  } catch {
    // LLM lançou (timeout, network, etc.) → fallback
  }

  const rule = scoreByRules(input.userText);
  return {
    score: rule.score,
    at,
    source: "rule_based",
    rationale: rule.rationale,
    fallback_used: true,
  };
}

async function extractMoodViaLLM(
  input: MoodExtractInput,
): Promise<{ score: number; rationale: string } | null> {
  const historyText =
    input.recentHistory && input.recentHistory.length > 0
      ? input.recentHistory
          .map(
            (t) => `${t.role === "user" ? "Criança" : "Bot"}: ${t.content}`,
          )
          .join("\n")
      : "";

  const userMessage = historyText
    ? `Última fala da criança:\n"${input.userText}"\n\nContext (turns recentes):\n${historyText}\n\nResponda em JSON.`
    : `Última fala da criança:\n"${input.userText}"\n\nResponda em JSON.`;

  const result = await callGateway({
    step: "mood-extractor",
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: 256,
    run_id: input.run_id,
  });

  return parseJsonResponse(result.content);
}

function parseJsonResponse(
  text: string,
): { score: number; rationale: string } | null {
  try {
    const cleaned = text
      .replace(/```(?:json)?\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]);
    if (typeof obj.score !== "number") return null;
    const score = clampMoodScore(obj.score);
    const rationale =
      typeof obj.rationale === "string" ? obj.rationale.slice(0, 200) : "";
    return { score, rationale };
  } catch {
    return null;
  }
}

/**
 * Fallback rule-based. Retorna score determinístico baseado em sinais
 * superficiais do texto.
 *
 * Ordem (primeira regra que casa, vence):
 * 1. Distress marker (PT ou JA) → 2 (low)
 * 2. Texto vazio/whitespace → MOOD_DEFAULT
 * 3. 1 palavra muito curta ("ok", "sim", "n") → 4 (slightly low)
 * 4. Várias palavras curtas seguidas em texto curto → 4
 * 5. Default → MOOD_DEFAULT (5, neutro)
 *
 * Escolhi não tentar inferir "alto" via heurística porque sinais positivos
 * são ambíguos sem context (LLM faz isso melhor). Rule-based só protege
 * contra LLM ausente em casos onde detecção de baixo importa (comfort gate).
 */
export function scoreByRules(text: string): {
  score: number;
  rationale: string;
} {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { score: MOOD_DEFAULT, rationale: "fallback: texto vazio" };
  }

  for (const pattern of DISTRESS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        score: 2,
        rationale: "fallback: distress marker detectado",
      };
    }
  }

  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 1 && words[0]!.length <= 3) {
    return {
      score: 4,
      rationale: "fallback: resposta monossilábica curta",
    };
  }

  const shortCount = words.filter((w) => w.length <= 2).length;
  if (
    shortCount >= SHORT_WORD_THRESHOLD &&
    words.length < MAX_WORDS_FOR_LOW_ENGAGEMENT
  ) {
    return {
      score: 4,
      rationale: "fallback: várias palavras curtas em texto curto",
    };
  }

  return {
    score: MOOD_DEFAULT,
    rationale: "fallback: sem signal claro, default neutro",
  };
}
