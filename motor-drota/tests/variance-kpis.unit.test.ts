/**
 * Unit tests — variance/kpis.ts (H-AC-12, ops#1058).
 *
 * Cobre deriveOutcome / computeKpis / dist_alignment KL / passesV0Thresholds.
 * Tudo funções puras, mock-free.
 */

import { describe, it, expect } from "vitest";

import type { ActionMenu, PlayedAs } from "@ascendimacy/shared";

import {
  computeCostStats,
  computeDistAlignment,
  computeKpis,
  deriveOutcome,
  emptyDistribution,
  klDivergence,
  KPI_THRESHOLDS_V0,
  normalizeDistribution,
  observedDistribution,
  passesV0Thresholds,
  type RunResult,
} from "../src/variance/kpis.js";

function mockMenu(items: Array<{ played_as?: PlayedAs }>): ActionMenu {
  return {
    persona_id: "ryo-ochiai",
    schema_version: "v0.2.0",
    generated_at: "2026-05-13T20:00:00.000Z",
    source: { trust_level: 0.42 },
    items: items.map((it, i) => ({
      id: `it-${i}`,
      type: "curiosity" as const,
      content: `mock-${i}`,
      weight: 0.5,
      ...it,
    })),
  };
}

function mockRun(
  menu: ActionMenu | null,
  warnings: ReadonlyArray<string> = [],
  overrides: Partial<RunResult> = {},
): RunResult {
  return {
    menu,
    warnings: warnings as RunResult["warnings"],
    latencyMs: 1000,
    tokensIn: 4000,
    tokensOut: 1500,
    costUsdEst: 0.08,
    ...overrides,
  };
}

describe("deriveOutcome", () => {
  it("menu null → error", () => {
    expect(deriveOutcome(mockRun(null))).toBe("error");
  });

  it("menu OK + isa_labels_stripped → degraded", () => {
    expect(deriveOutcome(mockRun(mockMenu([{}]), ["isa_labels_stripped"]))).toBe(
      "degraded",
    );
  });

  it("menu OK + schema_error_first (retry recuperou) → ok-retry", () => {
    expect(
      deriveOutcome(mockRun(mockMenu([{}]), ["schema_error_first"])),
    ).toBe("ok-retry");
  });

  it("menu OK + parse_error_first → ok-retry", () => {
    expect(
      deriveOutcome(mockRun(mockMenu([{}]), ["parse_error_first"])),
    ).toBe("ok-retry");
  });

  it("menu OK + llm_error (recuperado) → ok-retry", () => {
    expect(deriveOutcome(mockRun(mockMenu([{}]), ["llm_error"]))).toBe(
      "ok-retry",
    );
  });

  it("menu OK + sem warnings → ok", () => {
    expect(deriveOutcome(mockRun(mockMenu([{}]), []))).toBe("ok");
  });

  it("prioridade: isa_labels_stripped > retry warnings (degraded vence)", () => {
    expect(
      deriveOutcome(
        mockRun(mockMenu([{}]), ["schema_error_first", "isa_labels_stripped"]),
      ),
    ).toBe("degraded");
  });
});

describe("computeKpis", () => {
  it("totaliza outcomes e calcula rates", () => {
    const runs = [
      mockRun(mockMenu([{}])),                                          // ok
      mockRun(mockMenu([{}])),                                          // ok
      mockRun(mockMenu([{}]), ["schema_error_first"]),                  // ok-retry
      mockRun(mockMenu([{}]), ["isa_labels_stripped"]),                 // degraded
      mockRun(null),                                                    // error
    ];
    const kpis = computeKpis(runs);
    expect(kpis.total).toBe(5);
    expect(kpis.passRateFirst).toBe(0.4);
    expect(kpis.recoveryRate).toBe(0.2);
    expect(kpis.degradationRate).toBe(0.2);
    expect(kpis.errorRate).toBe(0.2);
    // Soma exata = 1.0
    expect(
      kpis.passRateFirst + kpis.recoveryRate + kpis.degradationRate + kpis.errorRate,
    ).toBeCloseTo(1, 10);
  });

  it("array vazio → zeros", () => {
    const kpis = computeKpis([]);
    expect(kpis.total).toBe(0);
    expect(kpis.passRateFirst).toBe(0);
  });
});

