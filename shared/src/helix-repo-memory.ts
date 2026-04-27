/**
 * In-memory adapter pro `HelixRepo` (port aqui mesmo).
 *
 * Uso: tests + STS smoke runs. Postgres concrete adapter vai junto
 * em F1-bootstrap-db (motor#40) — schema `helix_state` table com JSONB
 * pra queue/deferred/completed.
 *
 * Pattern idêntico aos outros *-repo-memory.ts (mood, trust).
 */

import type { HelixState } from "./helix-state.js";

/**
 * Port de persistência. Implementações:
 *   - InMemory (tests/STS): inMemoryHelixRepo (este arquivo)
 *   - Postgres (produção): F1-bootstrap-db
 */
export interface HelixRepo {
  /** Lê estado do user. Retorna null se nunca inicializado. */
  load(userId: string): Promise<HelixState | null>;
  /** Persiste estado. Idempotente (upsert). */
  save(state: HelixState): Promise<void>;
}

/**
 * Cria adapter in-memory. Map<userId, HelixState>; cada chamada cria
 * store independente (isolamento em tests).
 */
export function inMemoryHelixRepo(seed: HelixState[] = []): HelixRepo {
  const store = new Map<string, HelixState>();
  for (const s of seed) {
    store.set(s.userId, s);
  }

  return {
    async load(userId) {
      return store.get(userId) ?? null;
    },
    async save(state) {
      store.set(state.userId, state);
    },
  };
}
