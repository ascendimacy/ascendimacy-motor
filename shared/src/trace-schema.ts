// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { EventEntry } from "./types.js";

export interface TraceEntry {
  service: "planejador" | "motor-drota" | "motor-execucao";
  timestamp: string;
  durationMs: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface TurnTrace {
  turnNumber: number;
  sessionId: string;
  incomingMessage: string;
  entries: TraceEntry[];
  finalResponse: string;
}

export interface SessionTrace {
  sessionId: string;
  persona: string;
  startedAt: string;
  turns: TurnTrace[];
  meta: {
    schemaVersion: string;
    motorVersion: string;
  };
}

export function createSessionTrace(sessionId: string, persona: string): SessionTrace {
  return {
    sessionId,
    persona,
    startedAt: new Date().toISOString(),
    turns: [],
    meta: { schemaVersion: "1.0", motorVersion: "0.1.0" },
  };
}