describe("passesV0Thresholds — Opção B (multi-KPI)", () => {
  const baselineHealthy = {
    total: 30,
    passRateFirst: 0.7,
    recoveryRate: 0.2,
    degradationRate: 0.05,
    errorRate: 0.01,
  };

  it("KPIs saudáveis + dist OK → pass", () => {
    const r = passesV0Thresholds(baselineHealthy, 0.15);
    expect(r.ok).toBe(true);
  });

  it("pass_rate_first abaixo do limiar → fail", () => {
    const r = passesV0Thresholds(
      { ...baselineHealthy, passRateFirst: 0.4 },
      0.15,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failures.join(" ")).toMatch(/pass_rate_first/);
    }
  });

  it("recovery_rate acima do limiar → fail", () => {
    const r = passesV0Thresholds(
      { ...baselineHealthy, recoveryRate: 0.5 },
      0.15,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failures.join(" ")).toMatch(/recovery_rate/);
    }
  });

  it("degradation_rate acima do limiar → fail", () => {
    const r = passesV0Thresholds(
      { ...baselineHealthy, degradationRate: 0.15 },
      0.15,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failures.join(" ")).toMatch(/degradation_rate/);
    }
  });

  it("error_rate acima do limiar → fail", () => {
    const r = passesV0Thresholds({ ...baselineHealthy, errorRate: 0.1 }, 0.15);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failures.join(" ")).toMatch(/error_rate/);
    }
  });

  it("dist_alignment acima do limiar → fail", () => {
    const r = passesV0Thresholds(baselineHealthy, 0.5);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failures.join(" ")).toMatch(/dist_alignment/);
    }
  });

  it("multiple failures todas reportadas", () => {
    const r = passesV0Thresholds(
      {
        total: 30,
        passRateFirst: 0.2,
        recoveryRate: 0.6,
        degradationRate: 0.15,
        errorRate: 0.1,
      },
      0.8,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failures.length).toBe(5);
    }
  });

  it("constantes KPI_THRESHOLDS_V0 expostas e válidas", () => {
    expect(KPI_THRESHOLDS_V0.passRateFirstMin).toBe(0.5);
    expect(KPI_THRESHOLDS_V0.recoveryRateMax).toBe(0.4);
    expect(KPI_THRESHOLDS_V0.degradationRateMax).toBe(0.1);
    expect(KPI_THRESHOLDS_V0.errorRateMax).toBe(0.05);
    expect(KPI_THRESHOLDS_V0.distAlignmentMax).toBe(0.3);
  });
});

describe("observedDistribution", () => {
  it("agrega played_as de todos os items de todos os runs", () => {
    const runs = [
      mockRun(mockMenu([{ played_as: "espelho" }, { played_as: "canal" }])),
      mockRun(mockMenu([{ played_as: "espelho" }, { played_as: "bridge" }])),
    ];
    const dist = observedDistribution(runs);
    expect(dist.espelho).toBe(2);
    expect(dist.canal).toBe(1);
    expect(dist.bridge).toBe(1);
    expect(dist.diamante).toBe(0);
    expect(dist.arena).toBe(0);
    expect(dist.recovery).toBe(0);
  });

  it("ignora items sem played_as (graceful degradation)", () => {
    const runs = [mockRun(mockMenu([{ played_as: "espelho" }, {}]))];
    const dist = observedDistribution(runs);
    expect(dist.espelho).toBe(1);
    expect(Object.values(dist).reduce((s, v) => s + v, 0)).toBe(1);
  });

  it("ignora runs com menu null", () => {
    const runs = [mockRun(null), mockRun(mockMenu([{ played_as: "canal" }]))];
    const dist = observedDistribution(runs);
    expect(dist.canal).toBe(1);
  });
});

describe("klDivergence", () => {
  it("KL(p, p) = 0 (mesma distribuição)", () => {
    const p = { bridge: 0.2, espelho: 0.3, canal: 0.3, diamante: 0.1, arena: 0.05, recovery: 0.05 };
    expect(klDivergence(p, p)).toBeCloseTo(0, 8);
  });

  it("KL > 0 quando p diverge de q", () => {
    const observed = { bridge: 0.5, espelho: 0.1, canal: 0.1, diamante: 0.1, arena: 0.1, recovery: 0.1 };
    const expected = { bridge: 0.1, espelho: 0.5, canal: 0.2, diamante: 0.1, arena: 0.05, recovery: 0.05 };
    expect(klDivergence(observed, expected)).toBeGreaterThan(0);
  });

  it("p_i = 0 não contribui (convenção 0 × log = 0)", () => {
    const p = { bridge: 0, espelho: 0.5, canal: 0.5, diamante: 0, arena: 0, recovery: 0 };
    const q = { bridge: 0, espelho: 0.5, canal: 0.5, diamante: 0, arena: 0, recovery: 0 };
    expect(klDivergence(p, q)).toBe(0);
  });

  it("q_i = 0 com p_i > 0 não explode (laplace smoothing)", () => {
    const p = { bridge: 0.5, espelho: 0.5, canal: 0, diamante: 0, arena: 0, recovery: 0 };
    const q = { bridge: 0.5, espelho: 0.5, canal: 0, diamante: 0, arena: 0, recovery: 0 };
    // Mesmas duas distribuições — KL = 0
    expect(klDivergence(p, q)).toBeCloseTo(0, 8);

    // Agora p tem peso em canal mas q não — KL deve ser finito (não Infinity)
    const pCanal = { bridge: 0.3, espelho: 0.3, canal: 0.4, diamante: 0, arena: 0, recovery: 0 };
    const qSemCanal = { bridge: 0.5, espelho: 0.5, canal: 0, diamante: 0, arena: 0, recovery: 0 };
    const result = klDivergence(pCanal, qSemCanal);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(1); // grande pq smoothing 1e-6 é log(0.4 / 1e-6) ≈ 12.9
  });
});

