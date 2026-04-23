import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionState, EventEntry } from "@ascendimacy/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

function getDb(dbPath?: string): Database.Database {
  if (!db) {
    const defaultPath = join(__dirname, "../../.motor-state.db");
    const path = dbPath ?? defaultPath;
    db = new Database(path);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        trust_level REAL DEFAULT 0.3,
        budget_remaining REAL DEFAULT 100,
        turn INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        timestamp TEXT,
        type TEXT,
        playbook_id TEXT,
        data TEXT
      );
    `);
  }
  return db;
}

export function getState(sessionId: string): SessionState {
  const database = getDb();
  let row = database.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId) as Record<string, unknown> | undefined;
  if (!row) {
    const now = new Date().toISOString();
    database.prepare("INSERT INTO sessions (session_id, trust_level, budget_remaining, turn, created_at, updated_at) VALUES (?, 0.3, 100, 0, ?, ?)").run(sessionId, now, now);
    row = { session_id: sessionId, trust_level: 0.3, budget_remaining: 100, turn: 0 };
  }
  const events = database.prepare("SELECT * FROM event_log WHERE session_id = ? ORDER BY id DESC LIMIT 20").all(sessionId) as Record<string, unknown>[];
  return {
    sessionId,
    trustLevel: Number(row["trust_level"]),
    budgetRemaining: Number(row["budget_remaining"]),
    turn: Number(row["turn"]),
    eventLog: events.map(e => ({
      timestamp: String(e["timestamp"]),
      type: String(e["type"]),
      playbookId: e["playbook_id"] ? String(e["playbook_id"]) : undefined,
      data: JSON.parse(String(e["data"] ?? "{}")),
    })),
  };
}

export function updateState(sessionId: string, delta: Partial<SessionState>): void {
  const database = getDb();
  const now = new Date().toISOString();
  database.prepare("UPDATE sessions SET trust_level = ?, budget_remaining = ?, turn = ?, updated_at = ? WHERE session_id = ?")
    .run(delta.trustLevel ?? 0.3, delta.budgetRemaining ?? 100, delta.turn ?? 0, now, sessionId);
}

export function logEvent(sessionId: string, event: EventEntry): void {
  const database = getDb();
  database.prepare("INSERT INTO event_log (session_id, timestamp, type, playbook_id, data) VALUES (?, ?, ?, ?, ?)")
    .run(sessionId, event.timestamp, event.type, event.playbookId ?? null, JSON.stringify(event.data));
}

export function closeDb(): void {
  if (db) { db.close(); db = null; }
}
