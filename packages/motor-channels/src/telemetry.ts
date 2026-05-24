/**
 * Telemetria de cartas-acionadas — S-MX-06-10 (ops#1115).
 *
 * D3 ratificado: sqlite local (V0.1); CF Analytics Engine fica pra V0.2.
 *
 * Cada `CardActivatedEvent` é persistido com:
 *  - timestamp (ISO 8601 do evento)
 *  - cardId
 *  - fromHash (SHA-256 do `from` — LGPD/APPI: identifica usuário sem
 *    expor o JID original; suficiente pra agregar sem permitir lookup
 *    reverso fácil)
 *  - conversationId
 *  - recordedAt (ISO 8601 do momento do insert — diferente de timestamp
 *    se o evento for replayed)
 *
 * NÃO é wireado automaticamente ao bridge — é uma sink que o caller
 * (entry script / orchestrator) decide conectar via `record(ev)`.
 * Mantém SRP: bridge faz routing, telemetry faz persistência.
 */

import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import type { CardActivatedEvent } from "./types.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS card_activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  card_id TEXT NOT NULL,
  from_hash TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_activations_card_id
  ON card_activations(card_id);
CREATE INDEX IF NOT EXISTS idx_card_activations_timestamp
  ON card_activations(timestamp);
`;

export interface CardTelemetryOptions {
  /** Caminho do arquivo SQLite. Use `":memory:"` em testes pra evitar fs.
   *  Schema é criado idempotentemente no construct se faltar. */
  dbPath: string;
  /** Função pra obter timestamp do insert. Default `Date.now()` (via
   *  `new Date().toISOString()`). Tests injetam fixed clock. */
  now?: () => string;
}

/** Registro persistido. Shape stable pra consumo por relatórios. */
export interface CardActivationRecord {
  id: number;
  timestamp: string;
  cardId: string;
  fromHash: string;
  conversationId: string;
  recordedAt: string;
}

export interface CardTelemetry {
  /** Persiste um CardActivatedEvent. Anonimiza `from` via SHA-256.
   *  Retorna o `id` autoincrement do registro. */
  record(event: CardActivatedEvent): number;
  /** Últimas `n` ativações em ordem decrescente de `recorded_at`.
   *  Útil pra debugging/dashboard. */
  getRecent(limit: number): CardActivationRecord[];
  /** Conta total por cardId. Útil pra "top cards". */
  countByCardId(cardId: string): number;
  /** Fecha o handle SQLite. Idempotente. */
  close(): void;
}

const hashFrom = (from: string): string =>
  createHash("sha256").update(from).digest("hex");

const rowToRecord = (row: {
  id: number;
  timestamp: string;
  card_id: string;
  from_hash: string;
  conversation_id: string;
  recorded_at: string;
}): CardActivationRecord => ({
  id: row.id,
  timestamp: row.timestamp,
  cardId: row.card_id,
  fromHash: row.from_hash,
  conversationId: row.conversation_id,
  recordedAt: row.recorded_at,
});

export function createCardTelemetry(
  opts: CardTelemetryOptions,
): CardTelemetry {
  const db: DatabaseType = new Database(opts.dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);

  const now = opts.now ?? (() => new Date().toISOString());

  const insertStmt = db.prepare(`
    INSERT INTO card_activations (
      timestamp, card_id, from_hash, conversation_id, recorded_at
    ) VALUES (?, ?, ?, ?, ?)
  `);

  const getRecentStmt = db.prepare(`
    SELECT id, timestamp, card_id, from_hash, conversation_id, recorded_at
    FROM card_activations
    ORDER BY recorded_at DESC, id DESC
    LIMIT ?
  `);

  const countByCardStmt = db.prepare(`
    SELECT COUNT(*) AS n FROM card_activations WHERE card_id = ?
  `);

  let closed = false;

  return {
    record(event: CardActivatedEvent): number {
      if (closed) throw new Error("CardTelemetry.record: db já fechado");
      const result = insertStmt.run(
        event.timestamp,
        event.cardId,
        hashFrom(event.from),
        event.conversationId,
        now(),
      );
      return Number(result.lastInsertRowid);
    },

    getRecent(limit: number): CardActivationRecord[] {
      if (closed) throw new Error("CardTelemetry.getRecent: db já fechado");
      const rows = getRecentStmt.all(limit) as Parameters<
        typeof rowToRecord
      >[0][];
      return rows.map(rowToRecord);
    },

    countByCardId(cardId: string): number {
      if (closed)
        throw new Error("CardTelemetry.countByCardId: db já fechado");
      const row = countByCardStmt.get(cardId) as { n: number };
      return row.n;
    },

    close(): void {
      if (closed) return;
      db.close();
      closed = true;
    },
  };
}