describe("computeDistAlignment (e2e KL pipeline)", () => {
  it("Ryo deflective (hint pende espelho/canal) — distribuição realizada similar → KL baixo", () => {
    const runs = [
      mockRun(mockMenu([
        { played_as: "espelho" },
        { played_as: "espelho" },
        { played_as: "canal" },
        { played_as: "canal" },
        { played_as: "bridge" },
        { played_as: "diamante" },
      ])),
    ];
    const ryoBias: Array<{ played_as: PlayedAs; weight: number }> = [
      { played_as: "espelho", weight: 0.30 },
      { played_as: "canal", weight: 0.28 },
      { played_as: "bridge", weight: 0.15 },
      { played_as: "diamante", weight: 0.12 },
      { played_as: "arena", weight: 0.08 },
      { played_as: "recovery", weight: 0.07 },
    ];
    const kl = computeDistAlignment(runs, ryoBias);
    expect(kl).toBeLessThan(0.3); // dentro do limiar v0
  });

  it("distribuição inversa do hint → KL alto", () => {
    const runs = [
      mockRun(mockMenu([
        { played_as: "diamante" },
        { played_as: "diamante" },
        { played_as: "bridge" },
        { played_as: "bridge" },
      ])),
    ];
    const ryoBias: Array<{ played_as: PlayedAs; weight: number }> = [
      { played_as: "espelho", weight: 0.30 },
      { played_as: "canal", weight: 0.28 },
      { played_as: "bridge", weight: 0.15 },
      { played_as: "diamante", weight: 0.12 },
      { played_as: "arena", weight: 0.08 },
      { played_as: "recovery", weight: 0.07 },
    ];
    const kl = computeDistAlignment(runs, ryoBias);
    expect(kl).toBeGreaterThan(0.5);
  });
});

describe("normalizeDistribution", () => {
  it("normaliza pra soma = 1", () => {
    const dist = { bridge: 5, espelho: 10, canal: 5, diamante: 0, arena: 0, recovery: 0 };
    const norm = normalizeDistribution(dist);
    expect(Object.values(norm).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10);
    expect(norm.espelho).toBeCloseTo(0.5, 10);
    expect(norm.bridge).toBeCloseTo(0.25, 10);
  });

  it("dist toda zero → retorna dist toda zero (não NaN)", () => {
    const norm = normalizeDistribution(emptyDistribution());
    for (const v of Object.values(norm)) {
      expect(v).toBe(0);
      expect(Number.isNaN(v)).toBe(false);
    }
  });
});

describe("computeCostStats", () => {
  it("agrega cost total + mean + latency + tokens", () => {
    const runs = [
      mockRun(mockMenu([{}]), [], {
        costUsdEst: 0.05,
        latencyMs: 1000,
        tokensIn: 4000,
        tokensOut: 1000,
      }),
      mockRun(mockMenu([{}]), [], {
        costUsdEst: 0.10,
        latencyMs: 3000,
        tokensIn: 5000,
        tokensOut: 1500,
      }),
    ];
    const stats = computeCostStats(runs);
    expect(stats.totalUsd).toBeCloseTo(0.15, 5);
    expect(stats.meanUsdPerRun).toBeCloseTo(0.075, 5);
    expect(stats.meanLatencyMs).toBe(2000);
    expect(stats.meanTokensIn).toBe(4500);
    expect(stats.meanTokensOut).toBe(1250);
  });

  it("array vazio → zeros (não NaN)", () => {
    const stats = computeCostStats([]);
    expect(stats.totalUsd).toBe(0);
    expect(stats.meanUsdPerRun).toBe(0);
    expect(Number.isNaN(stats.meanLatencyMs)).toBe(false);
  });
});
