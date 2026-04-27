/**
 * Tests do aggregate-gateway-logs (motor#28e DoD).
 *
 * Fixtures synthetic cobrindo:
 *   T1 — turn full success (3 steps, no fallback, latency<15s)
 *   T2 — turn full com fallback em 1 step (B-fail; C-pass se latency<15s)
 *   T3 — turn full com error em 1 step (B-fail; geralmente C-fail)
 *   T4 — partial turn (só 2 steps) — NÃO conta como "full", excluído
 */

import { describe, it, expect } from "vitest";
import { computeReport, groupByRunId } from "../src/aggregate.js";
import type { GatewayLogEntry } from "../src/aggregate.js";

const baseEvent: Omit<GatewayLogEntry, "step" | "run_id" | "request_id" | "ts"> = {
  provider: "infomaniak",
  model: "moonshotai/Kimi-K2.5",
  tokens: { in: 100, out: 50 },
  latency_ms: 2000,
  attempt_count: 1,
  outcome: "ok",
  error_class: null,
  was_fallback: false,
  primary_provider_attempted: null,
};

function ev(over: Partial<GatewayLogEntry>): GatewayLogEntry {
  return {
    ts: "2026-04-27T03:00:00.000Z",
    request_id: `req-${Math.random()}`,
    run_id: "default-run",
    step: "drota",
    ...baseEvent,
    ...over,
  };
}

const fixture: GatewayLogEntry[] = [
  // T1 — full success (3 steps, no fallback, latency total = 6000ms < 15000)
  ev({ run_id: "T1", step: "planejador", latency_ms: 2000 }),
  ev({ run_id: "T1", step: "drota", latency_ms: 2500 }),
  ev({ run_id: "T1", step: "signal-extractor", latency_ms: 1500 }),

  // T2 — full + fallback em drota (B-fail; C-pass: 2000+3000+1500=6500<15000)
  ev({ run_id: "T2", step: "planejador", latency_ms: 2000 }),
  ev({
    run_id: "T2",
    step: "drota",
    latency_ms: 3000,
    was_fallback: true,
    primary_provider_attempted: "infomaniak",
    outcome: "fallback_used",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
  }),
  ev({ run_id: "T2", step: "signal-extractor", latency_ms: 1500 }),

  // T3 — full com error em planejador (B-fail; C-fail provavelmente)
  ev({
    run_id: "T3",
    step: "planejador",
    latency_ms: 5000,
    outcome: "error",
    error_class: "GatewayError",
  }),
  ev({ run_id: "T3", step: "drota", latency_ms: 8000 }),
  ev({ run_id: "T3", step: "signal-extractor", latency_ms: 4000 }),
  // total T3 = 17000 > 15000 → C-fail também

  // T4 — partial (só 2 steps) — excluído de "full"
  ev({ run_id: "T4", step: "planejador", latency_ms: 2000 }),
  ev({ run_id: "T4", step: "drota", latency_ms: 2000 }),
];

describe("groupByRunId", () => {
  it("agrupa events por run_id e identifica is_full corretamente", () => {
    const turns = groupByRunId(fixture);
    expect(turns.size).toBe(4);
    expect(turns.get("T1")!.is_full).toBe(true);
    expect(turns.get("T2")!.is_full).toBe(true);
    expect(turns.get("T3")!.is_full).toBe(true);
    expect(turns.get("T4")!.is_full).toBe(false); // 2 steps apenas
  });

  it("calcula total_latency_ms e flags any_*", () => {
    const turns = groupByRunId(fixture);
    expect(turns.get("T1")!.total_latency_ms).toBe(6000);
    expect(turns.get("T1")!.any_fallback).toBe(false);
    expect(turns.get("T1")!.any_error).toBe(false);

    expect(turns.get("T2")!.any_fallback).toBe(true);
    expect(turns.get("T2")!.any_error).toBe(false);

    expect(turns.get("T3")!.total_latency_ms).toBe(17000);
    expect(turns.get("T3")!.any_error).toBe(true);
  });
});

describe("computeReport — Métrica B (turn-level)", () => {
  it("conta apenas turns FULL, success = sem fallback E sem error", () => {
    const r = computeReport(fixture);
    expect(r.total_turns_observed).toBe(4);
    expect(r.total_turns_full).toBe(3); // T1+T2+T3
    expect(r.metric_b_turn_level.passed).toBe(1); // só T1
    expect(r.metric_b_turn_level.total).toBe(3);
    expect(r.metric_b_turn_level.rate).toBeCloseTo(1 / 3, 3);
  });
});

