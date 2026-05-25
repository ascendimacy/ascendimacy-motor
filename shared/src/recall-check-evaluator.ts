/**
 * RecallCheckEvaluator — decide se o turn atual integra checagem ativa
 * de recall de conceito apresentado anteriormente.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-25-subject-knowledge-bridge.md §4.5
 *
 * Pure function. Pipeline (planejador/motor) preenche entradas a partir
 * do ledger (subject_knowledge type=presented_concept + recall_check_attempt).
 *
 * Heurística v1:
 *   - Cooldown mínimo de N sessões antes de re-checar mesmo conceito
 *   - Distress alto / shutdown → skip
 *   - Budget per session respeitado (default 1 — configurável pelo pai)
 *   - Score por candidato:
 *       lineage adjacente ao tema atual: +10
 *       conceito antigo (>14d sem check): +5
 *       eixo com baixa internalização (axis points < threshold): +3
 *   - Score mínimo pra disparar: 5
 *
 * Detecção de resposta positiva é feita no turn seguinte por
 * `classifyRecallResponse` (pure function abaixo).
 */

import type { SubjectKnowledgeEntry } from "./subject-knowledge.js";

export interface PresentedConceptRef {
  /** ID original do concept (item.id). */
  concept_id: string;
  /** Keywords pra detecção de resposta positiva. */
  keywords: string[];
  /** "tradicao/complemento" — ex: "estoica/dicotomia_controle". */
  lineage_anchor: string;
  /** axis_id (1..12). */
  axis_id: number;
  family: "carater" | "disposicao" | "cognicao_si";
  /** ISO timestamp quando foi apresentado. */
  presented_at: string;
  /** session_id da apresentação (pra cooldown). */
  session_id: string;
}

export interface PriorRecallCheck {
  concept_id_referenced: string;
  session_id: string;
  result: "positive" | "negative" | "ambiguous";
  checked_at: string;
}

export interface RecallCheckEvaluatorInput {
  /** Ledger: conceitos apresentados ao sujeito (cross-session). */
  presentedConcepts: PresentedConceptRef[];
  /** Checks anteriores (cross-session). */
  priorChecks: PriorRecallCheck[];
  /** Tema/lineage atual do turn (informativo, pra adjacência). */
  currentLineage?: string;
  /** Mood numérico (1-10). >= 4 considerado seguro pra checagem. */
  mood?: number;
  /** Engagement do turn — disengaging/shutdown → skip. */
  engagement?: "high" | "medium" | "low" | "disengaging";
  /** Session ID atual — define quais checks contam pro cooldown. */
  currentSessionId: string;
  /** ISO timestamp do turn (default: now). */
  now?: string;
  /** Configuração parental. */
  config?: {
    /** Default 1. 0 desabilita. */
    budgetPerSession?: number;
    /** Default 3. Cooldown mínimo de sessões. */
    cooldownSessions?: number;
  };
  /** Quantas checagens já foram feitas nesta sessão. Caller mantém. */
  checksInSessionSoFar: number;
}

export interface RecallCheckCandidate {
  concept: PresentedConceptRef;
  score: number;
  /** Sugestão de framing natural pra materializer integrar. */
  suggested_framing: string;
}

const DEFAULT_BUDGET_PER_SESSION = 1;
const DEFAULT_COOLDOWN_SESSIONS = 3;
const MIN_SCORE_TO_TRIGGER = 5;
const LINEAGE_ADJACENT_BONUS = 10;
const OLD_CONCEPT_BONUS = 5;
const LOW_INTERNALIZATION_BONUS = 3;
const OLD_CONCEPT_DAYS_THRESHOLD = 14;

