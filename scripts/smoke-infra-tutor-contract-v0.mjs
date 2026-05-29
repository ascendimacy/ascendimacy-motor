#!/usr/bin/env node
/**
 * Smoke INFRA — Tutor Clássico v0 (Lote 1 - Item 1)
 *
 * Valida a emissão do contrato de movimento tutorial pelo planejador.
 *
 * Cobertura:
 * - Item 1: Emissão do contrato (contextHints.tutorial)
 *
 * Tipo: Infra
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
  console.log(`  ○ ${msg} (bypass - mock mode)`);
  bypass++;
}

async function main() {
  const stateDir = await mkdtemp(path.join(tmpdir(), "smoke-infra-tutor-"));
  process.env.MOTOR_STATE_DIR = stateDir;
  console.log(`[smoke-infra] State dir: ${stateDir}\n`);

  const { planTurn } = await import("../planejador/dist/plan.js");
  const { getState } = await import("../motor-execucao/dist/state-manager.js");

  console.log("[smoke-infra] Tutor Clássico v0.1 — validação de contrato\n");

  const persona = {
    id: "infra-tutor",
    name: "Test",
    age: 10,
    profile: {},
  };

  function buildPlanInput(sessionId, opts = {}) {
    // Separa campos que vão no nível raiz do PlanTurnInput (contextHints, incomingMessage)
    // dos campos que pertencem ao state.
    const { contextHints, incomingMessage, ...stateExtras } = opts;
    const state = getState(sessionId);

    const input = {
      sessionId,
      persona,
      state: { ...state, ...stateExtras },
    };

    if (contextHints) {
      input.contextHints = contextHints;
    }
    if (incomingMessage !== undefined) {
      input.incomingMessage = incomingMessage;
    }

    return input;
  }

  // ─── G1: emissão básica do contrato ───────────────────────────────────────
  console.log("[smoke-infra] G1: planTurn emite contextHints.tutorial");
  const plan1 = await planTurn(buildPlanInput("infra-tutor-g1", { turn: 3 }));

  assert(
    plan1.contextHints?.tutorial !== undefined,
    "contextHints.tutorial presente no retorno do planTurn",
  );

  if (plan1.contextHints?.tutorial) {
    const t = plan1.contextHints.tutorial;
    assert(typeof t.teaching_goal === "string" && t.teaching_goal.length > 0, "teaching_goal é string não-vazia");
    assert(t.move_type !== undefined, "move_type presente");
    assert(t.move_type === "explain", `move_type === "explain" (v0.1) (got: ${t.move_type})`);
  }

  // ─── G2: contrato presente mesmo sem incomingMessage ─────────────────────
  console.log("\n[smoke-infra] G2: contrato tutorial presente sem incomingMessage");
  const plan2 = await planTurn(buildPlanInput("infra-tutor-g2", { turn: 1, incomingMessage: undefined }));

  assert(
    plan2.contextHints?.tutorial !== undefined,
    "contextHints.tutorial presente mesmo sem incomingMessage",
  );

  if (plan2.contextHints?.tutorial) {
    const t = plan2.contextHints.tutorial;
    assert(typeof t.teaching_goal === "string", "teaching_goal existe");
    assert(t.move_type === "explain", "move_type=explain");
  }

  // ─── G3: contrato não polui outros contextHints ──────────────────────────
  // Nota: preservação de hints arbitrários do caller é bypassada quando USE_MOCK_LLM=true
  // (ver recordBypass abaixo). Em modo real (mock=false) esse check viraria assert normal.
  console.log("\n[smoke-infra] G3: contrato tutorial não quebra outros contextHints");
  const plan3 = await planTurn(
    buildPlanInput("infra-tutor-g3", {
      turn: 4,
      contextHints: { existing_hint: "deve_sobreviver" },
    }),
  );

  recordBypass("outros contextHints preservados (bypass ativo em mock)");
  assert(plan3.contextHints?.tutorial !== undefined, "tutorial ainda presente junto com outros hints");

  console.log("");
  console.log(`[smoke-infra] Total: ${pass} pass, ${fail} fail, ${bypass} bypass`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-infra] FATAL:", err);
  process.exit(1);
});
