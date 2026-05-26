import { describe, it, expect } from "vitest";
import { MilestoneEventSchema, MilestoneEventTypeSchema, MILESTONE_EVENT_TYPES } from "../src/contracts/milestone-event.js";

const validEvent = {
  type: "first_avowal" as const,
  axis: "autoconhecimento",
  evidence: "eu sei que errei",
  persona: "ryo",
  timestamp: "2026-05-26T10:00:00.000Z",
};

describe("MilestoneEventTypeSchema — enum dos 8 tipos", () => {
  it("aceita todos os 8 tipos válidos", () => {
    for (const t of MILESTONE_EVENT_TYPES) {
      expect(MilestoneEventTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("REJEITA tipo desconhecido", () => {
    expect(MilestoneEventTypeSchema.safeParse("unknown_type").success).toBe(false);
  });

  it("REJEITA string vazia", () => {
    expect(MilestoneEventTypeSchema.safeParse("").success).toBe(false);
  });

  it("REJEITA null", () => {
    expect(MilestoneEventTypeSchema.safeParse(null).success).toBe(false);
  });

  it("exporta exatamente 8 tipos", () => {
    expect(MILESTONE_EVENT_TYPES).toHaveLength(8);
  });
});

describe("MilestoneEventSchema — validação de objeto completo", () => {
  it("aceita evento válido", () => {
    expect(MilestoneEventSchema.safeParse(validEvent).success).toBe(true);
  });

  it("aceita todos os 8 tipos como type", () => {
    for (const t of MILESTONE_EVENT_TYPES) {
      expect(MilestoneEventSchema.safeParse({ ...validEvent, type: t }).success).toBe(true);
    }
  });

  it("REJEITA sem campo type", () => {
    const { type: _, ...rest } = validEvent;
    expect(MilestoneEventSchema.safeParse(rest).success).toBe(false);
  });

  it("REJEITA sem campo axis", () => {
    const { axis: _, ...rest } = validEvent;
    expect(MilestoneEventSchema.safeParse(rest).success).toBe(false);
  });

  it("REJEITA sem campo evidence", () => {
    const { evidence: _, ...rest } = validEvent;
    expect(MilestoneEventSchema.safeParse(rest).success).toBe(false);
  });

  it("REJEITA sem campo persona", () => {
    const { persona: _, ...rest } = validEvent;
    expect(MilestoneEventSchema.safeParse(rest).success).toBe(false);
  });

  it("REJEITA sem campo timestamp", () => {
    const { timestamp: _, ...rest } = validEvent;
    expect(MilestoneEventSchema.safeParse(rest).success).toBe(false);
  });

  it("REJEITA timestamp não-ISO", () => {
    expect(MilestoneEventSchema.safeParse({ ...validEvent, timestamp: "ontem" }).success).toBe(false);
  });

  it("REJEITA axis vazio", () => {
    expect(MilestoneEventSchema.safeParse({ ...validEvent, axis: "" }).success).toBe(false);
  });

  it("REJEITA evidence vazio", () => {
    expect(MilestoneEventSchema.safeParse({ ...validEvent, evidence: "" }).success).toBe(false);
  });
});
