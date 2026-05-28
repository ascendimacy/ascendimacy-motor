/**
 * S4ExpressaoPanel — render com mock ApiClient.
 *
 * Cobre:
 *  - loading state inicial
 *  - render com métricas + distribution split inactive
 *  - render com tactic distribution split active (expand on click)
 *  - samples table com badges (fallback, sanitize, jogada) + truncate
 *  - error state
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/svelte";
import S4ExpressaoPanel from "../src/components/subsystem-panels/S4ExpressaoPanel.svelte";
import { expandedSubsystem, tracerSubjectId } from "../src/lib/stores.js";
import type {
  ApiClient,
  ExpressionMetricsLike,
  TacticDecisionDistributionLike,
  ExpressionSamplesResponseLike,
} from "../src/lib/api.js";

function buildApi(over: {
  metrics?: ExpressionMetricsLike;
  distribution?: TacticDecisionDistributionLike;
  samples?: ExpressionSamplesResponseLike;
  errorOn?: "metrics" | "distribution" | "samples";
} = {}): ApiClient {
  const defaultMetrics: ExpressionMetricsLike = {
    personaId: "ryo-ochiai",
    totalTurns: 87,
    cacheHitRate: 0.71,
    fallbackRate: 0.04,
    avgTokensIn: 1240,
    avgTokensOut: 145,
    avgLatencyMs: 1820,
    avgCostUsd: 0.0089,
    sanitizationAppliedRate: 0.12,
    retriedWithFallbackRate: 0.03,
    byModel: {
      "claude-haiku-4-5": { calls: 60, avgLatencyMs: 1500 },
      "local:qwen3-30b": { calls: 27, avgLatencyMs: 2400 },
    },
    developmentStub: false,
  };
  const defaultDist: TacticDecisionDistributionLike = {
    personaId: "ryo-ochiai",
    totalDecisions: 0,
    splitDrotaActive: false,
    byJogada: {},
    byRegister: {},
    byMethod: {},
    averages: { angleCharsAvg: 0, maxLengthCharsAvg: 0 },
    developmentStub: true,
  };
  const defaultSamples: ExpressionSamplesResponseLike = {
    personaId: "ryo-ochiai",
    samples: [],
    developmentStub: false,
  };

  const metricsFn = over.errorOn === "metrics"
    ? vi.fn().mockRejectedValue(new Error("metrics fail"))
    : vi.fn().mockResolvedValue(over.metrics ?? defaultMetrics);
  const distFn = over.errorOn === "distribution"
    ? vi.fn().mockRejectedValue(new Error("dist fail"))
    : vi.fn().mockResolvedValue(over.distribution ?? defaultDist);
  const sampFn = over.errorOn === "samples"
    ? vi.fn().mockRejectedValue(new Error("samples fail"))
    : vi.fn().mockResolvedValue(over.samples ?? defaultSamples);

  return {
    getExpressionMetrics: metricsFn,
    getTacticDecisionDistribution: distFn,
    getExpressionSamples: sampFn,
  } as unknown as ApiClient;
}

beforeEach(() => {
  expandedSubsystem.set("S4");
  tracerSubjectId.set("ryo-ochiai");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("S4ExpressaoPanel", () => {
  it("mostra loading enquanto carrega", () => {
    const api = buildApi();
    render(S4ExpressaoPanel, { props: { api } });
    expect(screen.getByTestId("s4-loading")).toBeDefined();
  });

  it("renderiza métricas + byModel quando dados completos", async () => {
    const api = buildApi();
    render(S4ExpressaoPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.queryByTestId("s4-loading")).toBeNull();
    });
    expect(screen.getByTestId("s4-metrics-block")).toBeDefined();
    expect(screen.getByTestId("s4-cache-hit").textContent).toContain("71.0%");
    expect(screen.getByTestId("s4-fallback-rate").textContent).toContain("4.0%");
    expect(screen.getByTestId("s4-avg-latency").textContent).toContain("1820ms");
    expect(screen.getByTestId("s4-by-model")).toBeDefined();
    expect(screen.getByText(/claude-haiku-4-5/)).toBeDefined();
  });

  it("mostra badge stub_v0 quando metrics.developmentStub=true", async () => {
    const api = buildApi({
      metrics: {
        personaId: "ryo-ochiai",
        totalTurns: 0,
        cacheHitRate: 0,
        fallbackRate: 0,
        avgTokensIn: 0,
        avgTokensOut: 0,
        avgLatencyMs: 0,
        avgCostUsd: 0,
        sanitizationAppliedRate: 0,
        retriedWithFallbackRate: 0,
        byModel: {},
        developmentStub: true,
      },
    });
    render(S4ExpressaoPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.queryByTestId("s4-loading")).toBeNull();
    });
    expect(screen.getByText("stub_v0")).toBeDefined();
    expect(screen.getByText(/Sem turnos registrados/)).toBeDefined();
  });

  it("tactic distribution mostra badge USE_SPLIT_DROTA=false quando inactive", async () => {
    const api = buildApi();
    render(S4ExpressaoPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.queryByTestId("s4-loading")).toBeNull();
    });
    expect(screen.getByText("USE_SPLIT_DROTA=false")).toBeDefined();
  });

  it("tactic distribution expande on click + lista byJogada quando split active", async () => {
    const api = buildApi({
      distribution: {
        personaId: "ryo-ochiai",
        totalDecisions: 10,
        splitDrotaActive: true,
        byJogada: { bridge: 6, espelho: 4 },
        byRegister: { lúdico: 7, neutro: 3 },
        byMethod: { rule: 8, llm: 2 },
        averages: { angleCharsAvg: 30, maxLengthCharsAvg: 280 },
        developmentStub: false,
      },
    });
    render(S4ExpressaoPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.queryByTestId("s4-loading")).toBeNull();
    });
    const toggle = screen.getByTestId("s4-tactic-toggle");
    await fireEvent.click(toggle);
    expect(screen.getByText("Por jogada")).toBeDefined();
    // bridge + espelho aparecem (texto pode estar em <code> dentro de <li>);
    // basta confirmar presença textual no DOM.
    expect(screen.getAllByText("bridge").length).toBeGreaterThan(0);
    expect(screen.getAllByText("espelho").length).toBeGreaterThan(0);
  });

  it("samples table renderiza linhas com badges + truncate; click expande", async () => {
    const longText = "a".repeat(150);
    const api = buildApi({
      samples: {
        personaId: "ryo-ochiai",
        samples: [
          {
            turnRef: "sess-1__turn_1",
            generatedAt: "2026-05-27T10:00:00Z",
            finalText: longText,
            model: "claude-haiku-4-5",
            latencyMs: 1500,
            tokensOut: 12,
            fallbackTriggered: true,
            sanitizationApplied: false,
            jogada: "bridge",
          },
        ],
        developmentStub: false,
      },
    });
    render(S4ExpressaoPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.queryByTestId("s4-loading")).toBeNull();
    });
    const row = screen.getByTestId("s4-sample-row");
    expect(row).toBeDefined();
    // Texto truncado (não mostra full ainda).
    expect(screen.queryByTestId("s4-sample-full")).toBeNull();
    // "Fallback" também aparece como label de métrica; filtra pelo badge exato.
    expect(
      screen.getAllByText("fallback").some((el) => el.classList.contains("badge")),
    ).toBe(true);
    expect(
      screen.getAllByText("bridge").some((el) => el.classList.contains("badge")),
    ).toBe(true);
    await fireEvent.click(row);
    expect(screen.getByTestId("s4-sample-full").textContent).toBe(longText);
  });

  it("renderiza estado de erro quando metrics falha", async () => {
    const api = buildApi({ errorOn: "metrics" });
    render(S4ExpressaoPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.queryByTestId("s4-loading")).toBeNull();
    });
    expect(screen.getByTestId("s4-error").textContent).toContain("metrics fail");
  });
});
