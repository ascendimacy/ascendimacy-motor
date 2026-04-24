import type { StatusMatrix } from "./status-matrix.js";

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
  /** Hidratado por motor-execucao a partir de tree_nodes (zone='status'). */
  statusMatrix?: StatusMatrix;
}

export interface EventEntry {
  timestamp: string;
  type: string;
  playbookId?: string;
  data: Record<string, unknown>;
}
