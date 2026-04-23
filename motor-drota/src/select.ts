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
    result = result.replace(new RegExp(word, "gi"), "");
  }
  return result.trim();
}
