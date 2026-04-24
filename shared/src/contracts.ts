import type { CandidateAction, SessionState, PersonaDef, AdquirenteDef, PlaybookIndex, EventEntry } from "./types.js";

export type { CandidateAction };

export interface PlanTurnInput {
  sessionId: string;
  persona: PersonaDef;
  adquirente: AdquirenteDef;
  inventory: PlaybookIndex[];
  state: SessionState;
  incomingMessage: string;
}

export interface PlanTurnOutput {
  strategicRationale: string;
  candidateActions: CandidateAction[];
  contextHints: Record<string, unknown>;
}

export interface EvaluateAndSelectInput {
  sessionId: string;
  candidateActions: CandidateAction[];
  state: SessionState;
  persona: PersonaDef;
  strategicRationale: string;
  contextHints: Record<string, unknown>;
}

export interface EvaluateAndSelectOutput {
  selectedAction: CandidateAction;
  selectionRationale: string;
  actualSacrifice: number;
  actualConfidenceGain: number;
  linguisticMaterialization: string;
}

export interface ExecutePlaybookInput {
  sessionId: string;
  playbookId: string;
  output: string;
  metadata: Record<string, unknown>;
}

export interface ExecutePlaybookOutput {
  success: boolean;
  newState: SessionState;
  eventLogged: EventEntry;
}
