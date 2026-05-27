/**
 * drill-proposal — helpers puros pra empacotar/desempacotar `DrillProposal`
 * como ScoredContentItem trafegando no pipeline plan_turn → evaluate_and_select.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md
 *
 * Mora em `shared` (não em orchestrator) pra evitar dep cycle: planejador
 * importa `drillProposalToScoredItem` mas não pode importar orchestrator.
 * `proposeDrillItem` (policy) continua em orchestrator/src/drill-orchestrator.ts.
 */

import type {
  DrillItem,
  DrillState,
} from "./contracts/index.js";
import type { DrillVocabItem, ScoredContentItem } from "./content-item.js";

/** Hook descritor — usado pelo S3 quando aceita a proposta. */
export const DRILL_WINDOW_HOOK = "drill_window_proposal" as const;
export type DrillWindowHook = typeof DRILL_WINDOW_HOOK;

/** Custo default por item em sacrifice points (spec default = 2). */
export const DEFAULT_DRILL_COST = 2;

/** Score base alto pra garantir que drill due bata items normais do seed.
 *  Acima de PARENT_PINNED_SCORE (1000) seria intrusivo demais — drill é
 *  proposta, não trump. 60 fica próximo ao topo (seed items ficam 20-50). */
export const DRILL_BASE_SCORE = 60;
/** Bônus linear por dia de atraso, capado para não dominar trust/sacrifice. */
export const DRILL_OVERDUE_BONUS_PER_DAY = 5;
export const DRILL_MAX_OVERDUE_BONUS = 30;

export interface DrillProposal {
  hook: DrillWindowHook;
  item: DrillItem;
  state: DrillState;
  cost: number;
}

/** Days between `next_due_at` and now (negative = ainda não due). */
export function daysOverdue(state: DrillState, nowIso: string): number {
  const dueMs = new Date(state.next_due_at).getTime();
  const nowMs = new Date(nowIso).getTime();
  return (nowMs - dueMs) / 86_400_000;
}

/** Score determinístico baseado em SR urgency. */
export function scoreDrillProposal(
  state: DrillState,
  nowIso: string,
): number {
  const overdue = Math.max(0, daysOverdue(state, nowIso));
  const overdueBonus = Math.min(
    DRILL_MAX_OVERDUE_BONUS,
    overdue * DRILL_OVERDUE_BONUS_PER_DAY,
  );
  return DRILL_BASE_SCORE + overdueBonus;
}

/**
 * Empacota a proposal como `ScoredContentItem` com `DrillVocabItem` embutido.
 * `personaAge` preenche `age_range` (não há filtro real — drill só entra no
 * pool quando há state due pra esta persona).
 */
export function drillProposalToScoredItem(
  proposal: DrillProposal,
  personaAge: number,
  nowIso: string,
): ScoredContentItem {
  const score = scoreDrillProposal(proposal.state, nowIso);
  const overdue = daysOverdue(proposal.state, nowIso);
  const item: DrillVocabItem = {
    id: `drill:${proposal.item.id}`,
    type: "drill_vocab",
    domain: `drill.${proposal.item.bank_id}`,
    casel_target: [],
    age_range: [Math.max(0, personaAge - 2), personaAge + 4],
    surprise: 3,
    verified: true,
    base_score: DRILL_BASE_SCORE,
    sacrifice_amount: proposal.cost,
    drill_item_id: proposal.item.id,
    bank_id: proposal.item.bank_id,
    prompt: proposal.item.payload.prompt,
    answer: proposal.item.payload.answer,
    ...(proposal.item.payload.hint !== undefined
      ? { hint: proposal.item.payload.hint }
      : {}),
    source_language: /[぀-ヿ一-鿿]/.test(proposal.item.payload.prompt)
      ? "jp"
      : "unknown",
  };
  return {
    item,
    score,
    reasons: [
      `drill_due(overdue_days=${overdue.toFixed(2)})`,
      `drill_bank=${proposal.item.bank_id}`,
    ],
  };
}

/**
 * Shape serializável de um DrillProposal — passa por contextHints sem
 * perder informação. `Map<>` não atravessa JSON, então usamos flat refs.
 */
export interface SerializableDrillProposal {
  hook: DrillWindowHook;
  item: DrillItem;
  state: DrillState;
  cost: number;
}

export function serializeDrillProposal(
  proposal: DrillProposal,
): SerializableDrillProposal {
  return {
    hook: proposal.hook,
    item: proposal.item,
    state: proposal.state,
    cost: proposal.cost,
  };
}

export function deserializeDrillProposal(
  raw: unknown,
): DrillProposal | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Partial<SerializableDrillProposal>;
  if (v.hook !== DRILL_WINDOW_HOOK) return null;
  if (!v.item || !v.state || typeof v.cost !== "number") return null;
  return {
    hook: DRILL_WINDOW_HOOK,
    item: v.item,
    state: v.state,
    cost: v.cost,
  };
}
