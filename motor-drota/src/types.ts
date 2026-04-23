export interface ScoredAction {
  playbookId: string;
  priority: number;
  rationale: string;
  estimatedSacrifice: number;
  estimatedConfidenceGain: number;
  score: number;
}