describe("computeReport — Métrica C (E2E SLA proxy)", () => {
  it("threshold default 15s: T1+T2 pass (6s+6.5s), T3 fail (17s)", () => {
    const r = computeReport(fixture);
    expect(r.metric_c_e2e_sla.threshold_ms).toBe(15_000);
    expect(r.metric_c_e2e_sla.passed).toBe(2); // T1+T2
    expect(r.metric_c_e2e_sla.total).toBe(3);
    expect(r.metric_c_e2e_sla.rate).toBeCloseTo(2 / 3, 3);
  });

  it("threshold customizado 5000ms: nenhum passa", () => {
    const r = computeReport(fixture, { e2eSlaMs: 5000 });
    expect(r.metric_c_e2e_sla.passed).toBe(0);
    expect(r.metric_c_e2e_sla.threshold_ms).toBe(5000);
  });
});

describe("computeReport — fallback + error breakdown", () => {
  it("counta fallbacks corretamente", () => {
    const r = computeReport(fixture);
    expect(r.fallback_events.count).toBe(1);
    expect(r.fallback_events.by_step).toEqual({ drota: 1 });
  });

  it("counta errors por class", () => {
    const r = computeReport(fixture);
    expect(r.error_events.count).toBe(1);
    expect(r.error_events.by_class).toEqual({ GatewayError: 1 });
  });
});

describe("computeReport — provider mix + latency", () => {
  it("provider mix conta events corretamente", () => {
    const r = computeReport(fixture);
    // 11 events total; 1 anthropic (T2 drota fallback), resto infomaniak
    expect(r.provider_mix.infomaniak).toBe(10);
    expect(r.provider_mix.anthropic).toBe(1);
  });

  it("latency p50 por step", () => {
    const r = computeReport(fixture);
    // planejador: T1=2000, T2=2000, T3=5000, T4=2000 → sorted [2000,2000,2000,5000]; p50 idx=2 → 2000
    expect(r.latency.by_step.planejador!.n).toBe(4); // T1+T2+T3+T4 todos têm planejador
    expect(r.latency.by_step.planejador!.p50).toBe(2000);
    // drota: T1=2500, T2=3000, T3=8000, T4=2000 → sorted [2000,2500,3000,8000]; p50 idx=2 → 3000
    expect(r.latency.by_step.drota!.n).toBe(4); // T1+T2+T3+T4 todos têm drota
    expect(r.latency.by_step.drota!.p50).toBe(3000);
  });
});

describe("computeReport — empty input edge case", () => {
  it("rates = 0 quando sem turns", () => {
    const r = computeReport([]);
    expect(r.total_turns_observed).toBe(0);
    expect(r.metric_b_turn_level.rate).toBe(0);
    expect(r.metric_c_e2e_sla.rate).toBe(0);
  });
});

describe("computeReport — requiredSteps configurável (motor#28f)", () => {
  // Fixture STS-style: turns têm planejador + drota apenas (sem signal-extractor)
  const stsFixture: GatewayLogEntry[] = [
    // S1 — sucesso pleno (2 steps STS, sem fallback, latency 35s)
    ev({ run_id: "S1", step: "planejador", latency_ms: 15000 }),
    ev({ run_id: "S1", step: "drota", latency_ms: 20000 }),
    // S2 — sucesso pleno (2 steps STS, sem fallback, latency 12s — passa SLA)
    ev({ run_id: "S2", step: "planejador", latency_ms: 5000 }),
    ev({ run_id: "S2", step: "drota", latency_ms: 7000 }),
  ];

  it("STS context: requiredSteps=['planejador','drota'] → 2 turns FULL", () => {
    const r = computeReport(stsFixture, { requiredSteps: ["planejador", "drota"] });
    expect(r.required_steps).toEqual(["planejador", "drota"]);
    expect(r.total_turns_full).toBe(2); // S1 + S2 full
    expect(r.metric_b_turn_level.passed).toBe(2);
    expect(r.metric_b_turn_level.rate).toBe(1.0);
  });

  it("STS context: Métrica C respeita threshold (S1 35s > 15s fail; S2 12s pass)", () => {
    const r = computeReport(stsFixture, { requiredSteps: ["planejador", "drota"] });
    expect(r.metric_c_e2e_sla.passed).toBe(1); // só S2
    expect(r.metric_c_e2e_sla.rate).toBe(0.5);
  });

  it("default (sem opt) preserva comportamento — turn 2-step não conta como FULL", () => {
    // Regression check: motor's own pipeline expects 3 steps
    const r = computeReport(stsFixture);
    expect(r.required_steps).toEqual([
      "planejador",
      "drota",
      "signal-extractor",
    ]);
    expect(r.total_turns_full).toBe(0); // nenhum turn tem signal-extractor
    expect(r.metric_b_turn_level.total).toBe(0);
  });

  it("requiredSteps customizado funciona com lista qualquer", () => {
    const events: GatewayLogEntry[] = [
      ev({ run_id: "X", step: "haiku-triage", latency_ms: 500 }),
      ev({ run_id: "X", step: "drota", latency_ms: 2000 }),
    ];
    const r = computeReport(events, { requiredSteps: ["haiku-triage", "drota"] });
    expect(r.total_turns_full).toBe(1);
    expect(r.metric_b_turn_level.rate).toBe(1.0);
  });
});
