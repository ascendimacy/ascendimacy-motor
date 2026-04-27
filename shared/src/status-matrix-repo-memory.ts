/**
 * In-memory adapter pro `StatusMatrixRepo` (port em status-matrix.ts).
 *
 * Uso: tests + STS smoke runs. Postgres concrete adapter fica pra
 * F1-bootstrap-db (sub-issue separada).
 *
 * Não é thread-safe — assumindo single-process. Map() de chave composta
 * `userId|dimension`.
 */

import type {
  StatusMatrixEntry,
  StatusMatrixRepo,
} from "./status-matrix.js";

/**
 * Cria adapter in-memory opcionalmente seedado com entries iniciais.
 *
 * Cada chamada cria store independente — útil em tests pra isolamento.
 */
export function inMemoryStatusMatrixRepo(
  seed: StatusMatrixEntry[] = [],
): StatusMatrixRepo {
  const store = new Map<string, StatusMatrixEntry>();
  for (const entry of seed) {
    store.set(keyOf(entry.userId, entry.dimension), entry);
  }

  return {
    async loadAll(userId: string): Promise<StatusMatrixEntry[]> {
      return Array.from(store.values()).filter((e) => e.userId === userId);
    },
    async upsert(entry: StatusMatrixEntry): Promise<void> {
      store.set(keyOf(entry.userId, entry.dimension), entry);
    },
  };
}

function keyOf(userId: string, dimension: string): string {
  return `${userId}|${dimension}`;
}
