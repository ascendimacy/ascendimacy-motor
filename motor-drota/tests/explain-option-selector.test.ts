import { describe, it, expect } from "vitest";
import {
  selectExplainOption,
  type ExplainOption,
} from "../src/explain-option-selector.js";

const FULL_POOL: ExplainOption[] = [
  { kind: "concrete_example", text: "ex q", anchor: "a1" },
  { kind: "metaphor", text: "metaphor q", anchor: "a2" },
  { kind: "contrast", text: "contrast q", anchor: "a3" },
  { kind: "lineage_anchor", text: "lineage q", anchor: "a4" },
];

describe("selectExplainOption — v0.3-B heuristic", () => {
  it("default sem signals → concrete_example", () => {
    const { chosen, reason } = selectExplainOption({
      options: FULL_POOL,
      signals: [],
    });
    expect(chosen.kind).toBe("concrete_example");
    expect(reason).toContain("default:concrete_example");
  });

  it("frame_rejection → contrast", () => {
    const { chosen, reason } = selectExplainOption({
      options: FULL_POOL,
      signals: ["frame_rejection"],
    });
    expect(chosen.kind).toBe("contrast");
    expect(reason).toContain("frame_rejection/authority→contrast");
  });

  it("authority_questioning → contrast", () => {
    const { chosen } = selectExplainOption({
      options: FULL_POOL,
      signals: ["authority_questioning"],
    });
    expect(chosen.kind).toBe("contrast");
  });

  it("voluntary_topic_deepening → metaphor", () => {
    const { chosen } = selectExplainOption({
      options: FULL_POOL,
      signals: ["voluntary_topic_deepening"],
    });
    expect(chosen.kind).toBe("metaphor");
  });

  it("mood_drift_up → metaphor", () => {
    const { chosen } = selectExplainOption({
      options: FULL_POOL,
      signals: ["mood_drift_up"],
    });
    expect(chosen.kind).toBe("metaphor");
  });

  it("distress_marker_low → lineage_anchor", () => {
    const { chosen } = selectExplainOption({
      options: FULL_POOL,
      signals: ["distress_marker_low"],
    });
    expect(chosen.kind).toBe("lineage_anchor");
  });

  it("mood_drift_down → lineage_anchor", () => {
    const { chosen } = selectExplainOption({
      options: FULL_POOL,
      signals: ["mood_drift_down"],
    });
    expect(chosen.kind).toBe("lineage_anchor");
  });

  it("multi-signal: frame_rejection vence sobre metaphor signal", () => {
    const { chosen } = selectExplainOption({
      options: FULL_POOL,
      signals: ["voluntary_topic_deepening", "frame_rejection"],
    });
    expect(chosen.kind).toBe("contrast");
  });

  it("kind preferido ausente do pool → próximo fallback", () => {
    const pool = FULL_POOL.filter((o) => o.kind !== "contrast");
    const { chosen } = selectExplainOption({
      options: pool,
      signals: ["frame_rejection"],
    });
    expect(chosen.kind).toBe("concrete_example");
  });

  it("single option pool → retorna single", () => {
    const single = [FULL_POOL[0]!];
    const { chosen, reason } = selectExplainOption({
      options: single,
      signals: ["frame_rejection"],
    });
    expect(chosen).toBe(single[0]);
    expect(reason).toBe("single_option");
  });

  it("empty pool → throws", () => {
    expect(() => selectExplainOption({ options: [], signals: [] })).toThrow(
      /non-empty options/,
    );
  });

  it("nenhum kind do pool casa preferência → fallback options[0]", () => {
    const pool: ExplainOption[] = [
      { kind: "weird_a", text: "x", anchor: "y" },
      { kind: "weird_b", text: "x2", anchor: "y2" },
    ];
    const { chosen, reason } = selectExplainOption({
      options: pool,
      signals: ["frame_rejection"],
    });
    expect(chosen).toBe(pool[0]);
    expect(reason).toBe("fallback_no_match");
  });
});
