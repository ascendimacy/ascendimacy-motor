/**
 * kids_parent_decisions — tabela de decisões parentais por content item.
 *
 * Fluxo:
 *   - Após triagem (camada 2 paper §6), o motor-drota propõe 1-2 alternativas.
 *   - Pais veem no painel e decidem: approved | rejected | pinned.
 *   - `pinned` vira `ContentItem.parent_pinned=true` no scorer (Bloco 1 já suporta).
 *   - Decisões persistem por session_id + content_id (UNIQUE).
 *
 * Spec: paper §6 "autorização em três camadas" + fundamentos §2 forbidden_zones.
 */

import type Database from "better-sqlite3";

export const PARENT_DECISION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "pinned",
] as const;
export type ParentDecisionStatus = (typeof PARENT_DECISION_STATUSES)[number];

export const PARENT_DECISIONS_DDL = `
CREATE TABLE IF NOT EXISTS kids_parent_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  decided_at TEXT NOT NULL,
  expires_at TEXT,
  UNIQUE(session_id, content_id)
);
`;

export interface ParentDecision {
  id?: number;
  session_id: string;
  content_id: string;
  status: ParentDecisionStatus;
  reason?: string;
  decided_at: string;
  expires_at?: string;
}

interface DecisionRow {
  id: number;
  session_id: string;
  content_id: string;
  status: string;
  reason: string | null;
  decided_at: string;
  expires_at: string | null;
}

function rowToDecision(row: DecisionRow): ParentDecision {
  return {
    id: row.id,
    session_id: row.session_id,
    content_id: row.content_id,
    status: row.status as ParentDecisionStatus,
    reason: row.reason ?? undefined,
    decided_at: row.decided_at,
    expires_at: row.expires_at ?? undefined,
  };
}

/** Upsert de decisão (UNIQUE por session × content). */
export function setParentDecision(
  db: Database.Database,
  input: Omit<ParentDecision, "id" | "decided_at"> & { decided_at?: string },
): ParentDecision {
  const now = input.decided_at ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO kids_parent_decisions (session_id, content_id, status, reason, decided_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, content_id) DO UPDATE SET
       status = excluded.status,
       reason = excluded.reason,
       decided_at = excluded.decided_at,
       expires_at = excluded.expires_at`,
  ).run(
    input.session_id,
    input.content_id,
    input.status,
    input.reason ?? null,
    now,
    input.expires_at ?? null,
  );
  const row = db
    .prepare(
      `SELECT * FROM kids_parent_decisions WHERE session_id = ? AND content_id = ?`,
    )
    .get(input.session_id, input.content_id) as DecisionRow;
  return rowToDecision(row);
}

/** Lê todas as decisões de uma sessão. */
export function listParentDecisions(
  db: Database.Database,
  sessionId: string,
): ParentDecision[] {
  const rows = db
    .prepare("SELECT * FROM kids_parent_decisions WHERE session_id = ? ORDER BY id")
    .all(sessionId) as DecisionRow[];
  return rows.map(rowToDecision);
}

/** Map content_id → ParentDecision pra lookup eficiente no scorer wrapper. */
export function getDecisionMap(
  db: Database.Database,
  sessionId: string,
): Map<string, ParentDecision> {
  const map = new Map<string, ParentDecision>();
  for (const d of listParentDecisions(db, sessionId)) {
    map.set(d.content_id, d);
  }
  return map;
}

/** Filtra rejeitados (não-expirados). Usado pelo pool-builder. */
export function getRejectedIds(
  db: Database.Database,
  sessionId: string,
  now?: string,
): Set<string> {
  const ts = now ?? new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT content_id FROM kids_parent_decisions
       WHERE session_id = ? AND status = 'rejected'
         AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .all(sessionId, ts) as Array<{ content_id: string }>;
  return new Set(rows.map((r) => r.content_id));
}

/** Retorna ids com status='pinned' não-expirados. */
export function getPinnedIds(
  db: Database.Database,
  sessionId: string,
  now?: string,
): Set<string> {
  const ts = now ?? new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT content_id FROM kids_parent_decisions
       WHERE session_id = ? AND status = 'pinned'
         AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .all(sessionId, ts) as Array<{ content_id: string }>;
  return new Set(rows.map((r) => r.content_id));
}
