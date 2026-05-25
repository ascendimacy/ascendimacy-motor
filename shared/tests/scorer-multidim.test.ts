/**
 * Tests scorer multi-dim combinatorial (spec §4.6 Fase 5).
 */
import { describe, it, expect } from "vitest";
import {
  scoreItem,
  evaluateMultiDimMatches,
  MULTIDIM_BONUS_2,
  MULTIDIM_BONUS_3,
  MULTIDIM_BONUS_5,
  MOVES_TOWARD_PROPOSED_BONUS,
  INTERNALIZATION_HISTORY_THRESHOLD,
  type ChildScoringProfile,
  type ScoringContext,
} from "../src/scorer.js";
import type { CuriosityHookItem } from "../src/content-item.js";

const NOW = "2026-05-25T12:00:00.000Z";

const baseContext: ScoringContext = { now: NOW };

const makeItem = (overrides: Partial<CuriosityHookItem>): CuriosityHookItem => ({
  id: "metamorfose_lagarta",
  type: "curiosity_hook",
  domain: "biologia",
  casel_target: ["SA"],
  age_range: [10, 15],
  surprise: 7,
  verified: true,
  base_score: 5,
  fact: "x",
  bridge: "y",
  quest: "z",
  sacrifice_type: "reflect",
  axis_id: 4,
  family: "carater",
  lineage_anchor: "zen/shoshin",
  extracted_keywords: ["transformação", "metamorfose", "casulo"],
  ...overrides,
});

describe("evaluateMultiDimMatches", () => {
  it("zero dims sem profile completo", () => {
    const item = makeItem({});
    const dims = evaluateMultiDimMatches(item, { age: 12 });
    expect(dims.interest).toBe(false);
    expect(dims.need).toBe(false);
    expect(dims.lineage).toBe(false);
    expect(dims.moves_toward_proposed).toBe(false);
    expect(dims.internalization_history).toBe(false);
  });

  it("interest match via extracted_keywords", () => {
    const item = makeItem({});
    const dims = evaluateMultiDimMatches(item, {
      age: 12,
      interests: ["metamorfose"],
    });
    expect(dims.interest).toBe(true);
  });

  it("need match via domain", () => {
    const item = makeItem({ domain: "autocontrole" });
    const dims = evaluateMultiDimMatches(item, {
      age: 12,
      latent_needs: ["autocontrole"],
    });
    expect(dims.need).toBe(true);
  });

  it("lineage true quando axis ativo no proposto", () => {
    const item = makeItem({});
    const dims = evaluateMultiDimMatches(item, {
      age: 12,
      subject_proposed: {
        axes_active: [4, 7],
        complements_per_axis: { 4: [], 7: [] },
      },
    });
    expect(dims.lineage).toBe(true);
  });

  it("moves_toward_proposed true quando complemento aceito bate", () => {
    const item = makeItem({ lineage_anchor: "zen/shoshin" });
    const dims = evaluateMultiDimMatches(item, {
      age: 12,
      subject_proposed: {
        axes_active: [4],
        complements_per_axis: { 4: ["shoshin", "enkrateia"] },
      },
    });
    expect(dims.moves_toward_proposed).toBe(true);
  });

  it("moves_toward_proposed false quando complemento não está nos aceitos", () => {
    const item = makeItem({ lineage_anchor: "zen/shoshin" });
    const dims = evaluateMultiDimMatches(item, {
      age: 12,
      subject_proposed: {
        axes_active: [4],
        complements_per_axis: { 4: ["enkrateia"] }, // shoshin NÃO está
      },
    });
    expect(dims.lineage).toBe(true);
    expect(dims.moves_toward_proposed).toBe(false);
  });

  it("internalization_history dispara só acima do threshold", () => {
    const item = makeItem({});
    const dimsLow = evaluateMultiDimMatches(item, {
      age: 12,
      internalization_axis_points: { 4: INTERNALIZATION_HISTORY_THRESHOLD - 1 },
    });
    expect(dimsLow.internalization_history).toBe(false);
    const dimsHigh = evaluateMultiDimMatches(item, {
      age: 12,
      internalization_axis_points: { 4: INTERNALIZATION_HISTORY_THRESHOLD },
    });
    expect(dimsHigh.internalization_history).toBe(true);
  });
});

describe("scoreItem — bonus combinatorial", () => {
  it("NÃO aplica bonus quando 1 dim match", () => {
    const item = makeItem({});
    const profile: ChildScoringProfile = {
      age: 12,
      interests: ["metamorfose"], // só interest
    };
    const result = scoreItem(item, profile, baseContext);
    expect(result.reasons.some((r) => r.includes("multidim_bonus"))).toBe(false);
  });

  it("aplica MULTIDIM_BONUS_2 quando 2 dims match", () => {
    const item = makeItem({ domain: "autocontrole" });
    const profile: ChildScoringProfile = {
      age: 12,
      interests: ["metamorfose"],
      latent_needs: ["autocontrole"],
    };
    const result = scoreItem(item, profile, baseContext);
    const bonus = result.reasons.find((r) => r.includes("multidim_bonus"));
    expect(bonus).toBeDefined();
    expect(bonus).toContain(`+${MULTIDIM_BONUS_2}`);
  });

  it("aplica bonus extra moves_toward_proposed quando dim ativa", () => {
    const item = makeItem({});
    const profile: ChildScoringProfile = {
      age: 12,
      interests: ["metamorfose"],
      subject_proposed: {
        axes_active: [4],
        complements_per_axis: { 4: ["shoshin"] },
      },
    };
    const result = scoreItem(item, profile, baseContext);
    const bonus = result.reasons.find((r) => r.includes("multidim_bonus"));
    expect(bonus).toBeDefined();
    // 3 dims: interest + lineage + moves_toward_proposed
    // base = MULTIDIM_BONUS_2 + MULTIDIM_BONUS_3 + MOVES_TOWARD_PROPOSED_BONUS
    const expected = MULTIDIM_BONUS_2 + MULTIDIM_BONUS_3 + MOVES_TOWARD_PROPOSED_BONUS;
    expect(bonus).toContain(`+${expected}`);
  });

  it("aplica todos os bonus quando 5 dims match", () => {
    const item = makeItem({ domain: "autocontrole" });
    const profile: ChildScoringProfile = {
      age: 12,
      interests: ["metamorfose"],
      latent_needs: ["autocontrole"],
      subject_proposed: {
        axes_active: [4],
        complements_per_axis: { 4: ["shoshin"] },
      },
      internalization_axis_points: { 4: 10 },
    };
    const result = scoreItem(item, profile, baseContext);
    const bonus = result.reasons.find((r) => r.includes("multidim_bonus"));
    expect(bonus).toBeDefined();
    const expected =
      MULTIDIM_BONUS_2 +
      MULTIDIM_BONUS_3 +
      MULTIDIM_BONUS_5 +
      MOVES_TOWARD_PROPOSED_BONUS;
    expect(bonus).toContain(`+${expected}`);
  });

  it("zero regressão: item sem tags + profile sem subject_proposed funciona como antes", () => {
    const item = makeItem({
      axis_id: undefined,
      family: undefined,
      lineage_anchor: undefined,
      extracted_keywords: undefined,
    });
    const profile: ChildScoringProfile = { age: 12 };
    const result = scoreItem(item, profile, baseContext);
    expect(result.reasons.some((r) => r.includes("multidim"))).toBe(false);
    expect(result.score).toBeGreaterThan(0); // continua scorando normal
  });
});
