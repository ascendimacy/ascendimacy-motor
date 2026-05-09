/**
 * Unit tests para replay-utils — primitivas reutilizáveis pelo
 * scripts/debug-timeline.mjs e outros tooling de replay.
 *
 * Sprint 0 PR6 (motor#TBD). Story ops#506 (S-N-01-05).
 * Capability ops#482 (C-N-01).
 */

import { describe, it, expect } from "vitest";
import {
  filterByScopeId,
  groupEventsByScope,
  sortChronologically,
  detectGapsInScope,
  type ReplayEvent,
} from "../src/replay-utils.js";

const E = (overrides: Partial<ReplayEvent>): ReplayEvent => ({
  run_id: "test-run",
  scope_id: "scope-A",
  seq: 1,
  ts: "2026-05-09T10:00:00.000Z",
  side: "motor",
  step: "drota",
  user_id: "ryo",
  outcome: "ok",
  ...overrides,
});

describe("filterByScopeId", () => {
  it("filtra events do scope alvo apenas", () => {
    const events = [
      E({ scope_id: "scope-A", seq: 1 }),
      E({ scope_id: "scope-B", seq: 1 }),
      E({ scope_id: "scope-A", seq: 2 }),
    ];
    const r = filterByScopeId(events, "scope-A");
    expect(r).toHaveLength(2);
    expect(r.every((e) => e.scope_id === "scope-A")).toBe(true);
  });

  it("retorna [] para scope inexistente", () => {
    expect(filterByScopeId([E({})], "scope-zzz")).toEqual([]);
  });

  it("array vazio entra, array vazio sai", () => {
    expect(filterByScopeId([], "scope-A")).toEqual([]);
  });
});

describe("groupEventsByScope", () => {
  it("agrupa events por scope_id", () => {
    const events = [
      E({ scope_id: "alpha", seq: 1 }),
      E({ scope_id: "beta", seq: 1 }),
      E({ scope_id: "alpha", seq: 2 }),
      E({ scope_id: "beta", seq: 2 }),
    ];
    const grouped = groupEventsByScope(events);
    expect(grouped.size).toBe(2);
    expect(grouped.get("alpha")).toHaveLength(2);
    expect(grouped.get("beta")).toHaveLength(2);
  });

  it("preserva ordem original dentro de cada grupo", () => {
    const events = [
      E({ scope_id: "x", seq: 3, ts: "2026-05-09T10:00:03Z" }),
      E({ scope_id: "x", seq: 1, ts: "2026-05-09T10:00:01Z" }),
      E({ scope_id: "x", seq: 2, ts: "2026-05-09T10:00:02Z" }),
    ];
    const grouped = groupEventsByScope(events);
    const xEvents = grouped.get("x")!;
    expect(xEvents.map((e) => e.seq)).toEqual([3, 1, 2]); // ordem preservada
  });

  it("Map vazio para input vazio", () => {
    expect(groupEventsByScope([]).size).toBe(0);
  });
});

describe("sortChronologically", () => {
  it("ordena por ts ascending", () => {
    const events = [
      E({ ts: "2026-05-09T10:00:03Z", seq: 3 }),
      E({ ts: "2026-05-09T10:00:01Z", seq: 1 }),
      E({ ts: "2026-05-09T10:00:02Z", seq: 2 }),
    ];
    const sorted = sortChronologically(events);
    expect(sorted.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("desempate por (scope_id, seq) quando ts é igual", () => {
    const events = [
      E({ ts: "2026-05-09T10:00:00Z", scope_id: "z", seq: 1 }),
      E({ ts: "2026-05-09T10:00:00Z", scope_id: "a", seq: 2 }),
      E({ ts: "2026-05-09T10:00:00Z", scope_id: "a", seq: 1 }),
    ];
    const sorted = sortChronologically(events);
    expect(sorted.map((e) => `${e.scope_id}#${e.seq}`)).toEqual(["a#1", "a#2", "z#1"]);
  });

  it("não muta input array", () => {
    const events = [
      E({ ts: "2026-05-09T10:00:02Z", seq: 2 }),
      E({ ts: "2026-05-09T10:00:01Z", seq: 1 }),
    ];
    const original = [...events];
    sortChronologically(events);
    expect(events).toEqual(original);
  });
});

describe("detectGapsInScope", () => {
  it("retorna {gaps: [], duplicates: []} para scope monotônico sem gaps", () => {
    const events = [E({ scope_id: "x", seq: 1 }), E({ scope_id: "x", seq: 2 }), E({ scope_id: "x", seq: 3 })];
    const r = detectGapsInScope(events, "x");
    expect(r.gaps).toEqual([]);
    expect(r.duplicates).toEqual([]);
    expect(r.expected).toBe(3);
    expect(r.observed).toBe(3);
  });

  it("detecta gap (seq missing)", () => {
    const events = [E({ scope_id: "x", seq: 1 }), E({ scope_id: "x", seq: 3 })];
    const r = detectGapsInScope(events, "x");
    expect(r.gaps).toContain(2);
    expect(r.duplicates).toEqual([]);
  });

  it("detecta duplicates (seq repetido)", () => {
    const events = [
      E({ scope_id: "x", seq: 1 }),
      E({ scope_id: "x", seq: 2 }),
      E({ scope_id: "x", seq: 2 }),
    ];
    const r = detectGapsInScope(events, "x");
    expect(r.duplicates).toContain(2);
    expect(r.gaps).toEqual([]);
  });

  it("detecta múltiplos gaps em sequência longa (cenário ops#398 F1-G5)", () => {
    const events = [
      E({ scope_id: "y", seq: 1 }),
      E({ scope_id: "y", seq: 5 }), // gap 2,3,4
      E({ scope_id: "y", seq: 7 }), // gap 6
      E({ scope_id: "y", seq: 7 }), // dup 7
    ];
    const r = detectGapsInScope(events, "y");
    expect(r.gaps).toEqual([2, 3, 4, 6]);
    expect(r.duplicates).toEqual([7]);
  });

  it("ignora events de outros scopes", () => {
    const events = [
      E({ scope_id: "x", seq: 1 }),
      E({ scope_id: "y", seq: 5 }), // não conta para x
      E({ scope_id: "x", seq: 2 }),
    ];
    const r = detectGapsInScope(events, "x");
    expect(r.gaps).toEqual([]);
    expect(r.observed).toBe(2);
  });
});
