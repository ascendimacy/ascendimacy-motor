/**
 * Postgres concrete adapter pro `StatusMatrixRepo` (port em status-matrix.ts).
 *
 * Substitui `inMemoryStatusMatrixRepo` em produção. CHECK constraint
 * da tabela (status IN ('brejo','baia','pasto')) age como guarda final
 * — invariante brejo↔pasto direto fica protegida em código (pure function
 * `transition()` em status-matrix.ts), não em DB-side.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-27-statevector-primitives-inventory-f1.md §5
 * Sub-issue bootstrap: ascendimacy-motor#40
 */

import type {
  StatusMatrixEntry,
  StatusMatrixRepo,
  StatusValue,
} from "./status-matrix.js";
import { query } from "./db.js";

interface StatusMatrixRow {
  user_id: string;
  dimension: string;
  status: string;
  last_transition_at: Date;
}

/**
 * Cria adapter postgres consumindo o pool singleton de db.ts.
 *
 * Não recebe pool como param (pool é singleton via getPool()). Mantém
 * shape do port port-based — chamadas async, mesma interface que
 * inMemoryStatusMatrixRepo.
 */
export function pgStatusMatrixRepo(): StatusMatrixRepo {
  return {
    async loadAll(userId: string): Promise<StatusMatrixEntry[]> {
      const result = await query<StatusMatrixRow>(
        `SELECT user_id, dimension, status, last_transition_at
         FROM status_matrix
         WHERE user_id = $1`,
        [userId],
      );
      return result.rows.map((row) => ({
        userId: row.user_id,
        dimension: row.dimension,
        status: row.status as StatusValue,
        lastTransitionAt: row.last_transition_at.toISOString(),
      }));
    },

    async upsert(entry: StatusMatrixEntry): Promise<void> {
      await query(
        `INSERT INTO status_matrix (user_id, dimension, status, last_transition_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, dimension) DO UPDATE SET
           status = EXCLUDED.status,
           last_transition_at = EXCLUDED.last_transition_at`,
        [entry.userId, entry.dimension, entry.status, entry.lastTransitionAt],
      );
    },
  };
}
