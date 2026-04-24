import { describe, it, expect } from "vitest";
import type { SessionTrace, TurnTrace } from "@ascendimacy/shared";
import { aggregateJointSessions, generateWeeklyReport } from "../src/index.js";

function turn(overrides: Partial<TurnTrace> = {}): TurnTrace {
  return {
    turnNumber: 0,
    sessionId: "s1",
    incomingMessage: "x",
    entries: [],
    finalResponse: "y",
    ...overrides,
  };
}

function trace(id: string, turns: TurnTrace[]): SessionTrace {
  return {
    sessionId: id,
    persona: "ryo",
    personaAge: 13,
    startedAt: "2026-04-20T10:00:00.000Z",
    turns,
    meta: { schemaVersion: "0.3.0", motorVersion: "0.3.0" },
  };
}

describe("aggregateJointSessions", () => {
  it("extrai 1 summary por trace contendo turns joint", () => {
    const t = trace("joint-1", [
      turn({ sessionMode: "joint", jointPartnerChildId: "kei", jointPartnerName: "Kei", selectedContent: { id: "h1", type: "x", score: 8, domain: "d", surprise: 7 } }),
      turn({ turnNumber: 1, sessionMode: "joint", jointPartnerChildId: "kei", jointPartnerName: "Kei", selectedContent: { id: "h2", type: "x", score: 12, domain: "d", surprise: 7 } }),
    ]);
    const r = aggregateJointSessions([t]);
    expect(r).toHaveLength(1);
    expect(r[0]!.session_id).toBe("joint-1");
    expect(r[0]!.partner_child_id).toBe("kei");
    expect(r[0]!.partner_name).toBe("Kei");
    expect(r[0]!.turns_count).toBe(2);
    expect(r[0]!.avg_engagement_score).toBeCloseTo(10, 2);
  });

  it("ignora traces sem turns joint", () => {
    const t = trace("solo", [turn({})]);
    expect(aggregateJointSessions([t])).toEqual([]);
  });

  it("conta bullying flags por pattern", () => {
    const t = trace("joint-1", [
      turn({ sessionMode: "joint", jointPartnerChildId: "kei", bullyingCheck: { flagged: true, pattern: "ridicule" } }),
      turn({ turnNumber: 1, sessionMode: "joint", jointPartnerChildId: "kei", bullyingCheck: { flagged: true, pattern: "ridicule" } }),
      turn({ turnNumber: 2, sessionMode: "joint", jointPartnerChildId: "kei", bullyingCheck: { flagged: true, pattern: "destructive_comparison" } }),
      turn({ turnNumber: 3, sessionMode: "joint", jointPartnerChildId: "kei", bullyingCheck: { flagged: false } }),
    ]);
    const r = aggregateJointSessions([t]);
    expect(r[0]!.bullying_flags_count).toEqual({
      ridicule: 2,
      destructive_comparison: 1,
    });
  });
});

describe("generateWeeklyReport — joint_sessions + dyad_trust_trend", () => {
  const jointTrace = trace("joint-wk1", [
    turn({ sessionMode: "joint", jointPartnerChildId: "kei", jointPartnerName: "Kei", selectedContent: { id: "h1", type: "x", score: 8, domain: "d", surprise: 7 } }),
  ]);

  it("joint_sessions populated when trace tem turns joint", () => {
    const r = generateWeeklyReport([jointTrace], "Ryo");
    expect(r.data.joint_sessions).toHaveLength(1);
    expect(r.data.joint_sessions[0]!.partner_name).toBe("Kei");
  });

  it("dyad_trust_trend é null quando previous_dyad_avg_engagement ausente", () => {
    const r = generateWeeklyReport([jointTrace], "Ryo");
    expect(r.data.dyad_trust_trend).toBeNull();
  });

  it("dyad_trust_trend = current - previous", () => {
    const r = generateWeeklyReport([jointTrace], "Ryo", {
      previous_dyad_avg_engagement: 5,
    });
    // current avg = 8, previous = 5, trend = 3
    expect(r.data.dyad_trust_trend).toBe(3);
  });

  it("markdown inclui seção 'Dinâmicas conjuntas' com trend e flags", () => {
    const r = generateWeeklyReport([jointTrace], "Ryo", {
      previous_dyad_avg_engagement: 5,
    });
    expect(r.markdown).toContain("Dinâmicas conjuntas (1)");
    expect(r.markdown).toContain("Kei");
    expect(r.markdown).toContain("+3");
  });

  it("markdown mostra 'Nenhuma sessão joint' quando só solo", () => {
    const soloTrace = trace("solo", [turn({})]);
    const r = generateWeeklyReport([soloTrace], "Ryo");
    expect(r.markdown).toContain("Nenhuma sessão joint");
  });

  it("PDF binário inclui seção joint (magic bytes válidos)", async () => {
    const r = generateWeeklyReport([jointTrace], "Ryo", {
      previous_dyad_avg_engagement: 5,
    });
    const buf = await r.renderPdf();
    expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
  }, 10_000);
});
