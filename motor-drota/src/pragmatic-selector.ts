/**
 * Pragmatic Selector — substitui Action Evaluator + Action Selector composite
 * (motor-drota-v1 §2.2 + §2.3) com lógica DETERMINÍSTICA, zero LLM.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-28-motor-simplificacao-llm-spec-v1.md §4
 *
 * Filosofia: filtro de viabilidade por mood + budget → menor custo entre
 * viáveis. Tie-break por tactical weight (score do planejador). Pulso hook
 * opcional para empates dentro de threshold.
 *
 * DT-SIM-04 (Jun, 28-abr): spec original usa ActionCandidate com campos
 * criticality (rotineira|importante|seguranca), estimated_cost, tactical_weight.
 * Realidade do código: motor-drota recebe ScoredContentItem[] do planejador
 * com score (~tactical_weight) + item.sacrifice_amount (~estimated_cost). Sem
 * criticality. Mapping inline; criticality gate fica como stub testável (sempre
 * 'rotineira' por default) até criticality entrar no schema do ContentItem.
 */

import { deductBudget } from "@ascendimacy/shared";
import type {
  ScoredContentItem,
  SessionState,
  EngagementLevel,
} from "@ascendimacy/shared";
import type { AssessmentResult } from "./unified-assessor.js";

// ─────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────

/** Criticality stub — DT-SIM-04 — até campo entrar no ContentItem real. */
export type Criticality = "rotineira" | "importante" | "seguranca";

export type EscalationReason =
  | "no_viable_action"
  | "budget_exhausted"
  | "criticality_seguranca"; // se vier do meta de input

export interface SelectorInput {
  /** Pool já scorado pelo planejador. */
  candidates: ScoredContentItem[];
  /** Resultado do Unified Assessor — mood + signals + engagement. */
  assessment: AssessmentResult;
  /** SessionState atual (volátil — budget_remaining usado). */
  state: SessionState;
  /** Override opcional de criticality por candidate (se motor#X adicionar). */
  criticalityByItemId?: Record<string, Criticality>;
}

export interface SelectionResult {
  /** Item escolhido — null se nenhuma viável. */
  selected: ScoredContentItem | null;
  /** Estado após deduct (ou intacto se selected null). */
  newState: SessionState;
  /** Justificativa em linguagem humana — auditável MotorOps. */
  decision_path: string;
  /** Quantas candidatas no pool original. */
  candidates_count: number;
  /** Quantas passaram no filtro de viabilidade. */
  viable_count: number;
  /** Custo da selecionada (sacrifice_amount ?? 0). */
  selected_cost: number;
  /** Budget antes do deduct. */
  budget_before: number;
  /** Budget após deduct (= newState.budgetRemaining). */
  budget_after: number;
  /** Pulso disparou? */
  pulso_emitted: boolean;
  /** Escalação se selected null. */
  escalate_to: "bridge" | "planner" | null;
  /** Reason de escalação (se aplicável). */
  escalate_reason?: EscalationReason;
}

// ─────────────────────────────────────────────────────────────────────────
// Constantes (limiares spec §4.2)
// ─────────────────────────────────────────────────────────────────────────

/** Mood threshold abaixo do qual só ações "leves" são viáveis. */
const MOOD_LOW_THRESHOLD = 3;
/** Cost cap quando mood ≤ 3 → só ações ≤ 3. */
const MOOD_LOW_COST_CAP = 3;

/** Budget threshold abaixo do qual modo conservador. */
const BUDGET_LOW_THRESHOLD = 10;
/** Cost cap quando budget < 10 → só ações ≤ 5. */
const BUDGET_LOW_COST_CAP = 5;

/** Cost cap quando engajamento = disengaging → só ações ≤ 4. */
const DISENGAGING_COST_CAP = 4;

/** Cost cap em modo mínimo (budget ≤ 0). */
const MINIMAL_COST_CAP = 2;

