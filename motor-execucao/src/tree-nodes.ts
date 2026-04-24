/**
 * tree_nodes SQLite CRUD + status matrix hydration.
 *
 * Espelho simplificado de `kids_tree_nodes` da ebrota (§17 FOUNDATION / tree.js).
 * Bloco 2a usa só zone='status'; zonas raiz/tronco/galho/folha entram em C-005.
 *
 * Spec: docs/handoffs/2026-04-24-cc-bloco2-plan.md §2.C v2 (override Jun).
 */

import type Database from "better-sqlite3";
import type {
  StatusMatrix,
  StatusValue,
  TreeNode,
  TreeNodeZone,
} from "@ascendimacy/shared";
import { transition, isStatusValue, defaultMatrix } from "@ascendimacy/shared";
import { getNow } from "./clock.js";

export const TREE_NODES_DDL = `
CREATE TABLE IF NOT EXISTS tree_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  zone TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  source TEXT NOT NULL DEFAULT 'engine',
  state TEXT NOT NULL DEFAULT 'seed',
  sensitivity TEXT NOT NULL DEFAULT 'free',
  urgency INTEGER NOT NULL DEFAULT 1,
  importance INTEGER NOT NULL DEFAULT 1,
  half_life_days INTEGER,
  last_active_at TEXT,
  cooldown_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, zone, key)
);
`;

interface TreeNodeRow {
  id: number;
  session_id: string;
  zone: string;
  key: string;
  value: string | null;
  source: string;
  state: string;
  sensitivity: string;
  urgency: number;
  importance: number;
  half_life_days: number | null;
  last_active_at: string | null;
  cooldown_until: string | null;
  created_at: string;
  updated_at: string;
}

function rowToNode(row: TreeNodeRow): TreeNode {
  return {
    id: row.id,
    sessionId: row.session_id,
    zone: row.zone as TreeNodeZone,
    key: row.key,
    value: row.value,
    source: row.source,
    state: row.state as TreeNode["state"],
    sensitivity: row.sensitivity as TreeNode["sensitivity"],
    urgency: row.urgency,
    importance: row.importance,
    halfLifeDays: row.half_life_days,
    lastActiveAt: row.last_active_at,
    cooldownUntil: row.cooldown_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UpsertNodeInput {
  sessionId: string;
  zone: TreeNodeZone;
  key: string;
  value: string | null;
  source?: string;
  state?: TreeNode["state"];
  sensitivity?: TreeNode["sensitivity"];
  urgency?: number;
  importance?: number;
  halfLifeDays?: number | null;
  now?: string;
}

export function upsertNode(
  db: Database.Database,
  input: UpsertNodeInput,
): TreeNode {
  const now = input.now ?? getNow();
  db.prepare(
    `INSERT INTO tree_nodes
     (session_id, zone, key, value, source, state, sensitivity, urgency, importance,
      half_life_days, last_active_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, zone, key) DO UPDATE SET
       value = excluded.value,
       source = excluded.source,
       state = excluded.state,
       sensitivity = excluded.sensitivity,
       urgency = excluded.urgency,
       importance = excluded.importance,
       half_life_days = excluded.half_life_days,
       last_active_at = excluded.last_active_at,
       updated_at = excluded.updated_at`,
  ).run(
    input.sessionId,
    input.zone,
    input.key,
    input.value,
    input.source ?? "engine",
    input.state ?? "seed",
    input.sensitivity ?? "free",
    input.urgency ?? 1,
    input.importance ?? 1,
    input.halfLifeDays ?? null,
    now,
    now,
    now,
  );
  const row = db
    .prepare(
      `SELECT * FROM tree_nodes WHERE session_id = ? AND zone = ? AND key = ?`,
    )
    .get(input.sessionId, input.zone, input.key) as TreeNodeRow;
  return rowToNode(row);
}

export interface GetNodesOptions {
  zone?: TreeNodeZone;
  source?: string;
}

export function getNodes(
  db: Database.Database,
  sessionId: string,
  opts: GetNodesOptions = {},
): TreeNode[] {
  const clauses: string[] = ["session_id = ?"];
  const args: (string | number)[] = [sessionId];
  if (opts.zone) {
    clauses.push("zone = ?");
    args.push(opts.zone);
  }
  if (opts.source) {
    clauses.push("source = ?");
    args.push(opts.source);
  }
  const rows = db
    .prepare(`SELECT * FROM tree_nodes WHERE ${clauses.join(" AND ")}`)
    .all(...args) as TreeNodeRow[];
  return rows.map(rowToNode);
}

/**
 * Coleta todos os nodes zone='status' e monta a StatusMatrix.
 * Preenche dimensões ausentes com default (baia) para evitar buracos.
 */
export function getStatusMatrix(
  db: Database.Database,
  sessionId: string,
): StatusMatrix {
  const rows = db
    .prepare(
      `SELECT key, value FROM tree_nodes WHERE session_id = ? AND zone = 'status'`,
    )
    .all(sessionId) as Array<{ key: string; value: string | null }>;
  const fromDb: StatusMatrix = {};
  for (const r of rows) {
    if (isStatusValue(r.value)) {
      fromDb[r.key] = r.value;
    }
  }
  // Merge com default para garantir presença das dimensões canônicas.
  return { ...defaultMatrix(), ...fromDb };
}

export interface ApplyStatusTransitionResult {
  dimension: string;
  target: StatusValue;
  applied: StatusValue;
  accepted: boolean;
  reason: string;
}

/**
 * Aplica uma transição no nó de status da dimensão — respeita a invariante
 * brejo → baia → pasto em 2 camadas: (1) tipo via `transition` pura,
 * (2) persistência via upsert.
 */
export function applyStatusTransition(
  db: Database.Database,
  sessionId: string,
  dimension: string,
  target: StatusValue,
  now?: string,
): ApplyStatusTransitionResult {
  const current = (() => {
    const row = db
      .prepare(
        `SELECT value FROM tree_nodes WHERE session_id = ? AND zone = 'status' AND key = ?`,
      )
      .get(sessionId, dimension) as { value: string | null } | undefined;
    if (!row) return undefined;
    return isStatusValue(row.value) ? row.value : undefined;
  })();
  const result = transition(current, target);
  upsertNode(db, {
    sessionId,
    zone: "status",
    key: dimension,
    value: result.applied,
    source: "engine",
    state: "done",
    now,
  });
  return {
    dimension,
    target,
    applied: result.applied,
    accepted: result.accepted,
    reason: result.reason,
  };
}
