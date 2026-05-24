/**
 * Persistência Edit Learner v0 — S-OC-10/11 (DS-04 motor).
 *
 * Log estruturado de decisões do operador (approve/edit/reject/override)
 * na tabela `jun_decisions`. Schema já existe em db.ts (PR2).
 *
 * Caller é o BFF Fastify nos endpoints /approve + /override.
 * Fail-soft: erros de INSERT logados mas não falham a decisão (operator
 * UX prioridade).
 */

import type { Database as DatabaseType } from "better-sqlite3";

export type JunDecisionType =
  | "approve"
  | "edit"
  | "reject"
  | "override"
  | "auto";

export interface RecordJunDecisionInput {
  sessionId: string;
  /** Turn number — UI passa via context. -1 se desconhecido. */
  turn: number;
  decision: JunDecisionType;
  originalText?: string;
  finalText?: string;
  overrideCardId?: string;
  rationale?: string;
}

export interface JunDecisionRecord {
  id: number;
  sessionId: string;
  turn: number;
  decision: JunDecisionType;
  originalText: string | null;
  finalText: string | null;
  overrideCardId: string | null;
  rationale: string | null;
  recordedAt: string;
}

const INSERT_SQL = `
  INSERT INTO jun_decisions (
    session_id, turn, decision, original_text, final_text,
    override_card_id, rationale, recorded_at
  ) VALUES (
    @sessionId, @turn, @decision, @originalText, @finalText,
    @overrideCardId, @rationale, @recordedAt
  )
`;

const SELECT_RECENT_SQL = `
  SELECT
    id, session_id AS sessionId, turn, decision,
    original_text AS originalText, final_text AS finalText,
    override_card_id AS overrideCardId, rationale,
    recorded_at AS recordedAt
  FROM jun_decisions
  WHERE session_id = @sessionId
  ORDER BY recorded_at DESC, id DESC
  LIMIT @limit
`;

export function recordJunDecision(
  db: DatabaseType,
  input: RecordJunDecisionInput,
  now: () => string = () => new Date().toISOString(),
): { id: number } | { error: string } {
  try {
    const stmt = db.prepare(INSERT_SQL);
    const result = stmt.run({
      sessionId: input.sessionId,
      turn: input.turn,
      decision: input.decision,
      originalText: input.originalText ?? null,
      finalText: input.finalText ?? null,
      overrideCardId: input.overrideCardId ?? null,
      rationale: input.rationale ?? null,
      recordedAt: now(),
    });
    return { id: Number(result.lastInsertRowid) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function listRecentJunDecisions(
  db: DatabaseType,
  sessionId: string,
  limit = 50,
): JunDecisionRecord[] {
  const stmt = db.prepare(SELECT_RECENT_SQL);
  const rows = stmt.all({ sessionId, limit }) as JunDecisionRecord[];
  return rows;
}
