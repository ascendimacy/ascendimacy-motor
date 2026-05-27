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
 */

import type { DrillItem, DrillState } from "@ascendimacy/shared";

/** Hook descritor — usado pelo S3 quando aceita a proposta. */
export const DRILL_WINDOW_HOOK = "drill_window_proposal" as const;
export type DrillWindowHook = typeof DRILL_WINDOW_HOOK;

/** Custo default por item em sacrifice points (spec default = 2). */
export const DEFAULT_DRILL_COST = 2;

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

export interface DrillProposal {
  hook: DrillWindowHook;
  item: DrillItem;
  state: DrillState;
  cost: number;
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
