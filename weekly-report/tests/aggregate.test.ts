import { describe, it, expect } from "vitest";
import type {
  SessionTrace,
  StatusMatrix,
  TurnTrace,
  GardnerChannel,
  CaselDimension,
} from "@ascendimacy/shared";
import {
  aggregate,
  aggregateCards,
  compareStatusMatrices,
  detectIgnitions,
  extractAspirations,
} from "../src/aggregate.js";

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

function trace(id: string, turns: TurnTrace[], age?: number): SessionTrace {
  return {
    sessionId: id,
    persona: "ryo",
    personaAge: age,
    startedAt: "2026-04-20T10:00:00.000Z",
    turns,
    meta: { schemaVersion: "0.3.0", motorVersion: "0.3.0" },
  };
}

describe("aggregateCards", () => {
  it("extracts one card per turn with selectedContent", () => {
    const t = trace("s1", [
      turn({ selectedContent: { id: "h1", type: "curiosity_hook", score: 7, domain: "biology", surprise: 8 } }),
      turn({ turnNumber: 1, selectedContent: { id: "h2", type: "curiosity_hook", score: 8, domain: "physics", surprise: 9 } }),
      turn({ turnNumber: 2 }),
    ]);
    const cards = aggregateCards([t]);
    expect(cards).toHaveLength(2);
    expect(cards[0]!.content_id).toBe("h1");
    expect(cards[1]!.content_id).toBe("h2");
  });

  it("propagates CASEL and Gardner from trace fields", () => {
    const t = trace("s1", [
      turn({
        selectedContent: { id: "h1", type: "curiosity_hook", score: 7, domain: "biology", surprise: 8 },
        caselTargetsTouched: ["SA", "DM"] as CaselDimension[],
        gardnerChannelsObserved: ["linguistic", "logical_mathematical"] as GardnerChannel[],
        sacrificeSpent: 4,
      }),
    ]);
    const card = aggregateCards([t])[0]!;
    expect(card.casel_targets).toEqual(["SA", "DM"]);
    expect(card.gardner_channels).toEqual(["linguistic", "logical_mathematical"]);
    expect(card.sacrifice_spent).toBe(4);
  });
});

describe("compareStatusMatrices", () => {
  const prev: StatusMatrix = { emotional: "brejo", cognitive_math: "baia" };
  const currSnap: StatusMatrix = { emotional: "baia", cognitive_math: "baia", cognitive_novel: "pasto" };
  const t = trace("s1", [turn({ statusSnapshot: currSnap })]);

  it("marks improved when current > previous in rank", () => {
    const cmp = compareStatusMatrices([t], prev);
    const emotional = cmp.find((c) => c.dimension === "emotional");
    expect(emotional?.trend).toBe("improved");
  });

  it("marks stable when equal", () => {
    const cmp = compareStatusMatrices([t], prev);
    const cm = cmp.find((c) => c.dimension === "cognitive_math");
    expect(cm?.trend).toBe("stable");
  });

  it("marks new when dimension missing in previous", () => {
    const cmp = compareStatusMatrices([t], prev);
    const novel = cmp.find((c) => c.dimension === "cognitive_novel");
    expect(novel?.trend).toBe("new");
  });

  it("returns empty when no snapshot available", () => {
    const empty = trace("s1", [turn({})]);
    expect(compareStatusMatrices([empty], prev)).toEqual([]);
  });

  it("marks worsened when current < previous", () => {
    const downSnap: StatusMatrix = { emotional: "brejo" };
    const tDown = trace("s1", [turn({ statusSnapshot: downSnap })]);
    const prev2: StatusMatrix = { emotional: "pasto" };
    const cmp = compareStatusMatrices([tDown], prev2);
    expect(cmp[0]!.trend).toBe("worsened");
  });
});

describe("detectIgnitions", () => {
  it("marks ignited=true when ≥3 channels + ≥2 CASEL", () => {
    const t = trace("s1", [
      turn({
        gardnerChannelsObserved: ["linguistic", "logical_mathematical", "spatial"] as GardnerChannel[],
        caselTargetsTouched: ["SA", "DM"] as CaselDimension[],
      }),
    ]);
    const igs = detectIgnitions([t]);
    expect(igs[0]!.ignited).toBe(true);
  });

  it("marks ignited=false with <3 channels", () => {
    const t = trace("s1", [
      turn({
        gardnerChannelsObserved: ["linguistic", "logical_mathematical"] as GardnerChannel[],
        caselTargetsTouched: ["SA", "DM"] as CaselDimension[],
      }),
    ]);
    const igs = detectIgnitions([t]);
    expect(igs[0]!.ignited).toBe(false);
  });

  it("deduplicates channels and dimensions", () => {
    const t = trace("s1", [
      turn({
        gardnerChannelsObserved: ["linguistic", "linguistic", "linguistic", "linguistic"] as GardnerChannel[],
        caselTargetsTouched: ["SA", "SA"] as CaselDimension[],
      }),
    ]);
    const igs = detectIgnitions([t]);
    expect(igs[0]!.gardner_channels).toHaveLength(1);
    expect(igs[0]!.ignited).toBe(false);
  });
});

describe("extractAspirations", () => {
  it("extracts domains with ≥3 occurrences", () => {
    const turns: TurnTrace[] = [];
    for (let i = 0; i < 3; i++) {
      turns.push(turn({
        turnNumber: i,
        selectedContent: { id: `h${i}`, type: "curiosity_hook", score: 7, domain: "biology", surprise: 8 },
      }));
    }
    turns.push(turn({
      turnNumber: 3,
      selectedContent: { id: "h9", type: "curiosity_hook", score: 7, domain: "physics", surprise: 8 },
    }));
    const t = trace("s1", turns);
    const aps = extractAspirations([t]);
    expect(aps).toHaveLength(1);
    expect(aps[0]!.key).toBe("biology");
    expect(aps[0]!.occurrences).toBe(3);
  });

  it("skips domains below threshold", () => {
    const turns: TurnTrace[] = [];
    for (let i = 0; i < 2; i++) {
      turns.push(turn({
        turnNumber: i,
        selectedContent: { id: `h${i}`, type: "curiosity_hook", score: 7, domain: "biology", surprise: 8 },
      }));
    }
    const aps = extractAspirations([trace("s1", turns)]);
    expect(aps).toHaveLength(0);
  });
});

describe("aggregate — end-to-end", () => {
  it("produces WeeklyReportData with all sections", () => {
    const t = trace("s1", [
      turn({
        selectedContent: { id: "h1", type: "curiosity_hook", score: 7, domain: "biology", surprise: 8 },
        statusSnapshot: { emotional: "baia" },
        gardnerProgramSnapshot: {
          current_week: 2,
          current_day: 3,
          current_phase: "translation_via_weakness",
          paused: false,
          phases_completed: 3,
          consecutive_missed_milestones: 0,
        },
      }),
    ], 13);
    const data = aggregate([t], "Ryo");
    expect(data.child_name).toBe("Ryo");
    expect(data.child_age).toBe(13);
    expect(data.program_status.current_week).toBe(2);
    expect(data.cards).toHaveLength(1);
    expect(data.metrics.total_turns).toBe(1);
  });

  it("accepts week_range override", () => {
    const data = aggregate([], "Ryo", {
      week_range: { from: "2026-04-20", to: "2026-04-26" },
    });
    expect(data.week.from).toBe("2026-04-20");
    expect(data.week.to).toBe("2026-04-26");
  });
});
