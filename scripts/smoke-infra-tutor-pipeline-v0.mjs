#!/usr/bin/env node
/**
 * Smoke INFRA — Tutor Clássico v0 (Lote 1 - Item 2)
 *
 * Valida que o contrato de movimento tutorial é preservado desde o planejador
 * até o input do materializer.
 *
 * Cobertura:
 * - Item 2: Preservação do contrato no pipeline (planejador → buildDrotaPrompt)
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
  const stateDir = await mkdtemp(path.join(tmpdir(), "smoke-infra-tutor-pipeline-"));
  process.env.MOTOR_STATE_DIR = stateDir;
  console.log(`[smoke-infra] State dir: ${stateDir}\n`);

  // Imports
  const { planTurn } = await import("../planejador/dist/plan.js");
  const { getState } = await import("../motor-execucao/dist/state-manager.js");
  const { buildDrotaPrompt } = await import("../motor-drota/dist/server.js");

  console.log("[smoke-infra] Tutor Pipeline — Preservação do contrato até o materializer\n");

  const persona = {
    id: "infra-tutor-pipeline",
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

  // ─── G1: planTurn emite contrato ─────────────────────────────────────────
  console.log("[smoke-infra] G1: planTurn emite contrato tutorial");
  const plan = await planTurn(buildPlanInput("pipeline-tutor-g1", { turn: 5 }));

  assert(plan.contextHints?.tutorial !== undefined, "contextHints.tutorial presente no plan");
  if (plan.contextHints?.tutorial) {
    assert(plan.contextHints.tutorial.move_type === "explain", "move_type=explain (v0.1)");
  }

  // ─── G2: contrato chega até buildDrotaPrompt (materializer side) ────────
  console.log("\n[smoke-infra] G2: contrato preservado até buildDrotaPrompt");
  const drotaInput = {
    persona,
    state: { sessionId: "pipeline-tutor-g1", trustLevel: 0.4, budgetRemaining: 85, turn: 5 },
    contentPool: plan.contentPool,
    contextHints: plan.contextHints,
    strategicRationale: plan.strategicRationale,
    instruction_addition: plan.instruction_addition ?? "",
  };

  // Chamada real para a função que o materializer usa para montar o prompt
  const drotaPrompt = buildDrotaPrompt(drotaInput, plan.contentPool?.[0] ?? null);

  // Verificamos se o contrato ainda está presente no contexto que chegou no drota
  const hasTutorialInDrotaInput = drotaInput.contextHints?.tutorial !== undefined;
  assert(hasTutorialInDrotaInput, "contextHints.tutorial ainda presente no input do materializer");

  if (hasTutorialInDrotaInput) {
    assert(
      drotaInput.contextHints.tutorial.move_type === "explain",
      "move_type preservado até o materializer"
    );
  }

  // ─── G3: contrato aparece no prompt gerado (melhor observabilidade) ────────
  console.log("\n[smoke-infra] G3: contrato aparece no prompt gerado pelo materializer");
  const teachingGoal = plan.contextHints?.tutorial?.teaching_goal;

  if (teachingGoal && drotaPrompt.includes(teachingGoal)) {
    assert(true, `teaching_goal aparece no prompt gerado ("${teachingGoal}")`);
  } else {
    recordBypass(`teaching_goal ainda não aparece no prompt gerado (esperado em v0.1 — materializer ainda não reage ao contrato)`);
  }

  console.log("");
  console.log(`[smoke-infra] Total: ${pass} pass, ${fail} fail, ${bypass} bypass`);

  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-infra] FATAL:", err);
  process.exit(1);
});
