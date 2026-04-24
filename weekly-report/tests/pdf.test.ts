import { describe, it, expect } from "vitest";
import { renderPdf } from "../src/pdf.js";
import type { WeeklyReportData } from "../src/types.js";

const minimalData: WeeklyReportData = {
  child_name: "Ryo",
  child_age: 13,
  week: { from: "2026-04-20T00:00:00Z", to: "2026-04-26T23:59:59Z" },
  program_status: { current_week: 2, current_phase: "translation_via_weakness", paused: false },
  cards: [
    {
      content_id: "h1",
      content_type: "curiosity_hook",
      domain: "biology",
      casel_targets: ["SA"],
      gardner_channels: ["linguistic"],
      sacrifice_spent: 2,
      turn: 0,
      session_id: "s1",
    },
  ],
  status_comparison: [
    { dimension: "emotional", previous: "brejo", current: "baia", trend: "improved" },
  ],
  ignitions: [],
  aspirations: [
    { key: "biology", occurrences: 4, first_seen_turn: 0, last_seen_turn: 3, contexts: ["h1"] },
  ],
  metrics: {
    total_turns: 5,
    total_sessions: 2,
    off_on_screen_ratio: { off: 2, on: 3, ratio: 2 / 3 },
    sessions_in_brejo: 0,
    program_pause_frequency: 0,
    missed_milestones_total: 0,
    avg_sacrifice_per_turn: 1.8,
    total_screen_seconds: 600,
  },
};

describe("renderPdf", () => {
  it("gera um Buffer com magic bytes PDF (%PDF-)", async () => {
    const buf = await renderPdf(minimalData);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    const header = buf.slice(0, 5).toString("ascii");
    expect(header).toBe("%PDF-");
  }, 10_000);

  it("inclui EOF marker no final", async () => {
    const buf = await renderPdf(minimalData);
    const tail = buf.slice(-16).toString("ascii");
    expect(tail).toMatch(/%%EOF/);
  }, 10_000);

  it("dados vazios ainda produzem PDF válido", async () => {
    const empty: WeeklyReportData = {
      ...minimalData,
      cards: [],
      status_comparison: [],
      ignitions: [],
      aspirations: [],
      metrics: {
        total_turns: 0, total_sessions: 0,
        off_on_screen_ratio: { off: 0, on: 0, ratio: 0 },
        sessions_in_brejo: 0, program_pause_frequency: 0,
        missed_milestones_total: 0, avg_sacrifice_per_turn: 0,
        total_screen_seconds: 0,
      },
    };
    const buf = await renderPdf(empty);
    expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
  }, 10_000);
});
