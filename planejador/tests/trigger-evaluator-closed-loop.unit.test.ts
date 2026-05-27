/**
 * Trigger Evaluator closed-loop v1 (ARCHITECTURE.md §S5).
 *
 * Cobre:
 *  - feature flag OFF (default em test) → comportamento v0 preservado
 *  - feature flag ON → fired results ganham closed_loop_action
 *  - parseTransitionTargetZone — derivação correta da target zone
 *  - regressões e nomes malformados — degradação graciosa
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  enrichWithClosedLoopActions,
  parseTransitionTargetZone,
  isClosedLoopEnabled,
} from "../src/trigger-evaluator.js";
import type { TransitionEvaluationResult } from "@ascendimacy/shared";

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  delete process.env["TRIGGER_EVALUATOR_CLOSED_LOOP"];
  delete process.env["NODE_ENV"];
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    process.env[k] = v;
  }
});

const firedResult = (transition_name: string): TransitionEvaluationResult => ({
  transition_name,
  fired: true,
  required_matched: ["philosophical_self_acceptance"],
  confirmatory_matched: [],
  regression_signals_present: [],
  reason: "fired — required matched",
});

const notFiredResult = (transition_name: string): TransitionEvaluationResult => ({
  transition_name,
  fired: false,
  required_matched: [],
  confirmatory_matched: [],
  regression_signals_present: [],
  reason: "required_signals not matched",
});

describe("isClosedLoopEnabled (feature flag)", () => {
  it("default OFF quando NODE_ENV indefinido + sem override", () => {
    expect(isClosedLoopEnabled()).toBe(false);
  });

  it("default ON em produção", () => {
    process.env["NODE_ENV"] = "production";
    expect(isClosedLoopEnabled()).toBe(true);
  });

  it("default OFF em test/dev", () => {
    process.env["NODE_ENV"] = "test";
    expect(isClosedLoopEnabled()).toBe(false);
  });

  it("override explícito true vence default", () => {
    process.env["NODE_ENV"] = "test";
    process.env["TRIGGER_EVALUATOR_CLOSED_LOOP"] = "true";
    expect(isClosedLoopEnabled()).toBe(true);
  });

  it("override explícito false vence prod default", () => {
    process.env["NODE_ENV"] = "production";
    process.env["TRIGGER_EVALUATOR_CLOSED_LOOP"] = "false";
    expect(isClosedLoopEnabled()).toBe(false);
  });

  it("aceita '1' / '0' como aliases", () => {
    process.env["TRIGGER_EVALUATOR_CLOSED_LOOP"] = "1";
    expect(isClosedLoopEnabled()).toBe(true);
    process.env["TRIGGER_EVALUATOR_CLOSED_LOOP"] = "0";
    expect(isClosedLoopEnabled()).toBe(false);
  });
});

describe("parseTransitionTargetZone", () => {
  it("parseia transições forward", () => {
    expect(parseTransitionTargetZone("brejo_to_baia")).toBe("baia");
    expect(parseTransitionTargetZone("baia_to_pasto")).toBe("pasto");
  });

  it("parseia regressões", () => {
    expect(parseTransitionTargetZone("regression_baia_to_brejo")).toBe("brejo");
    expect(parseTransitionTargetZone("regression_pasto_to_baia")).toBe("baia");
  });

  it("retorna null pra nomes malformados", () => {
    expect(parseTransitionTargetZone("not_a_transition")).toBeNull();
    expect(parseTransitionTargetZone("brejo_to_unknown")).toBeNull();
    expect(parseTransitionTargetZone("")).toBeNull();
  });
});

describe("enrichWithClosedLoopActions — flag OFF (v0 fallback)", () => {
  beforeEach(() => {
    process.env["TRIGGER_EVALUATOR_CLOSED_LOOP"] = "false";
  });

  it("retorna resultados sem closed_loop_action (preserva v0)", () => {
    const input = [firedResult("brejo_to_baia"), notFiredResult("baia_to_pasto")];
    const enriched = enrichWithClosedLoopActions(input, "emotional");
    expect(enriched).toHaveLength(2);
    expect(enriched[0].closed_loop_action).toBeUndefined();
    expect(enriched[1].closed_loop_action).toBeUndefined();
  });

  it("não muta input", () => {
    const input = [firedResult("brejo_to_baia")];
    enrichWithClosedLoopActions(input, "emotional");
    expect(input[0].closed_loop_action).toBeUndefined();
  });
});

describe("enrichWithClosedLoopActions — flag ON (v1 closed-loop)", () => {
  beforeEach(() => {
    process.env["TRIGGER_EVALUATOR_CLOSED_LOOP"] = "true";
  });

  it("anexa closed_loop_action a results fired", () => {
    const input = [firedResult("brejo_to_baia")];
    const enriched = enrichWithClosedLoopActions(input, "emotional");
    expect(enriched[0].closed_loop_action).toEqual({
      dimension: "emotional",
      target_zone: "baia",
      source: "trigger_evaluator",
    });
  });

  it("NÃO anexa a results !fired", () => {
    const input = [notFiredResult("brejo_to_baia")];
    const enriched = enrichWithClosedLoopActions(input, "emotional");
    expect(enriched[0].closed_loop_action).toBeUndefined();
  });

  it("regressões disparam target_zone correto", () => {
    const input = [
      firedResult("regression_baia_to_brejo"),
      firedResult("regression_pasto_to_baia"),
    ];
    const enriched = enrichWithClosedLoopActions(input, "emotional");
    expect(enriched[0].closed_loop_action?.target_zone).toBe("brejo");
    expect(enriched[1].closed_loop_action?.target_zone).toBe("baia");
  });

  it("usa focusDimension passada", () => {
    const input = [firedResult("brejo_to_baia")];
    const enriched = enrichWithClosedLoopActions(input, "social_with_ebrota");
    expect(enriched[0].closed_loop_action?.dimension).toBe("social_with_ebrota");
  });

  it("fallback 'emotional' quando focusDimension undefined", () => {
    const input = [firedResult("brejo_to_baia")];
    const enriched = enrichWithClosedLoopActions(input, undefined);
    expect(enriched[0].closed_loop_action?.dimension).toBe("emotional");
  });

  it("nome malformado → fired mas sem closed_loop_action (degradação graciosa)", () => {
    const input = [firedResult("not_a_transition_name")];
    const enriched = enrichWithClosedLoopActions(input, "emotional");
    expect(enriched[0].fired).toBe(true);
    expect(enriched[0].closed_loop_action).toBeUndefined();
  });

  it("não muta input (mantém pureza)", () => {
    const input = [firedResult("brejo_to_baia")];
    enrichWithClosedLoopActions(input, "emotional");
    expect(input[0].closed_loop_action).toBeUndefined();
  });

  it("processa lista mista (fired + !fired)", () => {
    const input = [
      firedResult("brejo_to_baia"),
      notFiredResult("baia_to_pasto"),
      firedResult("regression_baia_to_brejo"),
    ];
    const enriched = enrichWithClosedLoopActions(input, "emotional");
    expect(enriched[0].closed_loop_action?.target_zone).toBe("baia");
    expect(enriched[1].closed_loop_action).toBeUndefined();
    expect(enriched[2].closed_loop_action?.target_zone).toBe("brejo");
  });
});
