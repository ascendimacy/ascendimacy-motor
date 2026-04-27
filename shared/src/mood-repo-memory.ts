/**
 * In-memory adapter pro `MoodRepo` (port em mood.ts).
 *
 * Uso: tests + STS smoke runs. Postgres concrete adapter fica pra
 * F1-bootstrap-db (ascendimacy-motor#40).
 *
 * Não é thread-safe — assume single-process. Array linear; load
 * filtra+sorta sob demanda. Aceitável pra volumes de teste/sim.
 */

import type { MoodReadingRow, MoodRepo } from "./mood.js";

/**
 * Cria adapter in-memory opcionalmente seedado com leituras iniciais.
 *
 * Cada chamada cria store independente — útil em tests pra isolamento.
 */
export function inMemoryMoodRepo(
  seed: MoodReadingRow[] = [],
): MoodRepo {
  const store: MoodReadingRow[] = [...seed];

  return {
    async loadHistory(userId, options = {}) {
      let rows = store.filter((r) => r.userId === userId);
      if (options.since) {
        const sinceMs = new Date(options.since).getTime();
        rows = rows.filter((r) => new Date(r.at).getTime() >= sinceMs);
      }
      rows.sort(
        (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
      );
      if (options.limit !== undefined) {
        rows = rows.slice(0, options.limit);
      }
      return rows;
    },
    async append(reading) {
      store.push(reading);
    },
  };
}
