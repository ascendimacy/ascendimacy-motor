import { describe, it, expect } from "vitest";
import { generateWeeklyReport, summarizeEmittedCard } from "../src/index.js";
import type { EmittedCard, SessionTrace } from "@ascendimacy/shared";

const emittedCard: EmittedCard = {
  card_id: "c-uuid-1",
  child_id: "ryo",
  session_id: "s1",
  archetype_id: "arch_curiosity_v0",
  front: {
    image_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    narrative: "Ryo, você ficou curioso.",
    archetype_id: "arch_curiosity_v0",
  },
  back: {
    template: "v1-default",
    gardner_channel_icon: "🔮",
    casel_dimension: "SA",
    cheat_code: "curiosity · hoje · 🔮",
    serial_number: "#ryo-001",
    qr_payload: "https://ebrota.app/v/c-uuid-1?sig=abc",
  },
  spec_snapshot: {
    archetype: {
      id: "arch_curiosity_v0",
      name: "Curioso do Mundo",
      narrative_template: "x",
      casel_dimension: "SA",
      gardner_channel: "intrapersonal",
      rarity: "common",
      is_scaffold: true,
    },
    child_id: "ryo",
    session_id: "s1",
    context_word: "curiosity",
    casel_dimension: "SA",
    gardner_channel: "intrapersonal",
    issued_at: "2026-04-24T10:00:00Z",
    achievement_summary: "x",
    sequence: 1,
  },
  signature: "sig",
  issued_at: "2026-04-24T10:00:00Z",
  approved_at: "2026-04-24T11:00:00Z",
  emitted_at: "2026-04-24T12:00:00Z",
};

const emptyTrace: SessionTrace = {
  sessionId: "s1",
  persona: "ryo",
  startedAt: "2026-04-24T10:00:00Z",
  turns: [],
  meta: { schemaVersion: "0.3.0", motorVersion: "0.3.0" },
};

describe("summarizeEmittedCard", () => {
  it("extrai title + narrative + cheat code + qr", () => {
    const s = summarizeEmittedCard(emittedCard);
    expect(s.title).toBe("Curioso do Mundo");
    expect(s.narrative).toBe("Ryo, você ficou curioso.");
    expect(s.cheat_code).toBe("curiosity · hoje · 🔮");
    expect(s.qr_payload).toContain("ebrota.app");
    expect(s.rarity).toBe("common");
  });
});

describe("generateWeeklyReport — emitted_cards section", () => {
  it("markdown inclui 'Cartas recebidas' com imagem + cheat + QR link", () => {
    const report = generateWeeklyReport([emptyTrace], "Ryo", {
      emitted_cards: [emittedCard],
    });
    expect(report.markdown).toContain("Cartas recebidas (1)");
    expect(report.markdown).toContain("Curioso do Mundo");
    expect(report.markdown).toContain("curiosity · hoje · 🔮");
    expect(report.markdown).toContain("ebrota.app");
    expect(report.markdown).toContain("![Curioso do Mundo]");
  });

  it("markdown mostra 'Nenhuma carta' quando vazio", () => {
    const report = generateWeeklyReport([emptyTrace], "Ryo");
    expect(report.markdown).toContain("Nenhuma carta");
  });

  it("PDF binário gerado com front image embutida", async () => {
    const report = generateWeeklyReport([emptyTrace], "Ryo", {
      emitted_cards: [emittedCard],
    });
    const buf = await report.renderPdf();
    expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
    // PDF deve conter ao menos alguns bytes extras comparado ao empty
    const emptyReport = generateWeeklyReport([emptyTrace], "Ryo");
    const emptyBuf = await emptyReport.renderPdf();
    expect(buf.length).toBeGreaterThan(emptyBuf.length);
  }, 10_000);

  it("aggregate.emitted_cards array preserva ordem", () => {
    const report = generateWeeklyReport([emptyTrace], "Ryo", {
      emitted_cards: [emittedCard, { ...emittedCard, card_id: "c2", emitted_at: "2026-04-25T12:00:00Z" }],
    });
    expect(report.data.emitted_cards).toHaveLength(2);
    expect(report.data.emitted_cards[0]!.card_id).toBe("c-uuid-1");
    expect(report.data.emitted_cards[1]!.card_id).toBe("c2");
  });
});
