/**
 * Tests do expose gate (motor fix tático monoculture).
 *
 * Contexto: smoke tracer-helix-3sessions-ryo mostrou bio_caterpillar_dissolve
 * dominando 3 sessões consecutivas porque surprise=10 + sacrifice_type=expose
 * batia em qualquer ranking, mesmo quando Ryo recusava o frame. Spec capturada
 * em ops#1133 §3.6 (gate por contexto receptivo).
 */
import { describe, it, expect } from "vitest";
import {
  scoreItem,
  EXPOSE_GATE_PENALTY,
  EXPOSE_GATE_TRUST_THRESHOLD,
  EXPOSE_GATE_MOOD_THRESHOLD,
  type ChildScoringProfile,
  type ScoringContext,
} from "../src/scorer.js";
import type { CuriosityHookItem } from "../src/content-item.js";

const NOW = "2026-05-26T12:00:00.000Z";

const exposeItem = (id: string): CuriosityHookItem => ({
  id,
  type: "curiosity_hook",
  domain: "biologia",
  casel_target: ["SA"],
  age_range: [10, 15],
  surprise: 7,
  verified: true,
  base_score: 10,
  fact: "x",
  bridge: "y",
  quest: "z",
  sacrifice_type: "expose",
});

const reflectItem = (id: string): CuriosityHookItem => ({
  ...exposeItem(id),
  sacrifice_type: "reflect",
});

const child: ChildScoringProfile = { age: 12 };

describe("expose gate", () => {
  it("não penaliza expose quando contexto neutro (sem trust/mood/signals)", () => {
    const item = exposeItem("test_expose");
    const ctx: ScoringContext = { now: NOW };
    const r = scoreItem(item, child, ctx);
    expect(r.reasons.some((s) => s.startsWith("expose_gate_penalty"))).toBe(false);
  });

  it("penaliza expose quando trust < threshold", () => {
    const item = exposeItem("test_expose");
    const ctx: ScoringContext = { now: NOW };
    const profileLow: ChildScoringProfile = {
      ...child,
      trust: EXPOSE_GATE_TRUST_THRESHOLD - 0.1,
    };
    const r = scoreItem(item, profileLow, ctx);
    const reason = r.reasons.find((s) => s.startsWith("expose_gate_penalty"));
    expect(reason).toBeDefined();
    expect(reason).toContain("trust=");
  });

  it("NÃO penaliza expose quando trust >= threshold", () => {
    const item = exposeItem("test_expose");
    const ctx: ScoringContext = { now: NOW };
    const profileOk: ChildScoringProfile = { ...child, trust: 0.8 };
    const r = scoreItem(item, profileOk, ctx);
    expect(r.reasons.some((s) => s.startsWith("expose_gate_penalty"))).toBe(false);
  });

  it("penaliza expose quando mood < threshold", () => {
    const item = exposeItem("test_expose");
    const ctx: ScoringContext = {
      now: NOW,
      current_mood: EXPOSE_GATE_MOOD_THRESHOLD - 1,
    };
    const r = scoreItem(item, child, ctx);
    const reason = r.reasons.find((s) => s.startsWith("expose_gate_penalty"));
    expect(reason).toBeDefined();
    expect(reason).toContain("mood=");
  });

  it("penaliza expose quando recent_signals contém frame_rejection", () => {
    const item = exposeItem("test_expose");
    const ctx: ScoringContext = {
      now: NOW,
      recent_signals: ["frame_rejection"],
    };
    const r = scoreItem(item, child, ctx);
    const reason = r.reasons.find((s) => s.startsWith("expose_gate_penalty"));
    expect(reason).toBeDefined();
    expect(reason).toContain("signals=[frame_rejection]");
  });

  it("penaliza expose quando recent_signals contém deflection_thematic", () => {
    const item = exposeItem("test_expose");
    const ctx: ScoringContext = {
      now: NOW,
      recent_signals: ["deflection_thematic"],
    };
    const r = scoreItem(item, child, ctx);
    expect(r.reasons.some((s) => s.startsWith("expose_gate_penalty"))).toBe(true);
  });

  it("NÃO penaliza items com sacrifice_type !== 'expose'", () => {
    const item = reflectItem("test_reflect");
    const ctx: ScoringContext = {
      now: NOW,
      current_mood: 0,
      recent_signals: ["frame_rejection"],
    };
    const profileLow: ChildScoringProfile = { ...child, trust: 0 };
    const r = scoreItem(item, profileLow, ctx);
    expect(r.reasons.some((s) => s.startsWith("expose_gate_penalty"))).toBe(false);
  });

  it("derruba expose abaixo de reflect quando todos triggers ativos", () => {
    const ctx: ScoringContext = {
      now: NOW,
      current_mood: 4,
      recent_signals: ["frame_rejection"],
    };
    const profileLow: ChildScoringProfile = { ...child, trust: 0.3 };
    const exposeScored = scoreItem(exposeItem("a"), profileLow, ctx);
    const reflectScored = scoreItem(reflectItem("b"), profileLow, ctx);
    expect(exposeScored.score).toBeLessThan(reflectScored.score);
    expect(reflectScored.score - exposeScored.score).toBeGreaterThanOrEqual(
      EXPOSE_GATE_PENALTY,
    );
  });

  it("penalty é aplicado uma vez mesmo com múltiplos triggers", () => {
    const item = exposeItem("test_expose");
    const ctx: ScoringContext = {
      now: NOW,
      current_mood: 2,
      recent_signals: ["frame_rejection", "deflection_thematic"],
    };
    const profileLow: ChildScoringProfile = { ...child, trust: 0.1 };
    const r = scoreItem(item, profileLow, ctx);
    const penaltyReasons = r.reasons.filter((s) =>
      s.startsWith("expose_gate_penalty"),
    );
    expect(penaltyReasons).toHaveLength(1);
  });
});
