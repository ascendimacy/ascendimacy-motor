/**
 * Unified Assessor — substitui signal-extractor + mood-extractor + Environment
 * Assessor (motor-drota-v1 §2.1) em UMA chamada Haiku.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-28-motor-simplificacao-llm-spec-v1.md §3
 *
 * Estratégia (DS-06, DS-07, DS-08):
 *   1. Rule-based pre-pass sobre raw text (regex distress/exit/monosyllabic).
 *      Cobre ~70% dos casos sem LLM. Confidence high → retorna direto.
 *   2. Quando rule-based retorna null (ambíguo): chama Haiku via gateway com
 *      JSON estruturado pedindo signals + mood + engagement em 1 shot.
 *   3. Haiku falhar / JSON inválido → fallback degradado (mood=5 conservador,
 *      signals=[], engagement=medium, mood_method='rule', method='fallback').
 *
 * DT-SIM-01 (Jun, 28-abr): vocabulário de signals da spec (12 itens) diverge
 * do código (15 SEMANTIC_SIGNALS canônicos). Decisão CC: usar 15 canônicos
 * (compat com Trigger Evaluator + transitions.yaml). Mapping spec→canon:
 *   spec.explicit_distress  → canon.distress_marker_high
 *   spec.crying_marker      → canon.distress_marker_high
 *   spec.enthusiasm_high    → heurística text-based (sem signal canônico)
 *   spec.monosyllabic       → heurística text-based
 *   spec.exit_marker_*      → heurística text-based + canon.deflection_thematic
 *   spec.engagement_*       → derivado dos canônicos
 *   spec.trust_signal       → não mapeado (trust vem de trust-calculator)
 *   spec.topic_initiated    → canon.voluntary_topic_deepening (próximo)
 */

import {
  callGateway,
  isSemanticSignal,
} from "@ascendimacy/shared";
import type { SemanticSignal, EngagementLevel } from "@ascendimacy/shared";

// ─────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────

export type MoodConfidence = "high" | "medium" | "low";
export type MoodMethod = "rule" | "llm" | "fallback";
export type AssessmentMethod = "unified_haiku" | "rule_only" | "fallback";

export interface AssessorTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssessorInput {
  /** Mensagem atual do sujeito. */
  message: string;
  /** Últimos 5 turns (mensagem + resposta). Vazio em turn 1. */
  recentTurns: AssessorTurn[];
  /** Nome do sujeito pra context (pode ser sem honorífico). */
  personaName?: string;
  /** Idade do sujeito pra calibração de tom. */
  personaAge?: number;
  /** Trust level atual (0-1) — input do trust-calculator. */
  trustLevel?: number;
  /** Run id pra trace propagation no gateway logger. */
  run_id?: string;
}

export interface AssessmentResult {
  /** Mood escala 1-10 integer. 1=crise, 5=neutro, 10=eufórico. */
  mood: number;
  /** Confidence do mood. */
  mood_confidence: MoodConfidence;
  /** Origem do mood pra auditabilidade. */
  mood_method: MoodMethod;

  /** Signals canônicos detectados (vocabulário 15 SEMANTIC_SIGNALS). */
  signals: SemanticSignal[];

  /** Engajamento derivado dos signals + mood. */
  engagement: EngagementLevel;

  /** Método global do assessment. */
  assessment_method: AssessmentMethod;

  /** Frase curta pra event_log (auditabilidade humana). */
  rationale: string;

