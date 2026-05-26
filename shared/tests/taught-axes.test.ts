/**
 * Tests sub-fase 5.1 Scorer Objective-Driven — schema additions.
 *
 * Spec ops#1133 §3.1 (polaridade tríplice) + §3.2 (axis_attempt_outcome).
 * Foundation only — sem mudança de comportamento. Valida precedência de
 * resolução de `computeTaughtAxes` + tipos do enum + payload AxisAttemptOutcome.
 */
import { describe, it, expect } from "vitest";
import {
  computeTaughtAxes,
  computeTaughtLineages,
  type ContentItemBase,
} from "../src/content-item.js";
import type {
  AxisAttemptOutcomePayload,
  SubjectKnowledgeEntry,
} from "../src/subject-knowledge.js";

const baseItem: ContentItemBase = {
  id: "test_item",
  domain: "biologia",
  casel_target: ["SA"],
  age_range: [10, 15],
  surprise: 7,
  verified: true,
  base_score: 5,
};

describe("computeTaughtAxes — sub-fase 5.1 precedência", () => {
  it("usa taught_axes explícito quando presente", () => {
    const item: ContentItemBase = {
      ...baseItem,
      taught_axes: [4, 11, 12],
      taught_axes_positive: [4],
      axis_id: 99,
    };
    expect(computeTaughtAxes(item)).toEqual([4, 11, 12]);
  });

  it("computa union de positive + negative quando taught_axes ausente", () => {
    const item: ContentItemBase = {
      ...baseItem,
      taught_axes_positive: [4, 11],
      taught_axes_negative: [11, 12],
      axis_id: 99,
    };
    const result = computeTaughtAxes(item);
    expect(result.slice().sort((a, b) => a - b)).toEqual([4, 11, 12]);
  });

  it("fallback pra [axis_id] quando nenhum taught_* populado", () => {
    const item: ContentItemBase = { ...baseItem, axis_id: 7 };
    expect(computeTaughtAxes(item)).toEqual([7]);
  });

  it("retorna [] quando nada populado (item legado sem axis_id)", () => {
    const item: ContentItemBase = { ...baseItem };
    expect(computeTaughtAxes(item)).toEqual([]);
  });

  it("dedup quando taught_axes_positive e negative têm overlap", () => {
    const item: ContentItemBase = {
      ...baseItem,
      taught_axes_positive: [4, 4, 11],
      taught_axes_negative: [11, 12, 12],
    };
    const result = computeTaughtAxes(item);
    expect(result.slice().sort((a, b) => a - b)).toEqual([4, 11, 12]);
  });

  it("array vazio de taught_axes não bloqueia fallback", () => {
    const item: ContentItemBase = {
      ...baseItem,
      taught_axes: [],
      taught_axes_positive: [5],
    };
    expect(computeTaughtAxes(item)).toEqual([5]);
  });
});

describe("computeTaughtLineages — sub-fase 5.1", () => {
  it("usa taught_lineages explícito", () => {
    const item: ContentItemBase = {
      ...baseItem,
      taught_lineages: ["estoica/dicotomia", "zen/shoshin"],
      lineage_anchor: "outra/legacy",
    };
    expect(computeTaughtLineages(item)).toEqual([
      "estoica/dicotomia",
      "zen/shoshin",
    ]);
  });

  it("fallback pra [lineage_anchor]", () => {
    const item: ContentItemBase = {
      ...baseItem,
      lineage_anchor: "estoica/dicotomia_controle",
    };
    expect(computeTaughtLineages(item)).toEqual(["estoica/dicotomia_controle"]);
  });

  it("vazio quando nada", () => {
    const item: ContentItemBase = { ...baseItem };
    expect(computeTaughtLineages(item)).toEqual([]);
  });
});

describe("AxisAttemptOutcomePayload — sub-fase 5.1 schema", () => {
  it("aceita outcome engaged/deflected/neutral", () => {
    const engaged: AxisAttemptOutcomePayload = {
      kind: "axis_attempt_outcome",
      item_id: "bio_caterpillar_dissolve",
      axis_id: 11,
      outcome: "engaged",
      signal_basis: ["positive_engagement"],
      penalty_applied: 0,
    };
    const deflected: AxisAttemptOutcomePayload = {
      kind: "axis_attempt_outcome",
      item_id: "bio_caterpillar_dissolve",
      axis_id: 11,
      outcome: "deflected",
      signal_basis: ["frame_rejection", "deflection_thematic"],
      penalty_applied: 3,
    };
    const neutral: AxisAttemptOutcomePayload = {
      kind: "axis_attempt_outcome",
      item_id: "bio_dolphin_names",
      axis_id: 11,
      outcome: "neutral",
      signal_basis: [],
      penalty_applied: 1,
    };
    expect(engaged.outcome).toBe("engaged");
    expect(deflected.outcome).toBe("deflected");
    expect(neutral.outcome).toBe("neutral");
  });

  it("aceita type=axis_attempt_outcome no SubjectKnowledgeEntry", () => {
    const entry: SubjectKnowledgeEntry = {
      id: "skn-1",
      subject_id: "ryo-ochiai",
      type: "axis_attempt_outcome",
      source: "motor_inferred",
      confidence: 0.9,
      confirmed_at: null,
      alignment: "unknown",
      payload: {
        kind: "axis_attempt_outcome",
        item_id: "bio_caterpillar_dissolve",
        axis_id: 11,
        outcome: "deflected",
        signal_basis: ["frame_rejection"],
        penalty_applied: 3,
      },
      turn_ref: "S1-T4",
      session_id: "session-1",
      created_at: "2026-05-26T08:00:00Z",
    };
    expect(entry.type).toBe("axis_attempt_outcome");
    expect((entry.payload as AxisAttemptOutcomePayload).outcome).toBe(
      "deflected",
    );
  });
});
