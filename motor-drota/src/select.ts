import type { ScoredContentItem } from "@ascendimacy/shared";
import type { SessionState } from "@ascendimacy/shared";
import { deductBudget } from "@ascendimacy/shared";

const FORBIDDEN_WORDS = [
  "playbook",
  "playbookId",
  "motor",
  "score",
  "candidateAction",
  "trust_level",
  "budgetRemaining",
  "sessionId",
  "contentPool",
  "content_pool",
];

/**
 * Pick o top-1 de um pool ordenado e deduz sacrifice_amount do budget.
 * DT-BUDGET-02: deduction sincrona.
 *
 * @returns selected item + novo SessionState com budget deduzido.
 */
export function selectFromPool(
  pool: ScoredContentItem[],
  state: SessionState,
): { selected: ScoredContentItem; newState: SessionState } {
  if (pool.length === 0) {
    throw new Error("selectFromPool: empty pool");
  }
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  const selected = sorted[0]!;
  const newState = deductBudget(state, selected.item.sacrifice_amount ?? 0);
  return { selected, newState };
}

export function sanitizeMaterialization(text: string): string {
  let result = text;
  for (const word of FORBIDDEN_WORDS) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "");
  }
  return result.replace(/\s{2,}/g, " ").trim();
}
