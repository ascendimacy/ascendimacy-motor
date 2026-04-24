import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/markdown.js";
import type { WeeklyReportData } from "../src/types.js";

function baseData(overrides: Partial<WeeklyReportData> = {}): WeeklyReportData {
  return {
    child_name: "Ryo",
    child_age: 13,
    week: { from: "2026-04-20T00:00:00Z", to: "2026-04-26T23:59:59Z" },
    program_status: { current_week: 2, current_phase: "translation_via_weakness", paused: false },
    cards: [],
    status_comparison: [],
    ignitions: [],
    aspirations: [],
    metrics: {
      total_turns: 0,
      total_sessions: 0,
      off_on_screen_ratio: { off: 0, on: 0, ratio: 0 },
      sessions_in_brejo: 0,
      program_pause_frequency: 0,
      missed_milestones_total: 0,
      avg_sacrifice_per_turn: 0,
      total_screen_seconds: 0,
    },
    ...overrides,
  };
}

describe("renderMarkdown — header + program", () => {
  it("renderiza nome + idade + período", () => {
    const md = renderMarkdown(baseData());
    expect(md).toContain("Semana de Ryo (13a)");
    expect(md).toContain("2026-04-20");
    expect(md).toContain("2026-04-26");
  });

  it("mostra status programa ativo", () => {
    const md = renderMarkdown(baseData());
    expect(md).toContain("Semana 2/5");
    expect(md).toContain("translation_via_weakness");
  });

  it("indica programa pausado com motivo", () => {
    const md = renderMarkdown(baseData({
      program_status: {
        current_week: 1,
        current_phase: "exploration_in_strength",
        paused: true,
        paused_reason: "emotional_brejo",
      },
    }));
    expect(md).toContain("**pausado**");
    expect(md).toContain("emotional_brejo");
  });

  it("mostra 'não iniciado' quando programa ausente", () => {
    const md = renderMarkdown(baseData({
      program_status: { current_week: null, current_phase: null, paused: false },
    }));
    expect(md).toContain("Programa não iniciado");
  });
});

describe("renderMarkdown — cards", () => {
  it("renderiza tabela com cards", () => {
    const md = renderMarkdown(baseData({
      cards: [
        {
          content_id: "h1", content_type: "curiosity_hook",
          domain: "biology", casel_targets: ["SA"], gardner_channels: ["linguistic"],
          sacrifice_spent: 2, turn: 0, session_id: "s1",
        },
      ],
    }));
    expect(md).toContain("Cards recebidos (1)");
    expect(md).toContain("| 1 | h1 | curiosity_hook | biology | SA | linguistic | 2 |");
  });

  it("mostra 'nenhum card' quando vazio", () => {
    const md = renderMarkdown(baseData());
    expect(md).toContain("Nenhum card");
  });
});

describe("renderMarkdown — status comparison", () => {
  it("renderiza trend com emojis", () => {
    const md = renderMarkdown(baseData({
      status_comparison: [
        { dimension: "emotional", previous: "brejo", current: "baia", trend: "improved" },
      ],
    }));
    expect(md).toContain("improved");
    expect(md).toContain("↑");
  });
});

describe("renderMarkdown — ignitions + aspirations", () => {
  it("renderiza só ignições (ignited=true)", () => {
    const md = renderMarkdown(baseData({
      ignitions: [
        { session_id: "s1", turn: 0, gardner_channels: ["linguistic"], casel_dimensions: ["SA"], ignited: false },
        { session_id: "s1", turn: 1, gardner_channels: ["linguistic", "logical_mathematical", "spatial"], casel_dimensions: ["SA", "DM"], ignited: true },
      ],
    }));
    expect(md).toContain("Combinações Helix que acenderam (1)");
    expect(md).toContain("Turn 1");
  });

  it("renderiza aspirações com contagem", () => {
    const md = renderMarkdown(baseData({
      aspirations: [
        { key: "biology", occurrences: 5, first_seen_turn: 0, last_seen_turn: 10, contexts: ["h1", "h2"] },
      ],
    }));
    expect(md).toContain("biology");
    expect(md).toContain("5x");
  });
});

describe("renderMarkdown — métricas", () => {
  it("renderiza todas as métricas operacionais", () => {
    const md = renderMarkdown(baseData({
      metrics: {
        total_turns: 10,
        total_sessions: 2,
        off_on_screen_ratio: { off: 3, on: 7, ratio: 3 / 7 },
        sessions_in_brejo: 1,
        program_pause_frequency: 0.5,
        missed_milestones_total: 1,
        avg_sacrifice_per_turn: 2.3,
        total_screen_seconds: 900,
      },
    }));
    expect(md).toContain("Turns totais | 10");
    expect(md).toContain("Sessões c/ brejo | 1");
    expect(md).toContain("50%");
  });

  it("formata ratio infinito como ∞", () => {
    const md = renderMarkdown(baseData({
      metrics: {
        total_turns: 1, total_sessions: 1,
        off_on_screen_ratio: { off: 1, on: 0, ratio: Infinity },
        sessions_in_brejo: 0, program_pause_frequency: 0,
        missed_milestones_total: 0, avg_sacrifice_per_turn: 0,
        total_screen_seconds: 0,
      },
    }));
    expect(md).toContain("∞");
  });
});
