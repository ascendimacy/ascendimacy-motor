/**
 * Tests transitions-schema (motor#25).
 */

import { describe, it, expect } from "vitest";
import {
  parseTransitionsConfig,
  evaluateTransition,
  type TransitionRule,
} from "../src/transitions-schema.js";

const validKidsConfig = {
  profile_id: "kids",
  schema_version: "v0",
  transitions: {
    brejo_to_baia: {
      required_signals: ["philosophical_self_acceptance"],
      minimum_window_turns: 2,
      confirmatory_signals: ["mood_drift_up"],
      regression_to_brejo_if: ["distress_marker_high"],
    },
    baia_to_pasto: {
      required_signals: ["meta_cognitive_observation", "frame_synthesis"],
      minimum_window_turns: 5,
      confirmatory_signals: ["peer_reference"],
    },
  },
};

describe("parseTransitionsConfig", () => {
  it("aceita config válido", () => {
    const c = parseTransitionsConfig(validKidsConfig);
    expect(c.profile_id).toBe("kids");
    expect(c.transitions.brejo_to_baia!.required_signals).toContain(
      "philosophical_self_acceptance",
    );
  });

  it("rejeita config sem profile_id", () => {
    const invalid = { ...validKidsConfig, profile_id: undefined };
    delete (invalid as Record<string, unknown>).profile_id;
    expect(() => parseTransitionsConfig(invalid)).toThrow();
  });

  it("rejeita transição com required_signals vazio", () => {
    const invalid = {
      ...validKidsConfig,
      transitions: {
        bad: { required_signals: [], minimum_window_turns: 0 },
      },
    };
    expect(() => parseTransitionsConfig(invalid)).toThrow();
  });

  it("aceita config sem confirmatory_signals (default [])", () => {
    const minimal = {
      profile_id: "test",
      schema_version: "v0",
      transitions: {
        t1: { required_signals: ["a"], minimum_window_turns: 0 },
      },
    };
    const c = parseTransitionsConfig(minimal);
    expect(c.transitions.t1!.confirmatory_signals).toEqual([]);
  });
});

describe("evaluateTransition — fired conditions", () => {
  const rule: TransitionRule = {
    required_signals: ["a", "b"],
    minimum_window_turns: 2,
    confirmatory_signals: ["c"],
    regression_to_brejo_if: ["distress"],
  };

  it("fired=true quando required match (OR default) + janela ok + sem regression", () => {
    const r = evaluateTransition("t1", rule, ["a"], 3);
    expect(r.fired).toBe(true);
    expect(r.required_matched).toEqual(["a"]);
    expect(r.reason).toContain("fired");
  });

  it("fired=true quando OR match em qualquer required", () => {
    const r = evaluateTransition("t1", rule, ["b"], 3);
    expect(r.fired).toBe(true);
  });

  it("fired=true com confirmatory também", () => {
    const r = evaluateTransition("t1", rule, ["a", "c"], 3);
    expect(r.fired).toBe(true);
    expect(r.confirmatory_matched).toEqual(["c"]);
    expect(r.reason).toContain("confirmatory");
  });

  it("fired=false sem nenhum required", () => {
    const r = evaluateTransition("t1", rule, ["c"], 3);
    expect(r.fired).toBe(false);
    expect(r.reason).toContain("required_signals not matched");
  });

  it("fired=false se janela < minimum_window_turns", () => {
    const r = evaluateTransition("t1", rule, ["a"], 1);
    expect(r.fired).toBe(false);
    expect(r.reason).toContain("minimum_window_turns");
  });

  it("fired=false se regression signal presente", () => {
    const r = evaluateTransition("t1", rule, ["a", "distress"], 3);
    expect(r.fired).toBe(false);
    expect(r.regression_signals_present).toEqual(["distress"]);
    expect(r.reason).toContain("regression");
  });
});

describe("evaluateTransition — match_mode AND", () => {
  const rule: TransitionRule = {
    required_signals: ["a", "b"],
    minimum_window_turns: 0,
    confirmatory_signals: [],
    match_mode: "AND",
  };

  it("AND requer TODOS required_signals", () => {
    const onlyA = evaluateTransition("t", rule, ["a"], 0);
    expect(onlyA.fired).toBe(false);

    const both = evaluateTransition("t", rule, ["a", "b"], 0);
    expect(both.fired).toBe(true);
  });
});
