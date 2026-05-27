/**
 * drill-orchestrator — propõe candidatos B2 (Drilling) para o S3 decidir.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md
 *
 * Filosofia: B2 propõe, S3 decide se cabe na sessão. Drill respeita
 * sacrifice budget — não rouba tempo do núcleo S1-S5.
 *
 * `proposeDrillItem` é pura (sem DB). Caller carrega `listDue` + banks
 * antes e passa o contexto. Mantém testabilidade + desacoplamento do
 * motor-execucao (orchestrator não importa direto do workspace dele).
 *
 * Os helpers de empacotamento (`drillProposalToScoredItem`,
 * `serialize/deserialize`) moram em `@ascendimacy/shared/drill-proposal`
 * pra evitar dep cycle planejador → orchestrator. Re-exportados aqui
 * pra preservar API histórica.
 */

import type { DrillItem, DrillProposal, DrillState } from "@ascendimacy/shared";
import { DEFAULT_DRILL_COST, DRILL_WINDOW_HOOK } from "@ascendimacy/shared";

// Re-export pure helpers + constants so existing callers that import
// from `@ascendimacy/orchestrator/drill-orchestrator` keep working.
export {
  DEFAULT_DRILL_COST,
  DRILL_BASE_SCORE,
  DRILL_MAX_OVERDUE_BONUS,
  DRILL_OVERDUE_BONUS_PER_DAY,
  DRILL_WINDOW_HOOK,
  daysOverdue,
  deserializeDrillProposal,
  drillProposalToScoredItem,
  scoreDrillProposal,
  serializeDrillProposal,
} from "@ascendimacy/shared";
export type {
  DrillProposal,
  DrillWindowHook,
  SerializableDrillProposal,
} from "@ascendimacy/shared";

export interface DrillProposalContext {
  personaId: string;
  /** States due ordenados por `next_due_at ASC` (saída de `listDue`). */
  dueStates: DrillState[];
  /** Lookup item_id → DrillItem dos banks já carregados na sessão. */
  itemsById: Map<string, DrillItem>;
  /** Sacrifice budget atual do aprendiz. */
  budget: number;
  /** Override do custo por item; default `DEFAULT_DRILL_COST`. */
  costPerItem?: number;
}

/**
 * Retorna até 1 item due, respeitando sacrifice budget gate.
 *
 * Estratégia v0:
 *  - Skip se budget < cost (gate explícito).
 *  - Pega o mais atrasado (primeiro de `dueStates`, já ordenado por due).
 *  - Skip items sem entrada em `itemsById` (banco não carregado).
 *  - Retorna `null` se nenhum item match.
 */
export function proposeDrillItem(
  ctx: DrillProposalContext,
): DrillProposal | null {
  const cost = ctx.costPerItem ?? DEFAULT_DRILL_COST;
  if (ctx.budget < cost) return null;
  for (const state of ctx.dueStates) {
    const item = ctx.itemsById.get(state.item_id);
    if (item) {
      return { hook: DRILL_WINDOW_HOOK, item, state, cost };
    }
  }
  return null;
}
