/**
 * Unit tests para Zod schema validation em MoodReading + MoodSource.
 *
 * Sprint 0 PR5. Bundles fix ops#408 — mood_method enum violation:
 * shared/src/mood.ts declara MoodSource = "llm" | "rule_based" | "manual",
 * mas JSONs reais continham "rule" em 2/72 turns. Zod schema rejeita.
 */

import { describe, it, expect } from "vitest";
import { MoodReadingSchema, MoodSourceSchema } from "../src/mood.js";

describe("MoodSourceSchema — enum strict", () => {
  it("aceita 'llm'", () => {
    expect(MoodSourceSchema.safeParse("llm").success).toBe(true);
  });

  it("aceita 'rule_based'", () => {
    expect(MoodSourceSchema.safeParse("rule_based").success).toBe(true);
  });

  it("aceita 'manual'", () => {
    expect(MoodSourceSchema.safeParse("manual").success).toBe(true);
  });

  it("REJEITA 'rule' (ops#408 — caso real do trace nagareyama)", () => {
    const r = MoodSourceSchema.safeParse("rule");
    expect(r.success).toBe(false);
  });

  it("REJEITA string vazia", () => {
    expect(MoodSourceSchema.safeParse("").success).toBe(false);
  });

  it("REJEITA null", () => {
    expect(MoodSourceSchema.safeParse(null).success).toBe(false);
  });
});

describe("MoodReadingSchema — full reading", () => {
  const valid = {
    score: 7,
    at: "2026-05-09T10:00:00.000Z",
    source: "llm" as const,
  };

  it("aceita reading válida", () => {
    expect(MoodReadingSchema.safeParse(valid).success).toBe(true);
  });

  it("aceita score nos limites (1 e 10)", () => {
    expect(MoodReadingSchema.safeParse({ ...valid, score: 1 }).success).toBe(true);
    expect(MoodReadingSchema.safeParse({ ...valid, score: 10 }).success).toBe(true);
  });

  it("REJEITA score 0 ou 11", () => {
    expect(MoodReadingSchema.safeParse({ ...valid, score: 0 }).success).toBe(false);
    expect(MoodReadingSchema.safeParse({ ...valid, score: 11 }).success).toBe(false);
  });

  it("REJEITA score decimal (LLM 7.5)", () => {
    expect(MoodReadingSchema.safeParse({ ...valid, score: 7.5 }).success).toBe(false);
  });

  it("REJEITA source='rule' (ops#408 bundling)", () => {
    expect(MoodReadingSchema.safeParse({ ...valid, source: "rule" }).success).toBe(false);
  });

  it("REJEITA at não-ISO", () => {
    expect(MoodReadingSchema.safeParse({ ...valid, at: "yesterday" }).success).toBe(false);
  });
});
