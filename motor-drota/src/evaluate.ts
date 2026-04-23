import type { CandidateAction, SessionState } from "@ascendimacy/shared";
import type { ScoredAction } from "./types.js";

export function scoreActions(
  candidates: CandidateAction[],
  state: SessionState
): ScoredAction[] {
  return candidates.map(action => {
    const trustWeight = state.trustLevel < 0.4 ? 1.5 : 1.0;
    const budgetPenalty = action.estimatedSacrifice > state.budgetRemaining * 0.3 ? 0.7 : 1.0;
    const score =
      (action.estimatedConfidenceGain * trustWeight - action.estimatedSacrifice * 0.5) *
      budgetPenalty *
      (1 / action.priority);
    return { ...action, score };
  });
}