/** Tie threshold pra Pulso (delta de score ou cost). */
const TIE_COST_DELTA = 1;
const TIE_SCORE_DELTA = 0.05;

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function getCost(item: ScoredContentItem): number {
  return item.item.sacrifice_amount ?? 0;
}

function getCriticality(
  item: ScoredContentItem,
  overrides?: Record<string, Criticality>,
): Criticality {
  // DT-SIM-04: sem campo criticality em ContentItem ainda.
  // Override permite tests + futura integração.
  return overrides?.[item.item.id] ?? "rotineira";
}

function applyCostCap(
  candidates: ScoredContentItem[],
  cap: number,
): ScoredContentItem[] {
  return candidates.filter((c) => getCost(c) <= cap);
}

/** Texto humano resumindo viabilidade. */
function describeViabilityFilter(
  mood: number,
  engagement: EngagementLevel,
  budget: number,
  initial: number,
  filtered: number,
): string {
  const filters: string[] = [];
  if (mood <= MOOD_LOW_THRESHOLD) {
    filters.push(`mood=${mood} (≤${MOOD_LOW_THRESHOLD}) → cost≤${MOOD_LOW_COST_CAP}`);
  } else if (engagement === "disengaging") {
    filters.push(`engagement=disengaging → cost≤${DISENGAGING_COST_CAP}`);
  } else if (budget < BUDGET_LOW_THRESHOLD) {
    filters.push(`budget=${budget} (<${BUDGET_LOW_THRESHOLD}) → cost≤${BUDGET_LOW_COST_CAP}`);
  }
  if (filters.length === 0) return `${initial} candidatas viáveis (mood/budget ok)`;
  return `${filters.join("; ")} → ${filtered}/${initial} viáveis`;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Seleciona ação determinísticamente. Zero LLM.
 *
 * Pipeline (spec §4.2):
 *   1. Gate criticality:seguranca → escalate Bridge sem materializar
 *   2. Filtro viabilidade por mood/engagement/budget
 *   3. Sem viáveis → escalate Planejador
 *   4. Budget ≤ 0 → modo mínimo (cost ≤ 2)
 *   5. Sort: menor custo + tie-break por score (tactical_weight)
 *   6. Pulso hook para empates dentro de threshold (futuro)
 *
 * Sempre retorna SelectionResult válido, nunca lança.
 */
export function selectAction(input: SelectorInput): SelectionResult {
  const { candidates, assessment, state, criticalityByItemId } = input;
  const budgetBefore = state.budgetRemaining;

  // Pool vazio → escala Planejador
  if (candidates.length === 0) {
    return {
      selected: null,
      newState: state,
      decision_path: "pool vazio → escala Planejador",
      candidates_count: 0,
      viable_count: 0,
      selected_cost: 0,
      budget_before: budgetBefore,
      budget_after: budgetBefore,
      pulso_emitted: false,
      escalate_to: "planner",
      escalate_reason: "no_viable_action",
    };
  }

  // Step 1 — Gate criticality:seguranca
  const securityActions = candidates.filter(
    (c) => getCriticality(c, criticalityByItemId) === "seguranca",
  );
  if (securityActions.length > 0) {
    const selected = securityActions[0]!;
    const cost = getCost(selected);
    const newState = deductBudget(state, cost);
    return {
      selected,
      newState,
      decision_path: `criticality=seguranca → escala Bridge (sem Materializer); selecionada=${selected.item.id} cost=${cost}`,
      candidates_count: candidates.length,
      viable_count: securityActions.length,
      selected_cost: cost,
      budget_before: budgetBefore,
      budget_after: newState.budgetRemaining,
      pulso_emitted: false,
      escalate_to: "bridge",
      escalate_reason: "criticality_seguranca",
    };
  }

  // Step 4 (early) — Budget ≤ 0 → modo mínimo
  if (budgetBefore <= 0) {
    const minimal = applyCostCap(candidates, MINIMAL_COST_CAP);
    if (minimal.length === 0) {
      return {
        selected: null,
        newState: state,
        decision_path: `budget=${budgetBefore} ≤ 0; nenhuma ação cost≤${MINIMAL_COST_CAP} disponível → escala Planejador`,
        candidates_count: candidates.length,
        viable_count: 0,
        selected_cost: 0,
        budget_before: budgetBefore,
        budget_after: budgetBefore,
        pulso_emitted: false,
        escalate_to: "planner",
        escalate_reason: "budget_exhausted",
      };
    }
    minimal.sort((a, b) => getCost(a) - getCost(b));
    const selected = minimal[0]!;
    const cost = getCost(selected);
    const newState = deductBudget(state, cost);
    return {
      selected,
      newState,
      decision_path: `budget=${budgetBefore} ≤ 0 → modo mínimo; selecionada cost-mínima=${selected.item.id} cost=${cost}`,
      candidates_count: candidates.length,
      viable_count: minimal.length,
      selected_cost: cost,
      budget_before: budgetBefore,
      budget_after: newState.budgetRemaining,
      pulso_emitted: false,
      escalate_to: null,
    };
  }

  // Step 2 — Filtro viabilidade
  const mood = assessment.mood;
  const engagement = assessment.engagement;

  let viable: ScoredContentItem[];
  if (mood <= MOOD_LOW_THRESHOLD) {
    viable = applyCostCap(candidates, MOOD_LOW_COST_CAP);
  } else if (engagement === "disengaging") {
    viable = applyCostCap(candidates, DISENGAGING_COST_CAP);
  } else if (budgetBefore < BUDGET_LOW_THRESHOLD) {
    viable = applyCostCap(candidates, BUDGET_LOW_COST_CAP);
  } else {
    viable = [...candidates];
  }

  // Step 3 — Sem viáveis → escala Planejador
  if (viable.length === 0) {
    return {
      selected: null,
      newState: state,
      decision_path: `${describeViabilityFilter(mood, engagement, budgetBefore, candidates.length, 0)} → escala Planejador`,
      candidates_count: candidates.length,
      viable_count: 0,
      selected_cost: 0,
      budget_before: budgetBefore,
      budget_after: budgetBefore,
      pulso_emitted: false,
      escalate_to: "planner",
      escalate_reason: "no_viable_action",
    };
  }

  // Step 5 — Sort: menor custo + tie-break por score (desc)
  viable.sort((a, b) => {
    const costDiff = getCost(a) - getCost(b);
    if (costDiff !== 0) return costDiff;
    return b.score - a.score; // maior score primeiro em empate
  });

  const top = viable[0]!;
  const topCost = getCost(top);

  // Step 6 — Pulso hook (futuro). Detecta empate dentro de threshold.
  const tied = viable.filter(
    (c) =>
      Math.abs(getCost(c) - topCost) <= TIE_COST_DELTA &&
      Math.abs(c.score - top.score) < TIE_SCORE_DELTA,
  );

  // Pulso ainda não plugado em motor canônico (motor#33). Quando plugar,
  // chamada vira: if (tied.length > 1 && pulsoEnabled) { applyPulso(tied) }.
  // Por enquanto: empate resolve por order primeiro (sort stable).

  const selected = top;
  const newState = deductBudget(state, topCost);

  const filterDesc = describeViabilityFilter(
    mood,
    engagement,
    budgetBefore,
    candidates.length,
    viable.length,
  );

  let path = `${filterDesc}; menor custo: ${selected.item.id} (cost=${topCost})`;
  if (tied.length > 1) {
    path += ` [empate ${tied.length}-way; Pulso hook ainda não plugado, ordem estável aplicada]`;
  }

  return {
    selected,
    newState,
    decision_path: path,
    candidates_count: candidates.length,
    viable_count: viable.length,
    selected_cost: topCost,
    budget_before: budgetBefore,
    budget_after: newState.budgetRemaining,
    pulso_emitted: false,
    escalate_to: null,
  };
}
