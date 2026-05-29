#!/usr/bin/env node
/**
 * Smoke INFRA — Tutor Clássico v0 (Lote 1 - CP2 - Item 3)
 *
 * Valida observabilidade do contrato tutorial: campos do contrato
 * num formato que consumidores downstream de trace (replay UI,
 * NDJSON, EngineTraceV2) conseguem consumir.
 *
 * Cobertura:
 * - Item 3: Registro em trace (shape estável + JSON-serializável +
 *   estabilidade entre turns + integração com `_trace` v2 quando presente)
 *
 * Tipo: Infra
 *
 * Uso:
 *   npm run build --workspace shared && \
 *   npm run build --workspace motor-execucao && \
 *   npm run build --workspace planejador
 *   node scripts/smoke-infra-tutor-trace-v0.mjs
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.USE_MOCK_LLM = "true";
process.env.ASC_DEBUG_MODE = "false";

let pass = 0;
let fail = 0;
let bypass = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    pass++;
  } else {
    console.log(`  ✗ ${msg}`);
    fail++;
  }
}

function recordBypass(msg) {
  console.log(`  ○ ${msg} (bypass)`);
  bypass++;
}

async function main() {
  const stateDir = await mkdtemp(path.join(tmpdir(), "smoke-infra-tutor-trace-"));
  process.env.MOTOR_STATE_DIR = stateDir;
  console.log(`[smoke-infra] State dir: ${stateDir}\n`);

  const { planTurn } = await import("../planejador/dist/plan.js");
  const { getState } = await import("../motor-execucao/dist/state-manager.js");

  console.log("[smoke-infra] Tutor Trace — observabilidade do contrato\n");

  const persona = {
    id: "infra-tutor-trace",
    name: "Test",
    age: 10,
    profile: {},
  };

  function buildPlanInput(sessionId, opts = {}) {
    const { contextHints, incomingMessage, ...stateExtras } = opts;
    const state = getState(sessionId);
    const input = {
      sessionId,
      persona,
      state: { ...state, ...stateExtras },
    };
    if (contextHints) input.contextHints = contextHints;
    if (incomingMessage !== undefined) input.incomingMessage = incomingMessage;
    return input;
  }

  const plan = await planTurn(buildPlanInput("trace-g1", { turn: 4 }));
  const tutorial = plan.contextHints?.tutorial;

  // ─── G1: shape estável ───────────────────────────────────────────────────
  console.log("[smoke-infra] G1: shape estável do contrato");
  assert(tutorial !== undefined, "contextHints.tutorial presente");
  if (tutorial) {
    assert(typeof tutorial.move_type === "string", "move_type é string");
    assert(
      typeof tutorial.teaching_goal === "string" && tutorial.teaching_goal.length > 0,
      "teaching_goal é string não-vazia",
    );
    assert(
      tutorial.teaching_goal.length <= 80,
      `teaching_goal respeita limite de 80 chars (got ${tutorial.teaching_goal.length})`,
    );
  }

  // ─── G2: JSON-serializável (trace-ready) ─────────────────────────────────
  console.log("\n[smoke-infra] G2: contrato é JSON-serializável (consumível por trace/NDJSON/replay)");
  if (tutorial) {
    let serialized;
    let deserialized;
    try {
      serialized = JSON.stringify(tutorial);
      deserialized = JSON.parse(serialized);
      assert(true, "JSON.stringify + parse round-trip sem erro");
    } catch (err) {
      assert(false, `serialização falhou: ${err.message}`);
    }
    if (deserialized) {
      assert(deserialized.move_type === tutorial.move_type, "move_type preservado no round-trip");
      assert(
        deserialized.teaching_goal === tutorial.teaching_goal,
        "teaching_goal preservado no round-trip",
      );
    }
    assert(
      !Object.values(tutorial).some((v) => typeof v === "function"),
      "nenhum campo é função (não-serializável)",
    );
  }

  // ─── G3: estabilidade entre turns ────────────────────────────────────────
  console.log("\n[smoke-infra] G3: contrato consistente em múltiplos turns (estabilidade para trace)");
  const plan2 = await planTurn(buildPlanInput("trace-g2", { turn: 7 }));
  const plan3 = await planTurn(buildPlanInput("trace-g3", { turn: 12 }));
  assert(plan2.contextHints?.tutorial?.move_type === "explain", "turn 7: move_type=explain");
  assert(plan3.contextHints?.tutorial?.move_type === "explain", "turn 12: move_type=explain");
  assert(
    typeof plan2.contextHints?.tutorial?.teaching_goal === "string",
    "turn 7: teaching_goal continua string",
  );

  // ─── G4: integração com EngineTraceV2 (_trace) ──────────────────────────
  console.log("\n[smoke-infra] G4: compatibilidade com EngineTraceV2 (_trace)");
  const trace = plan._trace;
  if (trace && typeof trace === "object") {
    assert(true, "_trace presente no PlanTurnOutput");
  } else {
    recordBypass(
      "plan._trace ausente — esperado quando planTurn é chamado sem opts.collector (TV2-3)",
    );
  }

  // ─── G5: mastery_ref opcional em v0.1 ────────────────────────────────────
  console.log("\n[smoke-infra] G5: mastery_ref (campo opcional em v0.1)");
  if (tutorial && tutorial.mastery_ref) {
    assert(typeof tutorial.mastery_ref.kind === "string", "mastery_ref.kind presente");
    assert(typeof tutorial.mastery_ref.id === "string", "mastery_ref.id presente");
  } else {
    recordBypass("mastery_ref opcional em v0.1 — será preenchido no CP3 (Item 5)");
  }

  console.log("");
  console.log(`[smoke-infra] Total: ${pass} pass, ${fail} fail, ${bypass} bypass`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-infra] FATAL:", err);
  process.exit(1);
});
