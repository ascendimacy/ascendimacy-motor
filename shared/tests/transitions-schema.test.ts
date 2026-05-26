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

// ─── BUG-KT-01 fix (ops#1141) — confirmatory_min + consecutive_turns ───────

describe("evaluateTransition — confirmatory_min (DT-A01-02)", () => {
  const rule: TransitionRule = {
    required_signals: ["frame_synthesis"],
    minimum_window_turns: 5,
    confirmatory_signals: ["meta_cognitive_observation", "voluntary_topic_deepening"],
    confirmatory_min: 1,
    match_mode: "AND",
  };

  it("fired=false quando required match mas confirmatory_min=1 não atingido", () => {
    const r = evaluateTransition("baia_to_pasto", rule, ["frame_synthesis"], 6);
    expect(r.fired).toBe(false);
    expect(r.reason).toContain("confirmatory_min");
  });

  it("fired=true quando required match + 1 confirmatory presente", () => {
    const r = evaluateTransition(
      "baia_to_pasto",
      rule,
      ["frame_synthesis", "meta_cognitive_observation"],
      6,
    );
    expect(r.fired).toBe(true);
    expect(r.confirmatory_matched).toContain("meta_cognitive_observation");
  });

  it("fired=true quando required match + qualquer 1 dos 2 confirmatory", () => {
    const r1 = evaluateTransition(
      "baia_to_pasto",
      rule,
      ["frame_synthesis", "voluntary_topic_deepening"],
      6,
    );
    expect(r1.fired).toBe(true);
  });

  it("confirmatory_min default = 0 (backward compat — confirmatory não bloqueia)", () => {
    const ruleNoMin: TransitionRule = {
      required_signals: ["a"],
      minimum_window_turns: 0,
      confirmatory_signals: ["c"],
      // confirmatory_min not set
    };
    const r = evaluateTransition("t", ruleNoMin, ["a"], 0);
    expect(r.fired).toBe(true);
  });

  it("confirmatory_min=2 exige 2 of N confirmatory", () => {
    const ruleStrict: TransitionRule = {
      required_signals: ["a"],
      minimum_window_turns: 0,
      confirmatory_signals: ["c1", "c2", "c3"],
      confirmatory_min: 2,
    };
    const oneOnly = evaluateTransition("t", ruleStrict, ["a", "c1"], 0);
    expect(oneOnly.fired).toBe(false);
    const twoOk = evaluateTransition("t", ruleStrict, ["a", "c1", "c2"], 0);
    expect(twoOk.fired).toBe(true);
  });
});

describe("evaluateTransition — consecutive_turns (DT-A01-03)", () => {
  const rule: TransitionRule = {
    required_signals: ["distress_marker_high", "gatekeeper_resistance"],
    minimum_window_turns: 0,
    confirmatory_signals: [],
    match_mode: "OR",
    consecutive_turns: 2,
  };

  it("fired=false quando signal aparece em 1 turn apenas (flat — sem signalsPerTurn)", () => {
    const r = evaluateTransition(
      "regression_pasto_to_baia",
      rule,
      ["distress_marker_high"],
      0,
    );
    expect(r.fired).toBe(false);
    expect(r.reason).toContain("consecutive_turns");
  });

  it("fired=false quando signalsPerTurn tem distress em apenas 1 dos últimos 2 turns", () => {
    const r = evaluateTransition(
      "regression_pasto_to_baia",
      rule,
      ["distress_marker_high"],
      0,
      [["mood_drift_up"], ["distress_marker_high"]],
    );
    expect(r.fired).toBe(false);
    expect(r.reason).toContain("consecutive");
  });

  it("fired=true quando signal aparece em 2 turns CONSECUTIVOS no final", () => {
    const r = evaluateTransition(
      "regression_pasto_to_baia",
      rule,
      ["distress_marker_high"],
      0,
      [["mood_drift_up"], ["distress_marker_high"], ["gatekeeper_resistance"]],
    );
    expect(r.fired).toBe(true);
  });

  it("fired=false quando signalsPerTurn tem menos turns que consecutive_turns", () => {
    const r = evaluateTransition(
      "regression_pasto_to_baia",
      rule,
      ["distress_marker_high"],
      0,
      [["distress_marker_high"]],
    );
    expect(r.fired).toBe(false);
  });

  it("consecutive_turns NÃO definido = comportamento legacy (signal em qualquer turn)", () => {
    const ruleLegacy: TransitionRule = {
      required_signals: ["a"],
      minimum_window_turns: 0,
      confirmatory_signals: [],
      // consecutive_turns not set
    };
    const r = evaluateTransition("t", ruleLegacy, ["a"], 0);
    expect(r.fired).toBe(true);
  });
});

describe("parseTransitionsConfig — novos campos opcionais (BUG-KT-01)", () => {
  it("aceita confirmatory_min como number", () => {
    const c = parseTransitionsConfig({
      profile_id: "kids",
      schema_version: "v0.3",
      transitions: {
        baia_to_pasto: {
          required_signals: ["frame_synthesis"],
          minimum_window_turns: 5,
          confirmatory_signals: ["meta_cognitive_observation"],
          confirmatory_min: 1,
          match_mode: "AND",
        },
      },
    });
    expect(c.transitions.baia_to_pasto!.confirmatory_min).toBe(1);
  });

  it("aceita consecutive_turns como number positivo", () => {
    const c = parseTransitionsConfig({
      profile_id: "kids",
      schema_version: "v0.3",
      transitions: {
        regression_pasto_to_baia: {
          required_signals: ["distress_marker_high"],
          minimum_window_turns: 0,
          consecutive_turns: 2,
        },
      },
    });
    expect(c.transitions.regression_pasto_to_baia!.consecutive_turns).toBe(2);
  });

  it("rejeita consecutive_turns negativo ou zero", () => {
    expect(() =>
      parseTransitionsConfig({
        profile_id: "kids",
        schema_version: "v0.3",
        transitions: {
          bad: {
            required_signals: ["a"],
            minimum_window_turns: 0,
            consecutive_turns: 0,
          },
        },
      }),
    ).toThrow();
  });

  it("backward compat — config sem novos campos ainda parseia", () => {
    const c = parseTransitionsConfig({
      profile_id: "test",
      schema_version: "v0",
      transitions: {
        t1: { required_signals: ["a"], minimum_window_turns: 0 },
      },
    });
    expect(c.transitions.t1!.confirmatory_min).toBe(0);
    expect(c.transitions.t1!.consecutive_turns).toBeUndefined();
  });
});
