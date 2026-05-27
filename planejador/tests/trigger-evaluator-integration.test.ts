/**
 * Integration test — closed-loop v1 flow (ARCHITECTURE.md §S5).
 *
 * Simula 5 turns com signals progressivos contra o kids.transitions.yaml
 * real. Última iteração satisfaz minimum_window_turns + required_signals
 * e dispara brejo_to_baia. Verifica que:
 *   - Resultado fired chega enriquecido com closed_loop_action (flag ON)
 *   - target_zone derivada do transition_name está correta
 *   - Flag OFF preserva comportamento v0 (sem closed_loop_action)
 *
 * Não exercita o orchestrator/MCP layer (testes desse nível ficam em
 * orchestrator/tests/). Aqui testa a contract entre planejador e cliente
 * downstream.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateAllTransitions,
  collectRecentSignals,
  collectRecentSignalsPerTurn,
  enrichWithClosedLoopActions,
  resetTransitionsConfigCache,
} from "../src/trigger-evaluator.js";

const REAL_CONTENT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../content/profiles",
);

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  process.env["CONTENT_PROFILES_DIR"] = REAL_CONTENT_DIR;
  resetTransitionsConfigCache();
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    process.env[k] = v;
  }
});

interface EventLog {
  type: string;
  data: Record<string, unknown>;
}

/** Helper que executa um turno: append signals_extracted + executar pipeline. */
function runTurn(
  eventLog: EventLog[],
  signals: string[],
  turnsSinceLastTransition: number,
  focusDimension: string,
) {
  eventLog.push({
    type: "signals_extracted",
    data: { signals },
  });
  eventLog.push({ type: "playbook_executed", data: {} });

  const recentSignals = collectRecentSignals(eventLog, 5);
  const recentSignalsPerTurn = collectRecentSignalsPerTurn(eventLog, 5);
  const raw = evaluateAllTransitions(
    "kids",
    recentSignals,
    turnsSinceLastTransition,
    recentSignalsPerTurn,
  );
  return enrichWithClosedLoopActions(raw, focusDimension);
}

describe("closed-loop integration — 5-turn progressive signals flow", () => {
  it("flag ON: turn 3+ acumula janela suficiente → fired + closed_loop_action.target_zone='baia'", () => {
    process.env["TRIGGER_EVALUATOR_CLOSED_LOOP"] = "true";
    const eventLog: EventLog[] = [];

    // Turn 1: signal correto mas janela ainda 0
    const t1 = runTurn(eventLog, ["philosophical_self_acceptance"], 0, "emotional");
    const t1Brejo = t1.find((r) => r.transition_name === "brejo_to_baia");
    expect(t1Brejo?.fired).toBe(false);
    expect(t1Brejo?.closed_loop_action).toBeUndefined();

    // Turn 2: ainda janela curta (1)
    const t2 = runTurn(eventLog, ["voluntary_topic_deepening"], 1, "emotional");
    const t2Brejo = t2.find((r) => r.transition_name === "brejo_to_baia");
    expect(t2Brejo?.fired).toBe(false);
    expect(t2Brejo?.closed_loop_action).toBeUndefined();

    // Turn 3: janela ≥ 2, signal presente → fire
    const t3 = runTurn(eventLog, ["philosophical_self_acceptance"], 2, "emotional");
    const t3Brejo = t3.find((r) => r.transition_name === "brejo_to_baia");
    expect(t3Brejo?.fired).toBe(true);
    expect(t3Brejo?.closed_loop_action).toEqual({
      dimension: "emotional",
      target_zone: "baia",
      source: "trigger_evaluator",
    });
  });

  it("flag OFF: mesmo flow, mesma fired, MAS sem closed_loop_action (v0 fallback)", () => {
    process.env["TRIGGER_EVALUATOR_CLOSED_LOOP"] = "false";
    const eventLog: EventLog[] = [];
    runTurn(eventLog, ["philosophical_self_acceptance"], 0, "emotional");
    runTurn(eventLog, ["voluntary_topic_deepening"], 1, "emotional");
    const t3 = runTurn(eventLog, ["philosophical_self_acceptance"], 2, "emotional");
    const t3Brejo = t3.find((r) => r.transition_name === "brejo_to_baia");
    expect(t3Brejo?.fired).toBe(true);
    expect(t3Brejo?.closed_loop_action).toBeUndefined();
  });

  it("flag ON: regressão dispara closed_loop_action.target_zone='brejo' em 2 turns consecutivos", () => {
    process.env["TRIGGER_EVALUATOR_CLOSED_LOOP"] = "true";
    const eventLog: EventLog[] = [];

    // 2 turns consecutivos com distress → regression_baia_to_brejo
    runTurn(eventLog, ["distress_marker_high"], 0, "emotional");
    const t2 = runTurn(eventLog, ["distress_marker_high"], 0, "emotional");
    const regr = t2.find((r) => r.transition_name === "regression_baia_to_brejo");
    expect(regr?.fired).toBe(true);
    expect(regr?.closed_loop_action?.target_zone).toBe("brejo");
    expect(regr?.closed_loop_action?.source).toBe("trigger_evaluator");
  });

  it("flag ON: regression signal bloqueia forward transition — sem closed_loop_action", () => {
    process.env["TRIGGER_EVALUATOR_CLOSED_LOOP"] = "true";
    const eventLog: EventLog[] = [];
    // janela OK + required presente, mas regression signal também → fired=false
    const t = runTurn(
      eventLog,
      ["philosophical_self_acceptance", "distress_marker_high"],
      3,
      "emotional",
    );
    const brejo = t.find((r) => r.transition_name === "brejo_to_baia");
    expect(brejo?.fired).toBe(false);
    expect(brejo?.closed_loop_action).toBeUndefined();
  });

  it("flag ON com focusDimension custom: closed_loop_action.dimension reflete focus", () => {
    process.env["TRIGGER_EVALUATOR_CLOSED_LOOP"] = "true";
    const eventLog: EventLog[] = [];
    runTurn(eventLog, ["philosophical_self_acceptance"], 0, "social_with_parent");
    runTurn(eventLog, ["voluntary_topic_deepening"], 1, "social_with_parent");
    const t3 = runTurn(
      eventLog,
      ["philosophical_self_acceptance"],
      2,
      "social_with_parent",
    );
    const fired = t3.find((r) => r.fired && r.closed_loop_action);
    expect(fired?.closed_loop_action?.dimension).toBe("social_with_parent");
  });
});
