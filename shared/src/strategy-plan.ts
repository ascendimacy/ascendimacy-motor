/**
 * StrategyPlan + Strategist — Fase 8 PR 3 (tracer bullet).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-25-session-phases-journey-stages-strategist.md §5
 *
 * Strategist compõe plano de sessão em journey_stage=applied_double_helix.
 * NÃO é selecionador de content_item — é compositor criativo de playbook
 * moves pra levar o sujeito a demonstrar capacidades nos mapas.
 *
 * v1 tracer: heurística pura template-based (sem LLM call).
 * Cruzamento opinião×portfólio via LLM entra em fase posterior.
 */

import type { JourneyStage, SessionPhase } from "./session-phases.js";
import type { SubjectKnowledgeEntry } from "./subject-knowledge.js";

// ─────────────────────────────────────────────────────────────────────────
// PlaybookMove — verbos pedagógicos componíveis (catálogo)
// ─────────────────────────────────────────────────────────────────────────

export type PlaybookMoveId =
  | "propose_dilemma"          // apresenta dilema realista, pede decisão
  | "request_demonstration"     // pede pra mostrar algo concreto
  | "offer_choice"              // dá 2-3 opções com tradeoffs
  | "reflect_back"              // espelha o que sujeito disse
  | "bridge_to_lineage"         // conecta com complemento clássico
  | "ask_recall";               // checa internalização anterior

export interface PlaybookMove {
  id: PlaybookMoveId;
  phase: SessionPhase;
  /** Tempo estimado em minutos. */
  estimated_minutes: number;
  /** Framing genérico — Materializer customiza com contexto. */
  framing_template: string;
  /** Success signal observável pra Trigger Evaluator detectar. */
  success_signal: string;
}

/**
 * Catálogo v1 — apenas `propose_dilemma` real; outros são stubs futuros.
 * Quando catálogo crescer, vira YAML separado (sub-spec).
 */
export const PLAYBOOK_MOVES: Record<PlaybookMoveId, PlaybookMove> = {
  propose_dilemma: {
    id: "propose_dilemma",
    phase: "challenge_execute",
    estimated_minutes: 10,
    framing_template:
      "Vou te propor uma situação. Imagina: {dilemma}. Você escolheria {option_a} ou {option_b}? Por quê?",
    success_signal: "sujeito_escolheu_E_justificou",
  },
  request_demonstration: {
    id: "request_demonstration",
    phase: "challenge_execute",
    estimated_minutes: 15,
    framing_template: "Me mostra como você faria {action}. Pode ser por foto, áudio ou descrição.",
    success_signal: "sujeito_demonstrou_action",
  },
  offer_choice: {
    id: "offer_choice",
    phase: "challenge_explain",
    estimated_minutes: 3,
    framing_template: "Tenho 2 caminhos: (a) {choice_a} ou (b) {choice_b}. Qual te interessa mais?",
    success_signal: "sujeito_escolheu_caminho",
  },
  reflect_back: {
    id: "reflect_back",
    phase: "ice_breaker",
    estimated_minutes: 2,
    framing_template: "Deixa eu ver se entendi: {summary}. É isso?",
    success_signal: "sujeito_confirmou_ou_corrigiu",
  },
  bridge_to_lineage: {
    id: "bridge_to_lineage",
    phase: "challenge_execute",
    estimated_minutes: 5,
    framing_template:
      "Isso me lembra uma ideia antiga — {lineage_name}: {lineage_short}. Faz sentido pra você no que falamos?",
    success_signal: "sujeito_ressoou_com_lineage",
  },
  ask_recall: {
    id: "ask_recall",
    phase: "challenge_execute",
    estimated_minutes: 2,
    framing_template: "Lembra daquela ideia de {concept}? O que ficou disso pra você?",
    success_signal: "sujeito_demonstrou_recall_positivo",
  },
};

// ─────────────────────────────────────────────────────────────────────────
// StrategyPlan — plano por sessão (spec §5.2)
// ─────────────────────────────────────────────────────────────────────────

export interface TargetDemonstration {
  framework: string;             // ex: "valores_classicos"
  dimension: string;             // ex: "axis_1"
  goal: "expose" | "explore" | "challenge" | "consolidate";
  rationale: string;
}

export interface PlaybookCompositionStep {
  move_id: PlaybookMoveId;
  phase: SessionPhase;
  estimated_minutes: number;
  content_inputs?: string[];     // IDs opcionais de content_seeds
  success_signal: string;
}

export interface StrategyPlan {
  session_id: string;
  subject_id: string;
  composed_at: string;
  target_demonstrations: TargetDemonstration[];
  playbook_composition: PlaybookCompositionStep[];
  overall_success_criteria: string;
  fallback_strategy?: string;
  /** Snapshot do mapa pro audit log. */
  subject_map_snapshot?: Record<string, unknown>;
  /** Outcome — atualizado no follow_up. */
  demonstrations_observed?: TargetDemonstration[];
}

