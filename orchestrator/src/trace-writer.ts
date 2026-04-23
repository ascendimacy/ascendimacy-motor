import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SessionTrace, TurnTrace } from "@ascendimacy/shared";
import { createSessionTrace } from "@ascendimacy/shared";

export function initTrace(sessionId: string, persona: string): SessionTrace {
  return createSessionTrace(sessionId, persona);
}

export function appendTurn(trace: SessionTrace, turn: TurnTrace): void {
  trace.turns.push(turn);
}

export function saveTrace(trace: SessionTrace, outputDir: string): string {
  const dir = join(outputDir, `${trace.persona}-${trace.sessionId}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "trace.json");
  writeFileSync(path, JSON.stringify(trace, null, 2), "utf-8");
  return path;
}
