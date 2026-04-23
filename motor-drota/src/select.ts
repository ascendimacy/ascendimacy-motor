import type { ScoredAction } from "./types.js";

const FORBIDDEN_WORDS = [
  "playbook", "playbookId", "motor", "score", "candidateAction",
  "trust_level", "budgetRemaining", "sessionId",
];

export function selectBest(scored: ScoredAction[]): ScoredAction {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
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
