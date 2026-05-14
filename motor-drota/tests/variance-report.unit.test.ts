/**
 * Unit tests — variance/report.ts (H-AC-12, ops#1058).
 *
 * Smoke tests rendering: contém células PASS/FAIL, distribuições, custo.
 * Não testa formato exato (frágil) — testa presença de campos chave.
 */

import { describe, it, expect } from "vitest";
import type { ActionMenu, PlayedAs } from "@ascendimacy/shared";
import { renderReport, type CellInput } from "../src/variance/report.js";
import type { RunResult } from "../src/variance/kpis.js";

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
): RunResult {
  return {
    menu,
    warnings: warnings as RunResult["warnings"],
    latencyMs: 1000,
    tokensIn: 4000,
    tokensOut: 1500,
    costUsdEst: 0.08,
  };
}

const RYO_BIAS: ReadonlyArray<{ played_as: PlayedAs; weight: number }> = [
  { played_as: "espelho", weight: 0.30 },
  { played_as: "canal", weight: 0.28 },
  { played_as: "bridge", weight: 0.15 },
  { played_as: "diamante", weight: 0.12 },
  { played_as: "arena", weight: 0.08 },
  { played_as: "recovery", weight: 0.07 },
];

function healthyRyoCell(): CellInput {
  // 30 runs Ryo, distribuição alinhada com hint, todos ok
  const runs: RunResult[] = [];
  const dist: PlayedAs[] = ["espelho", "canal", "bridge", "diamante", "arena", "recovery"];
  const counts = [10, 9, 5, 4, 1, 1];
  for (let i = 0; i < dist.length; i++) {
    for (let j = 0; j < counts[i]!; j++) {
      runs.push(mockRun(mockMenu([{ played_as: dist[i] }])));
    }
  }
  return {
    model: "kimi",
    modelLabel: "Kimi K2.5",
    personaId: "ryo-ochiai",
    personaLabel: "Ryo (deflective)",
    personaHintBias: RYO_BIAS,
    runs,
  };
}

function failingCell(): CellInput {
  // Cell com errors → falha em error_rate
  const runs: RunResult[] = [
    ...Array.from({ length: 5 }, () => mockRun(mockMenu([{ played_as: "bridge" }]))),
    ...Array.from({ length: 5 }, () => mockRun(null)), // 50% error
  ];
  return {
    model: "qwen3-30b",
    modelLabel: "Qwen3-30B Q4",
    personaId: "ryo-ochiai",
    personaLabel: "Ryo (deflective)",
    personaHintBias: RYO_BIAS,
    runs,
  };
}

describe("renderReport — happy path", () => {
  it("renderiza header com prompt version + run id + mode", () => {
    const md = renderReport({
      promptVersion: "v0.1",
      mode: "full",
      timestamp: "2026-05-20T03:00:00.000Z",
      runId: "hac12-test-001",
      cells: [healthyRyoCell()],
    });

    expect(md).toContain("# H-AC-12");
    expect(md).toContain("2026-05-20");
    expect(md).toMatch(/`v0\.1`/);
    expect(md).toContain("hac12-test-001");
    expect(md).toContain("`full`");
  });

  it("inclui tabela de Resumo com colunas obrigatórias", () => {
    const md = renderReport({
      promptVersion: "v0.1",
      mode: "full",
      timestamp: "2026-05-20T03:00:00.000Z",
      runId: "hac12-test-001",
      cells: [healthyRyoCell()],
    });

    expect(md).toContain("## Resumo");
    expect(md).toContain("pass_first");
    expect(md).toContain("recovery");
    expect(md).toContain("degraded");
    expect(md).toContain("dist_align");
    expect(md).toContain("Pass?");
    expect(md).toContain("Kimi K2.5");
    expect(md).toContain("Ryo (deflective)");
  });

  it("cell saudável aparece como PASS no Resumo global", () => {
    const md = renderReport({
      promptVersion: "v0.1",
      mode: "quick",
      timestamp: "2026-05-20T03:00:00.000Z",
      runId: "hac12-test-002",
      cells: [healthyRyoCell()],
    });

    expect(md).toMatch(/PASS — todos os limiares v0 atendidos/);
  });

  it("inclui distribuição played_as realizada vs esperada", () => {
    const md = renderReport({
      promptVersion: "v0.1",
      mode: "full",
      timestamp: "2026-05-20T03:00:00.000Z",
      runId: "hac12-test-003",
      cells: [healthyRyoCell()],
    });

    expect(md).toContain("Distribuição played_as");
    expect(md).toContain("realizada");
    expect(md).toContain("esperada");
    expect(md).toContain("Top-2 realizado");
    // Todas as 6 jogadas aparecem na tabela
    for (const j of ["bridge", "espelho", "canal", "diamante", "arena", "recovery"]) {
      expect(md).toContain(`| ${j} |`);
    }
  });

  it("seção Custo + latência presente com totais", () => {
    const md = renderReport({
      promptVersion: "v0.1",
      mode: "full",
      timestamp: "2026-05-20T03:00:00.000Z",
      runId: "hac12-test-004",
      cells: [healthyRyoCell()],
    });

    expect(md).toContain("## Custo + latência");
    expect(md).toContain("Total execução");
    expect(md).toMatch(/\$\d+\.\d{2}/);
  });

  it("Sinais acionáveis NÃO aparece quando todas as células passam", () => {
    const md = renderReport({
      promptVersion: "v0.1",
      mode: "quick",
      timestamp: "2026-05-20T03:00:00.000Z",
      runId: "hac12-test-005",
      cells: [healthyRyoCell()],
    });

    expect(md).not.toContain("Sinais acionáveis");
  });
});

describe("renderReport — failing cell", () => {
  it("cell falhando aparece como FAIL global + seção Sinais acionáveis", () => {
    const md = renderReport({
      promptVersion: "v0.1",
      mode: "full",
      timestamp: "2026-05-20T03:00:00.000Z",
      runId: "hac12-test-006",
      cells: [failingCell()],
    });

    expect(md).toMatch(/FAIL — pelo menos uma célula reprovou/);
    expect(md).toContain("## Sinais acionáveis");
    expect(md).toContain("Qwen3-30B Q4");
    // Pelo menos um KPI falhou (error_rate provavelmente)
    expect(md).toMatch(/error_rate.*>.*5/);
  });

  it("multi-cell com 1 PASS + 1 FAIL → global FAIL", () => {
    const md = renderReport({
      promptVersion: "v0.1",
      mode: "full",
      timestamp: "2026-05-20T03:00:00.000Z",
      runId: "hac12-test-007",
      cells: [healthyRyoCell(), failingCell()],
    });

    expect(md).toMatch(/FAIL/);
    expect(md).toContain("Kimi K2.5");
    expect(md).toContain("Qwen3-30B");
  });
});

describe("renderReport — footer + provenance", () => {
  it("footer cita o script + spec ratificada", () => {
    const md = renderReport({
      promptVersion: "v0.1",
      mode: "quick",
      timestamp: "2026-05-20T03:00:00.000Z",
      runId: "hac12-test-008",
      cells: [healthyRyoCell()],
    });

    expect(md).toMatch(/measure-menu-variance\.mjs/);
    expect(md).toMatch(/ratificada v1.*ops#1058/);
  });
});
