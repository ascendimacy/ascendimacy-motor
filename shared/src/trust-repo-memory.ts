/**
 * In-memory adapter pro `TrustRepo` (port em trust.ts).
 *
 * Uso: tests + STS smoke runs. Postgres concrete adapter fica pra
 * F1-bootstrap-db (ascendimacy-motor#40).
 *
 * Map<userId, TrustCacheEntry>; cada chamada cria store independente.
 */

import type { TrustCacheEntry, TrustRepo } from "./trust.js";

export function inMemoryTrustRepo(
  seed: TrustCacheEntry[] = [],
): TrustRepo {
  const store = new Map<string, TrustCacheEntry>();
  for (const entry of seed) {
    store.set(entry.userId, entry);
  }

  return {
    async loadCachedLevel(userId) {
      return store.get(userId) ?? null;
    },
    async saveCachedLevel(entry) {
      store.set(entry.userId, entry);
    },
  };
}
