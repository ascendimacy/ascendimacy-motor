import { describe, it, expect } from "vitest";
import {
  selectDiscoveryOption,
  type DiscoveryOption,
} from "../src/discovery-option-selector.js";

const FULL_POOL: DiscoveryOption[] = [
  { kind: "interest_probe", text: "interest q", anchor: "a1" },
  { kind: "gap_check", text: "gap q", anchor: "a2" },
  { kind: "agency_offer", text: "agency q", anchor: "a3" },
  { kind: "value_observation", text: "value q", anchor: "a4" },
  { kind: "bridge_to_artifact", text: "baralho q", anchor: "a5" },
];

describe("selectDiscoveryOption — v0.3-A heuristic", () => {
  it("default early turn → interest_probe", () => {
    const { chosen, reason } = selectDiscoveryOption({
      options: FULL_POOL,
      signals: [],
      turn: 1,
    });
    expect(chosen.kind).toBe("interest_probe");
    expect(reason).toContain("default:interest_probe");
  });

  it("frame_rejection → agency_offer", () => {
    const { chosen, reason } = selectDiscoveryOption({
      options: FULL_POOL,
      signals: ["frame_rejection"],
      turn: 2,
    });
    expect(chosen.kind).toBe("agency_offer");
    expect(reason).toContain("frame_rejection→agency_offer");
  });

  it("deflection_thematic → gap_check", () => {
    const { chosen } = selectDiscoveryOption({
      options: FULL_POOL,
      signals: ["deflection_thematic"],
    });
    expect(chosen.kind).toBe("gap_check");
  });

  it("distress_marker_low → value_observation", () => {
    const { chosen } = selectDiscoveryOption({
      options: FULL_POOL,
      signals: ["distress_marker_low"],
    });
    expect(chosen.kind).toBe("value_observation");
  });

  it("mood_drift_down → value_observation", () => {
    const { chosen } = selectDiscoveryOption({
      options: FULL_POOL,
      signals: ["mood_drift_down"],
    });
    expect(chosen.kind).toBe("value_observation");
  });

  it("gatekeeper_resistance → agency_offer", () => {
    const { chosen } = selectDiscoveryOption({
      options: FULL_POOL,
      signals: ["gatekeeper_resistance"],
    });
    expect(chosen.kind).toBe("agency_offer");
  });

  it("multi signal: frame_rejection wins over later turn fallback", () => {
    const { chosen, reason } = selectDiscoveryOption({
      options: FULL_POOL,
      signals: ["frame_rejection", "mood_drift_down"],
      turn: 5,
    });
    // frame_rejection precede mood_drift na ordem do mapeamento
    expect(chosen.kind).toBe("agency_offer");
    expect(reason).toContain("frame_rejection→agency_offer");
  });

  it("late turn (state.turn>=3) sem signals → bridge_to_artifact", () => {
    const { chosen, reason } = selectDiscoveryOption({
      options: FULL_POOL,
      signals: [],
      turn: 3,
    });
    expect(chosen.kind).toBe("bridge_to_artifact");
    expect(reason).toContain("late_turn→bridge_to_artifact");
  });

  it("turn=2 ainda não é late → interest_probe", () => {
    const { chosen } = selectDiscoveryOption({
      options: FULL_POOL,
      signals: [],
      turn: 2,
    });
    expect(chosen.kind).toBe("interest_probe");
  });

  it("late turn COM signals → signal vence", () => {
    const { chosen } = selectDiscoveryOption({
      options: FULL_POOL,
      signals: ["frame_rejection"],
      turn: 5,
    });
    expect(chosen.kind).toBe("agency_offer");
  });

  it("preferência ausente do pool → próximo fallback", () => {
    // Pool sem agency_offer; frame_rejection deve cair em interest_probe
    const pool = FULL_POOL.filter((o) => o.kind !== "agency_offer");
    const { chosen } = selectDiscoveryOption({
      options: pool,
      signals: ["frame_rejection"],
    });
    expect(chosen.kind).toBe("interest_probe");
  });

  it("single option pool → retorna sempre essa opção", () => {
    const single = [FULL_POOL[0]!];
    const { chosen, reason } = selectDiscoveryOption({
      options: single,
      signals: ["frame_rejection"],
    });
    expect(chosen).toBe(single[0]);
    expect(reason).toBe("single_option");
  });

  it("empty pool → throws", () => {
    expect(() =>
      selectDiscoveryOption({ options: [], signals: [] }),
    ).toThrow(/non-empty options/);
  });

  it("nenhum kind do pool matches preference → fallback options[0]", () => {
    const pool: DiscoveryOption[] = [
      { kind: "unknown_kind", text: "x", anchor: "y" },
    ];
    const { chosen, reason } = selectDiscoveryOption({
      options: pool,
      signals: [],
    });
    // single_option short-circuit wins before fallback
    expect(chosen).toBe(pool[0]);
    expect(reason).toBe("single_option");
  });

  it("pool 2 itens nenhum casa preferência → fallback options[0]", () => {
    const pool: DiscoveryOption[] = [
      { kind: "weird_kind_a", text: "x", anchor: "y" },
      { kind: "weird_kind_b", text: "x2", anchor: "y2" },
    ];
    const { chosen, reason } = selectDiscoveryOption({
      options: pool,
      signals: ["frame_rejection"],
    });
    expect(chosen).toBe(pool[0]);
    expect(reason).toBe("fallback_no_match");
  });
});
