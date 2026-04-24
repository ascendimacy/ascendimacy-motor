import type { ScoredContentItem } from "@ascendimacy/shared";

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

/** Pick o top-1 de um pool ordenado. Assume já vem sorted desc; se não, re-sorta. */
export function selectFromPool(pool: ScoredContentItem[]): ScoredContentItem {
  if (pool.length === 0) {
    throw new Error("selectFromPool: empty pool");
  }
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  return sorted[0]!;
}

export function sanitizeMaterialization(text: string): string {
  let result = text;
  for (const word of FORBIDDEN_WORDS) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "");
  }
  return result.replace(/\s{2,}/g, " ").trim();
}
