/**
 * Tests trigger-evaluator (motor#25).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateAllTransitions,
  collectRecentSignals,
  resetTransitionsConfigCache,
} from "../src/trigger-evaluator.js";

let tmpDir: string;
const ORIG_ENV = { ...process.env };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "trigger-eval-test-"));
  mkdirSync(tmpDir, { recursive: true });
  process.env["CONTENT_PROFILES_DIR"] = tmpDir;
  resetTransitionsConfigCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
});

const writeYaml = (profileId: string, content: string) => {
  writeFileSync(join(tmpDir, `${profileId}.transitions.yaml`), content);
};

const KIDS_YAML = `
profile_id: kids
schema_version: v0
transitions:
  brejo_to_baia:
    required_signals:
      - philosophical_self_acceptance
      - voluntary_topic_deepening
    minimum_window_turns: 2
    confirmatory_signals:
      - mood_drift_up
    regression_to_brejo_if:
      - distress_marker_high
  baia_to_pasto:
    required_signals:
      - meta_cognitive_observation
    minimum_window_turns: 5
`;

describe("evaluateAllTransitions", () => {
  it("retorna [] quando profile sem YAML", () => {
    const r = evaluateAllTransitions("nonexistent", ["any"], 5);
    expect(r).toEqual([]);
  });

  it("avalia todas as transições do perfil", () => {
    writeYaml("kids", KIDS_YAML);
    const r = evaluateAllTransitions(
      "kids",
      ["philosophical_self_acceptance"],
      3,
    );
    expect(r).toHaveLength(2); // brejo_to_baia + baia_to_pasto
    const brejo = r.find((x) => x.transition_name === "brejo_to_baia");
    expect(brejo?.fired).toBe(true);
  });

  it("brejo_to_baia fired com signal correto + janela ok", () => {
    writeYaml("kids", KIDS_YAML);
    const r = evaluateAllTransitions("kids", ["voluntary_topic_deepening"], 3);
    const brejo = r.find((x) => x.transition_name === "brejo_to_baia")!;
    expect(brejo.fired).toBe(true);
    expect(brejo.required_matched).toEqual(["voluntary_topic_deepening"]);
  });

  it("brejo_to_baia NÃO fired com janela curta", () => {
    writeYaml("kids", KIDS_YAML);
    const r = evaluateAllTransitions("kids", ["philosophical_self_acceptance"], 1);
    const brejo = r.find((x) => x.transition_name === "brejo_to_baia")!;
    expect(brejo.fired).toBe(false);
    expect(brejo.reason).toContain("minimum_window_turns");
  });

  it("brejo_to_baia NÃO fired com regression signal presente", () => {
    writeYaml("kids", KIDS_YAML);
    const r = evaluateAllTransitions(
      "kids",
      ["philosophical_self_acceptance", "distress_marker_high"],
      3,
    );
    const brejo = r.find((x) => x.transition_name === "brejo_to_baia")!;
    expect(brejo.fired).toBe(false);
    expect(brejo.regression_signals_present).toContain("distress_marker_high");
  });

  it("baia_to_pasto exige minimum_window_turns 5", () => {
    writeYaml("kids", KIDS_YAML);
    const r = evaluateAllTransitions("kids", ["meta_cognitive_observation"], 4);
    const baia = r.find((x) => x.transition_name === "baia_to_pasto")!;
    expect(baia.fired).toBe(false);
  });

  it("baia_to_pasto fired com window 5+", () => {
    writeYaml("kids", KIDS_YAML);
    const r = evaluateAllTransitions("kids", ["meta_cognitive_observation"], 6);
    const baia = r.find((x) => x.transition_name === "baia_to_pasto")!;
    expect(baia.fired).toBe(true);
  });
});

describe("collectRecentSignals", () => {
  it("extrai signals de events tipo signals_extracted", () => {
    const log = [
      { type: "playbook_executed", data: {} },
      {
        type: "signals_extracted",
        data: { signals: ["a", "b"], overall_confidence: 0.8 },
      },
      {
        type: "signals_extracted",
        data: { signals: ["b", "c"] },
      },
    ];
    const signals = collectRecentSignals(log, 5);
    expect(signals.sort()).toEqual(["a", "b", "c"]);
  });

  it("respeita lookbackTurns (últimos N events de signal)", () => {
    const log = [
      { type: "signals_extracted", data: { signals: ["old1"] } },
      { type: "signals_extracted", data: { signals: ["old2"] } },
      { type: "signals_extracted", data: { signals: ["recent"] } },
    ];
    const signals = collectRecentSignals(log, 1);
    expect(signals).toEqual(["recent"]);
  });

  it("retorna [] quando log sem signal events", () => {
    const log = [{ type: "playbook_executed", data: {} }];
    expect(collectRecentSignals(log, 5)).toEqual([]);
  });

  it("ignora data.signals malformado", () => {
    const log = [
      { type: "signals_extracted", data: { signals: "not array" } },
      { type: "signals_extracted", data: {} },
      { type: "signals_extracted", data: { signals: ["valid"] } },
    ];
    expect(collectRecentSignals(log, 5)).toEqual(["valid"]);
  });
});
