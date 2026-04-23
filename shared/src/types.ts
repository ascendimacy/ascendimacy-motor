export interface PersonaDef {
  id: string;
  name: string;
  age: number;
  profile: Record<string, unknown>;
}

export interface AdquirenteDef {
  id: string;
  name: string;
  defaults: Record<string, unknown>;
}

export interface PlaybookIndex {
  id: string;
  title: string;
  category: string;
  estimatedSacrifice: number;
  estimatedConfidenceGain: number;
}

export interface SessionState {
  sessionId: string;
  trustLevel: number;
  budgetRemaining: number;
  eventLog: EventEntry[];
  turn: number;
}

export interface EventEntry {
  timestamp: string;
  type: string;
  playbookId?: string;
  data: Record<string, unknown>;
}

export interface CandidateAction {
  playbookId: string;
  priority: number;
  rationale: string;
  estimatedSacrifice: number;
  estimatedConfidenceGain: number;
}
