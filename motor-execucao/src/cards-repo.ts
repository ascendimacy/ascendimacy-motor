/**
 * kids_emitted_cards — persistência de cards emitidos.
 *
 * Spec: Handoff #17 Bloco 5a (b).
 * Invariante: cards nunca revogados (fundamentos §8 invariante #4).
 */

import type Database from "better-sqlite3";
import type { EmittedCard } from "@ascendimacy/shared";

export const EMITTED_CARDS_DDL = `
CREATE TABLE IF NOT EXISTS kids_emitted_cards (
  card_id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  archetype_id TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  signature TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  emitted_at TEXT NOT NULL,
  front_json TEXT NOT NULL,
  back_json TEXT NOT NULL,
  spec_snapshot_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_by_child ON kids_emitted_cards(child_id);
CREATE INDEX IF NOT EXISTS idx_cards_by_session ON kids_emitted_cards(session_id);
CREATE INDEX IF NOT EXISTS idx_cards_by_emitted_at ON kids_emitted_cards(emitted_at);
`;

interface CardRow {
  card_id: string;
  child_id: string;
  session_id: string;
  archetype_id: string;
  serial_number: string;
  signature: string;
  issued_at: string;
  approved_at: string;
  emitted_at: string;
  front_json: string;
  back_json: string;
  spec_snapshot_json: string;
}

function rowToCard(row: CardRow): EmittedCard {
  return {
    card_id: row.card_id,
    child_id: row.child_id,
    session_id: row.session_id,
    archetype_id: row.archetype_id,
    front: JSON.parse(row.front_json),
    back: JSON.parse(row.back_json),
    spec_snapshot: JSON.parse(row.spec_snapshot_json),
    signature: row.signature,
    issued_at: row.issued_at,
    approved_at: row.approved_at,
    emitted_at: row.emitted_at,
  };
}

/** Persiste um card; idempotente pelo card_id. */
export function saveEmittedCard(db: Database.Database, card: EmittedCard): void {
  db.prepare(
    `INSERT OR REPLACE INTO kids_emitted_cards
      (card_id, child_id, session_id, archetype_id, serial_number, signature,
       issued_at, approved_at, emitted_at, front_json, back_json, spec_snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    card.card_id,
    card.child_id,
    card.session_id,
    card.archetype_id,
    card.back.serial_number,
    card.signature,
    card.issued_at,
    card.approved_at,
    card.emitted_at,
    JSON.stringify(card.front),
    JSON.stringify(card.back),
    JSON.stringify(card.spec_snapshot),
  );
}

export function getEmittedCardsByChild(
  db: Database.Database,
  childId: string,
): EmittedCard[] {
  const rows = db
    .prepare("SELECT * FROM kids_emitted_cards WHERE child_id = ? ORDER BY emitted_at")
    .all(childId) as CardRow[];
  return rows.map(rowToCard);
}

export function getEmittedCardsBySession(
  db: Database.Database,
  sessionId: string,
): EmittedCard[] {
  const rows = db
    .prepare("SELECT * FROM kids_emitted_cards WHERE session_id = ? ORDER BY emitted_at")
    .all(sessionId) as CardRow[];
  return rows.map(rowToCard);
}

export function getEmittedCardsInRange(
  db: Database.Database,
  childId: string,
  fromIso: string,
  toIso: string,
): EmittedCard[] {
  const rows = db
    .prepare(
      `SELECT * FROM kids_emitted_cards
       WHERE child_id = ? AND emitted_at >= ? AND emitted_at < ?
       ORDER BY emitted_at`,
    )
    .all(childId, fromIso, toIso) as CardRow[];
  return rows.map(rowToCard);
}

/** Próxima sequence (count + 1) por child — usado por formatSerialNumber. */
export function getNextSequence(db: Database.Database, childId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM kids_emitted_cards WHERE child_id = ?")
    .get(childId) as { n: number };
  return row.n + 1;
}