/** Avalia se o turn atual deve incluir uma checagem de recall. */
export function evaluateRecallCheck(
  input: RecallCheckEvaluatorInput,
): RecallCheckCandidate | null {
  const budget = input.config?.budgetPerSession ?? DEFAULT_BUDGET_PER_SESSION;
  const cooldown = input.config?.cooldownSessions ?? DEFAULT_COOLDOWN_SESSIONS;
  if (budget === 0) return null;
  if (input.checksInSessionSoFar >= budget) return null;
  if (input.mood !== undefined && input.mood < 4) return null;
  if (input.engagement === "disengaging") return null;

  const now = input.now ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();

  // Conta sessões distintas anteriores à atual (cooldown semantics).
  const priorSessions = new Set<string>();
  for (const check of input.priorChecks) {
    if (check.session_id !== input.currentSessionId) {
      priorSessions.add(check.session_id);
    }
  }
  const sessionsBeforeNow = priorSessions.size;

  const eligible: RecallCheckCandidate[] = [];
  for (const concept of input.presentedConcepts) {
    // Cooldown: ignora conceitos checados há menos de N sessões.
    const recentChecks = input.priorChecks.filter(
      (c) => c.concept_id_referenced === concept.concept_id,
    );
    if (recentChecks.length > 0) {
      // Conta quantas sessões distintas houve desde o último check.
      const lastCheck = recentChecks
        .slice()
        .sort((a, b) => b.checked_at.localeCompare(a.checked_at))[0];
      const sessionsSince = sessionsBeforeNow + 1 - 0; // simpificado: assume cooldown se há check
      // Aplica cooldown se o último check foi em sessão recente.
      if (lastCheck.session_id === input.currentSessionId) continue; // já checado nesta sessão
      // Heurística simples v1: se há check do conceito numa das últimas N sessões, pula.
      const recentSessions = Array.from(priorSessions).slice(-cooldown);
      if (recentSessions.includes(lastCheck.session_id)) continue;
      // mantém referência pra clarity
      if (sessionsSince === 0) continue;
    }

    let score = 0;

    // (1) lineage adjacente ao tema atual
    if (
      input.currentLineage &&
      sameTradition(input.currentLineage, concept.lineage_anchor)
    ) {
      score += LINEAGE_ADJACENT_BONUS;
    }

    // (2) conceito antigo sem check recente
    const daysSincePresented =
      (nowMs - new Date(concept.presented_at).getTime()) /
      (1000 * 60 * 60 * 24);
    if (daysSincePresented > OLD_CONCEPT_DAYS_THRESHOLD) {
      score += OLD_CONCEPT_BONUS;
    }

    // (3) eixo com baixa internalização — usa heurística: conta presented_concept
    // do mesmo axis que receberam check positivo. Sem check positivo no axis = baixo.
    const positiveChecksInAxis = input.priorChecks.filter(
      (c) =>
        c.result === "positive" &&
        input.presentedConcepts.some(
          (p) =>
            p.concept_id === c.concept_id_referenced &&
            p.axis_id === concept.axis_id,
        ),
    ).length;
    if (positiveChecksInAxis === 0) {
      score += LOW_INTERNALIZATION_BONUS;
    }

    if (score >= MIN_SCORE_TO_TRIGGER) {
      eligible.push({
        concept,
        score,
        suggested_framing: composeFraming(concept, input.currentLineage),
      });
    }
  }

  if (eligible.length === 0) return null;
  eligible.sort((a, b) => b.score - a.score);
  return eligible[0];
}

function sameTradition(a: string, b: string): boolean {
  const ta = a.split("/")[0];
  const tb = b.split("/")[0];
  return ta === tb && ta !== undefined && ta.length > 0;
}

function composeFraming(
  concept: PresentedConceptRef,
  currentLineage?: string,
): string {
  // Framing curioso/cooperativo, NÃO examinatório.
  // Se há adjacência de tradição, faz ponte natural. Caso contrário,
  // referência genérica ao conceito antigo.
  if (
    currentLineage &&
    sameTradition(currentLineage, concept.lineage_anchor)
  ) {
    return `e aquela ideia de ${conceptShortLabel(concept)} — você lembra ainda?`;
  }
  return `lembra daquela coisa de ${conceptShortLabel(concept)} que a gente falou?`;
}

function conceptShortLabel(concept: PresentedConceptRef): string {
  if (concept.keywords.length > 0) {
    return concept.keywords[0];
  }
  return concept.concept_id.replace(/_/g, " ");
}

// ─────────────────────────────────────────────────────────────────
// Detecção de resposta positiva — usado no turn N+1
// ─────────────────────────────────────────────────────────────────

/** Negação composta — vence afirmação isolada ("não lembro" → negative). */
const STRONG_NEGATION_RE =
  /\b(?:n[aã]o\s+(?:lembro|sei|consigo)|esqueci|nunca\s+ouvi)\b/i;
const AFFIRMATION_RE =
  /\b(?:sim|aham|claro|lembro|lembrei|isso|sei|aquilo|aquela)\b/i;
const SIMPLE_NEGATION_RE = /\b(?:n[aã]o|nem|nada)\b/i;

/**
 * Classifica a resposta do sujeito a uma checagem feita no turn anterior.
 *
 * Estratégia v1:
 *   - STRONG_NEGATION ("não lembro", "não sei", "esqueci", "nunca ouvi")
 *     → negative (vence afirmação)
 *   - keyword do conceito mencionada (sem strong negation) → positive
 *   - afirmação simples ("sim", "lembro") sem negação simples → positive
 *   - keyword + negação simples (sem strong) → ambiguous (segurança)
 *   - caso contrário → ambiguous
 */
export function classifyRecallResponse(
  message: string,
  conceptKeywords: string[],
): "positive" | "negative" | "ambiguous" {
  const text = message.toLowerCase();
  if (STRONG_NEGATION_RE.test(text)) return "negative";
  const hasSimpleNeg = SIMPLE_NEGATION_RE.test(text);
  const mentionedKeyword = conceptKeywords.some((kw) =>
    text.includes(kw.toLowerCase()),
  );
  const hasAff = AFFIRMATION_RE.test(text);

  if (mentionedKeyword && hasSimpleNeg) return "ambiguous";
  if (mentionedKeyword) return "positive";
  if (hasAff && !hasSimpleNeg) return "positive";
  return "ambiguous";
}