  /** Latência da chamada LLM em ms (0 se rule-only). */
  latency_ms: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────

/** Mood default conservador quando inferência falha. */
export const MOOD_FALLBACK = 5;

/**
 * Distress markers PT/JA — mood baixo direto. Inspirados em
 * mood-extractor.ts mas separados (esta camada roda PRE-LLM, não usa signals).
 */
const DISTRESS_PATTERNS: RegExp[] = [
  // PT
  /\b(t[ôo]\s+mal|t[ôo]\s+triste|estou\s+(mal|triste)|n[ãa]o\s+quero|chato|t[ée]dio|cansad[oa])\b/i,
  // JA
  /(疲|つかれ|嫌|やだ|もういい|つまらん)/i,
];

/** Exit markers — sujeito quer sair. PT/JA. */
const EXIT_MARKER_PATTERNS: RegExp[] = [
  /\b(tchau|preciso\s+ir|vou\s+sair|n[ãa]o\s+t[ôo]\s+afim)\b/i,
  /(さよなら|sayonara|owari|またね)/i,
];

/** Enthusiasm — exclamação repetida + entusiasmo lexical. */
const ENTHUSIASM_PATTERNS: RegExp[] = [
  /!{2,}/,
  /\b(adorei|amei|incr[íi]vel|demais|massa|legal\s+pra\s+caramba)\b/i,
];

const SHORT_TEXT_THRESHOLD = 15;
const ENTHUSIASM_LENGTH_THRESHOLD = 50;

// ─────────────────────────────────────────────────────────────────────────
// Rule-based pre-pass
// ─────────────────────────────────────────────────────────────────────────

interface RuleResult {
  mood: number;
  mood_confidence: MoodConfidence;
  signals: SemanticSignal[];
  engagement: EngagementLevel;
  rationale: string;
}

/**
 * Tenta inferir mood + signals + engagement por regras determinísticas
 * sobre texto. Retorna null se ambíguo (LLM resolve depois).
 *
 * Cobertura esperada (~70% por spec): distress markers, exit markers,
 * monosyllabic curto, entusiasmo lexical.
 */
export function assessByRules(input: AssessorInput): RuleResult | null {
  const text = input.message.trim();

  if (text.length === 0) {
    return {
      mood: MOOD_FALLBACK,
      mood_confidence: "low",
      signals: [],
      engagement: "low",
      rationale: "rule: mensagem vazia → mood neutro conservador",
    };
  }

  // 1. Distress alto → mood 2
  for (const pattern of DISTRESS_PATTERNS) {
    if (pattern.test(text)) {
      return {
        mood: 2,
        mood_confidence: "high",
        signals: ["distress_marker_high"],
        engagement: "disengaging",
        rationale: "rule: distress marker detectado",
      };
    }
  }

  // 2. Exit marker → mood 3
  for (const pattern of EXIT_MARKER_PATTERNS) {
    if (pattern.test(text)) {
      return {
        mood: 3,
        mood_confidence: "high",
        signals: ["deflection_thematic"],
        engagement: "disengaging",
        rationale: "rule: exit marker detectado",
      };
    }
  }

  // 3. Entusiasmo + texto longo → mood 8
  if (text.length > ENTHUSIASM_LENGTH_THRESHOLD) {
    for (const pattern of ENTHUSIASM_PATTERNS) {
      if (pattern.test(text)) {
        return {
          mood: 8,
          mood_confidence: "high",
          signals: ["voluntary_topic_deepening"],
          engagement: "high",
          rationale: "rule: entusiasmo lexical + texto longo",
        };
      }
    }
  }

  // 4. Texto muito curto (sem signals positivos) → mood 4 (medium conf)
  if (text.length < SHORT_TEXT_THRESHOLD) {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const monosyllabic = words.length <= 2 && words.every((w) => w.length <= 4);
    if (monosyllabic) {
      return {
        mood: 4,
        mood_confidence: "medium",
        signals: ["deflection_silence"],
        engagement: "low",
        rationale: "rule: resposta monossilábica/curta",
      };
    }
  }

  // Ambíguo — LLM resolve.
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// LLM call (Haiku unified)
// ─────────────────────────────────────────────────────────────────────────

const SIGNALS_LIST = [
  "philosophical_self_acceptance",
  "frame_rejection",
  "meta_cognitive_observation",
  "frame_synthesis",
  "voluntary_topic_deepening",
  "vulnerability_offering",
  "distress_marker_high",
  "distress_marker_low",
  "deflection_thematic",
  "deflection_silence",
  "mood_drift_up",
  "mood_drift_down",
  "peer_reference",
  "authority_questioning",
  "gatekeeper_resistance",
] as const;

const SYSTEM_PROMPT = `Você é um extrator de estado conversacional para acompanhamento pedagógico de crianças/adolescentes.
Analise mensagem + histórico recente. Retorne APENAS JSON válido, sem markdown, sem explicação.

Schema obrigatório:
{
  "mood": <integer 1-10>,
  "mood_confidence": "<high|medium|low>",
  "signals": [<lista de strings do vocabulário canônico>],
  "engagement": "<high|medium|low|disengaging>",
  "rationale": "<frase curta de até 80 caracteres>"
}

Vocabulário canônico (use APENAS estes 15 signals):
${SIGNALS_LIST.join(", ")}

Regras:
- mood 1-3: sofrimento/resistência. mood 4-6: neutro. mood 7-10: receptivo/empolgado.
- Mensagem muito curta (<10 chars) sem contexto → mood 5 (conservador).
- signals = [] se nenhum signal claro. NUNCA invente fora do vocabulário.
- engagement deriva: high se voluntary_topic_deepening|frame_synthesis; disengaging se distress|deflection.`;

interface LlmJsonOutput {
  mood: number;
  mood_confidence: MoodConfidence;
  signals: string[];
  engagement: EngagementLevel;
  rationale: string;
}

function clampMood(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return MOOD_FALLBACK;
  const r = Math.round(v);
  if (r < 1) return 1;
  if (r > 10) return 10;
  return r;
}

function parseJsonResponse(text: string): LlmJsonOutput | null {
  try {
    const cleaned = text
      .replace(/```(?:json)?\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    if (typeof obj.mood !== "number") return null;
    return {
      mood: clampMood(obj.mood),
      mood_confidence: (obj.mood_confidence as MoodConfidence) ?? "medium",
      signals: Array.isArray(obj.signals) ? (obj.signals as string[]) : [],
      engagement: (obj.engagement as EngagementLevel) ?? "medium",
      rationale:
        typeof obj.rationale === "string" ? obj.rationale.slice(0, 200) : "",
    };
  } catch {
    return null;
  }
}

function buildUserMessage(input: AssessorInput): string {
  const historyText =
    input.recentTurns.length > 0
      ? input.recentTurns
          .map(
            (t) =>
              `${t.role === "user" ? input.personaName ?? "Sujeito" : "Bot"}: ${t.content}`,
          )
          .join("\n")
      : "(turn 1 — sem histórico)";

  return `Histórico recente:
${historyText}

Mensagem atual:
${input.message}

Responda em JSON.`;
}

async function assessByLlm(
  input: AssessorInput,
): Promise<{ result: LlmJsonOutput; latency_ms: number } | null> {
  const t0 = Date.now();
  try {
    const out = await callGateway({
      step: "unified-assessor",
      systemPrompt: SYSTEM_PROMPT,
      userMessage: buildUserMessage(input),
      maxTokens: 256,
      run_id: input.run_id,
    });
    const parsed = parseJsonResponse(out.content);
    if (!parsed) return null;
    return { result: parsed, latency_ms: Date.now() - t0 };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Assess unificado: sempre retorna AssessmentResult válido. Nunca lança.
 *
 * Pipeline:
 *   1. Rule-based pre-pass — se confidence high, retorna direto.
 *   2. LLM (Haiku) com JSON estruturado.
 *   3. Fallback degradado se LLM falha (mood=5 neutro).
 */
export async function assess(
  input: AssessorInput,
): Promise<AssessmentResult> {
  // Step 1 — rule-based
  const rule = assessByRules(input);
  if (rule && rule.mood_confidence === "high") {
    return {
      mood: rule.mood,
      mood_confidence: rule.mood_confidence,
      mood_method: "rule",
      signals: rule.signals,
      engagement: rule.engagement,
      assessment_method: "rule_only",
      rationale: rule.rationale,
      latency_ms: 0,
    };
  }

  // Step 2 — LLM (Haiku)
  const llm = await assessByLlm(input);
  if (llm) {
    const validSignals = llm.result.signals.filter(isSemanticSignal);
    return {
      mood: llm.result.mood,
      mood_confidence: llm.result.mood_confidence,
      mood_method: "llm",
      signals: validSignals,
      engagement: llm.result.engagement,
      assessment_method: "unified_haiku",
      rationale: llm.result.rationale,
      latency_ms: llm.latency_ms,
    };
  }

  // Step 3 — fallback degradado.
  // Se rule-based retornou medium-conf, prefere isso ao puro neutro.
  if (rule) {
    return {
      mood: rule.mood,
      mood_confidence: rule.mood_confidence,
      mood_method: "rule",
      signals: rule.signals,
      engagement: rule.engagement,
      assessment_method: "rule_only",
      rationale: rule.rationale + " (LLM indisponível)",
      latency_ms: 0,
    };
  }

  return {
    mood: MOOD_FALLBACK,
    mood_confidence: "low",
    mood_method: "fallback",
    signals: [],
    engagement: "medium",
    assessment_method: "fallback",
    rationale: "fallback: rule-based ambíguo + LLM indisponível",
    latency_ms: 0,
  };
}
