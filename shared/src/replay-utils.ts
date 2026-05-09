/**
 * Replay utilities — primitivas reutilizáveis para tooling de replay
 * de NDJSON (debug-timeline.mjs e variantes).
 *
 * Sprint 0 PR6 (motor#TBD). Story ops#506 (S-N-01-05).
 * Capability ops#482 (C-N-01).
 *
 * Exposed para permitir:
 *  - Filtragem por scope_id (essencial pós S-N-01-01 onde múltiplos
 *    scopes coexistem em mesmo NDJSON em runs concorrentes)
 *  - Agrupamento por scope (reconstrução cronológica por escopo)
 *  - Detecção de gaps/duplicates por scope (validação de integridade)
 *  - Ordenação cronológica determinística (desempate por scope_id + seq)
 */

/** Subset mínimo de DebugEventLine consumido por replay tooling. */
export interface ReplayEvent {
  run_id: string;
  scope_id: string;
  seq: number;
  ts: string;
  side: "sts" | "motor";
  step: string;
  user_id: string;
  outcome: "ok" | "error" | "skip";
  // Campos opcionais — replay não exige (mas pode usar se presentes)
  partner_user_id?: string | null;
  session_id?: string | null;
  turn_number?: number | null;
  model?: string | null;
  tokens?: { in: number; out: number; reasoning: number } | null;
  latency_ms?: number | null;
  cost_usd_est?: number | null;
  [k: string]: unknown;
}

/** Filtra events do scope alvo apenas. Não muta input. */
export function filterByScopeId(events: readonly ReplayEvent[], scopeId: string): ReplayEvent[] {
  return events.filter((e) => e.scope_id === scopeId);
}

/** Agrupa events por scope_id. Preserva ordem de aparição dentro de cada grupo. */
export function groupEventsByScope(events: readonly ReplayEvent[]): Map<string, ReplayEvent[]> {
  const out = new Map<string, ReplayEvent[]>();
  for (const e of events) {
    const list = out.get(e.scope_id);
    if (list) list.push(e);
    else out.set(e.scope_id, [e]);
  }
  return out;
}

/**
 * Ordena events cronologicamente por `ts` ascendente.
 * Desempate determinístico por (scope_id ASC, seq ASC) quando `ts` é igual
 * — relevante quando múltiplos eventos compartilham timestamp ms-truncado.
 * NÃO muta input array.
 */
export function sortChronologically(events: readonly ReplayEvent[]): ReplayEvent[] {
  return [...events].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts.localeCompare(b.ts);
    if (a.scope_id !== b.scope_id) return a.scope_id.localeCompare(b.scope_id);
    return a.seq - b.seq;
  });
}

export interface GapDetectionResult {
  scope_id: string;
  observed: number;
  expected: number;
  gaps: number[];
  duplicates: number[];
  min_seq: number | null;
  max_seq: number | null;
}

/**
 * Detecta gaps + duplicates de seq dentro de um scope específico.
 * Útil para validação de integridade NDJSON pós-runs concorrentes
 * (cenário ops#398 F1-G5: 200 gaps + 20 duplicates em 6 scopes).
 *
 * `expected` = max(seq) - min(seq) + 1 (contagem ideal sem gaps).
 * `observed` = quantidade de events do scope.
 * Discrepância expected-observed indica gaps/duplicates.
 */
export function detectGapsInScope(
  events: readonly ReplayEvent[],
  scopeId: string,
): GapDetectionResult {
  const scoped = events.filter((e) => e.scope_id === scopeId);
  if (scoped.length === 0) {
    return { scope_id: scopeId, observed: 0, expected: 0, gaps: [], duplicates: [], min_seq: null, max_seq: null };
  }
  const seqs = scoped.map((e) => e.seq);
  const seen = new Set<number>();
  const dups: number[] = [];
  for (const s of seqs) {
    if (seen.has(s)) dups.push(s);
    seen.add(s);
  }
  const min = Math.min(...seqs);
  const max = Math.max(...seqs);
  const gaps: number[] = [];
  for (let i = min; i <= max; i++) {
    if (!seen.has(i)) gaps.push(i);
  }
  return {
    scope_id: scopeId,
    observed: scoped.length,
    expected: max - min + 1,
    gaps,
    duplicates: [...new Set(dups)].sort((a, b) => a - b),
    min_seq: min,
    max_seq: max,
  };
}