// ─────────────────────────────────────────────────────────────────────────
// Strategist.compose — v1 template-based (sem LLM)
// ─────────────────────────────────────────────────────────────────────────

export interface StrategistInput {
  sessionId: string;
  subjectId: string;
  journeyStage: JourneyStage;
  /** Entries do ledger usadas pra inferir interesses + necessidades. */
  knowledgeEntries: SubjectKnowledgeEntry[];
  /** Latent needs do parental_profile (passado pelo planejador). */
  latentNeeds?: string[];
  /** Subject proposed do parental_profile. */
  subjectProposed?: {
    axes_active: number[];
    complements_per_axis: Record<number, string[]>;
  };
}

const FAMILY_PRIORITY: Array<"carater" | "disposicao" | "cognicao_si"> = [
  "carater",
  "disposicao",
  "cognicao_si",
];

/**
 * v1 template-based: identifica 1 target_demonstration baseado em
 * eixo do subject_proposed com menor evidência no ledger; compõe 1
 * playbook move `propose_dilemma` no `challenge_execute`.
 *
 * Retorna null quando stage não é applied_double_helix — outros stages
 * não usam Strategist (ice_breaker / mapping_ready têm pipeline próprio).
 *
 * LLM call entra em fase posterior (cruzamento opinião×portfólio).
 */
export function composeStrategyPlan(input: StrategistInput): StrategyPlan | null {
  if (input.journeyStage !== "applied_double_helix") {
    return null;
  }

  // Identifica eixos ativos no proposto; default lista vazia
  const axesActive = input.subjectProposed?.axes_active ?? [];
  if (axesActive.length === 0) {
    // Sem subject_proposed populado, plan vazio — caller decide o que fazer
    return null;
  }

  // Heurística: escolhe primeiro eixo proposto que NÃO tem presented_concept
  // recente (= dimensão menos exposta). Fallback: primeiro eixo da lista.
  const presentedAxes = new Set<number>();
  for (const e of input.knowledgeEntries) {
    if (e.type === "presented_concept" && e.payload.kind === "presented_concept") {
      presentedAxes.add(e.payload.axis_id);
    }
  }
  const targetAxis = axesActive.find((ax) => !presentedAxes.has(ax)) ?? axesActive[0];
  const targetFamily = familyForAxis(targetAxis);

  const targetDemonstration: TargetDemonstration = {
    framework: "valores_classicos",
    dimension: `axis_${targetAxis}`,
    goal: presentedAxes.has(targetAxis) ? "consolidate" : "expose",
    rationale: presentedAxes.has(targetAxis)
      ? `Eixo ${targetAxis} já tem apresentação anterior; consolidar via dilema.`
      : `Eixo ${targetAxis} ainda sem presented_concept; expor via dilema concreto.`,
  };

  // Composição v1: 1 playbook move (propose_dilemma)
  const dilemmaMove: PlaybookCompositionStep = {
    move_id: "propose_dilemma",
    phase: "challenge_execute",
    estimated_minutes: PLAYBOOK_MOVES.propose_dilemma.estimated_minutes,
    success_signal: PLAYBOOK_MOVES.propose_dilemma.success_signal,
  };

  return {
    session_id: input.sessionId,
    subject_id: input.subjectId,
    composed_at: new Date().toISOString(),
    target_demonstrations: [targetDemonstration],
    playbook_composition: [dilemmaMove],
    overall_success_criteria: `Sujeito escolheu E justificou no dilema sobre ${targetFamily}.`,
    fallback_strategy: "Se sujeito deflectir o dilema, retornar a reflect_back e re-propor adaptado.",
  };
}

function familyForAxis(axis: number): string {
  if (axis >= 1 && axis <= 4) return FAMILY_PRIORITY[0];
  if (axis >= 5 && axis <= 8) return FAMILY_PRIORITY[1];
  if (axis >= 9 && axis <= 12) return FAMILY_PRIORITY[2];
  return "desconhecida";
}

/**
 * Helper: dado um StrategyPlan + estado atual da sessão, retorna o
 * próximo playbook move a executar (ou null se plano esgotado).
 *
 * v1: ordem linear; quando execute terminar (esgotou moves), null.
 */
export function nextPlaybookMove(
  plan: StrategyPlan,
  currentPhase: SessionPhase,
  movesExecutedInSession: number,
): PlaybookCompositionStep | null {
  const remaining = plan.playbook_composition.filter(
    (m) => m.phase === currentPhase,
  );
  if (movesExecutedInSession >= remaining.length) return null;
  return remaining[movesExecutedInSession];
}
