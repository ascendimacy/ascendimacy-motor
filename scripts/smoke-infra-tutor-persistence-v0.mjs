#!/usr/bin/env node
/**
 * Smoke INFRA — Tutor Clássico v0 (Lote 2 - CP7 - Item 10)
 *
 * Valida que o contrato tutorial é persistido em eventLog como
 * `tutorial_outcome` quando executePlaybook é chamado.
 *
 * v0.2 outcome:
 *  - move_type === "close" → outcome: "deferred"
 *  - demais                → outcome: "attempted"
 *
 * Real classification (correct/incorrect/partial) vem em v0.3.
 *
 * Cobertura:
 * - Item 10: progresso de tutorial sobrevive entre turns via eventLog
 *
 * Tipo: Infra
 *
 * Uso:
 *   npm run build --workspace shared && \
 *   npm run build --workspace motor-execucao && \
 *   npm run build --workspace planejador
 *   node scripts/smoke-infra-tutor-persistence-v0.mjs
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
  const stateDir = await mkdtemp(path.join(tmpdir(), "smoke-infra-tutor-persistence-"));
  process.env.MOTOR_STATE_DIR = stateDir;
  console.log(`[smoke-infra] State dir: ${stateDir}\n`);

  const { planTurn } = await import("../planejador/dist/plan.js");
  const { executePlaybook } = await import("../motor-execucao/dist/executor.js");
  const { getState } = await import("../motor-execucao/dist/state-manager.js");

  console.log("[smoke-infra] Tutor persistence — eventLog tutorial_outcome\n");

  const persona = {
    id: "infra-tutor-persist",
    name: "Test",
    age: 10,
    profile: {},
  };

  const inventory = {
    version: "smoke",
    playbooks: [
      {
        id: "p.smoke",
        title: "smoke",
        category: "test",
        triggers: ["x"],
        content: "smoke playbook",
        estimatedSacrifice: 1,
        estimatedConfidenceGain: 1,
      },
    ],
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

  function runTurn(sessionId, opts = {}) {
    return planTurn(buildPlanInput(sessionId, opts));
  }

  function execWithPlan(sessionId, plan, userMessage = "") {
    return executePlaybook(
      {
        sessionId,
        playbookId: "p.smoke",
        output: "stub output",
        metadata: { contextHints: plan.contextHints, userMessage, personaId: persona.id },
      },
      inventory,
    );
  }

  // ─── G1: explain → tutorial_outcome com outcome=attempted ────────────────
  console.log("[smoke-infra] G1: explain (default) → tutorial_outcome attempted");
  const sessE = "persist-explain";
  const planE = await runTurn(sessE, { turn: 4 });
  execWithPlan(sessE, planE);
  const stateE = getState(sessE);
  const outcomesE = stateE.eventLog.filter((e) => e.type === "tutorial_outcome");
  assert(outcomesE.length === 1, `1 evento tutorial_outcome logged (got ${outcomesE.length})`);
  if (outcomesE.length > 0) {
    const d = outcomesE[0].data;
    assert(d.move_type === "explain", `move_type=explain (got ${d.move_type})`);
    assert(d.outcome === "attempted", `outcome=attempted (got ${d.outcome})`);
    assert(typeof d.teaching_goal === "string" && d.teaching_goal.length > 0, "teaching_goal persistido");
    assert(typeof d.turn === "number" && d.turn > 0, `turn é número positivo (got ${d.turn})`);
  }

  // ─── G2: close → tutorial_outcome com outcome=deferred ───────────────────
  console.log("\n[smoke-infra] G2: close (exit_marker) → tutorial_outcome deferred");
  const sessX = "persist-close";
  const planX = await runTurn(sessX, {
    turn: 4,
    contextHints: { extracted_signals: ["exit_marker_explicit"] },
  });
  execWithPlan(sessX, planX);
  const stateX = getState(sessX);
  const outcomesX = stateX.eventLog.filter((e) => e.type === "tutorial_outcome");
  assert(outcomesX.length === 1, "1 evento tutorial_outcome para close");
  if (outcomesX.length > 0) {
    const d = outcomesX[0].data;
    assert(d.move_type === "close", `move_type=close (got ${d.move_type})`);
    assert(d.outcome === "deferred", `outcome=deferred (got ${d.outcome})`);
  }

  // ─── G3: mastery_ref preservado no event ─────────────────────────────────
  console.log("\n[smoke-infra] G3: mastery_ref preservado no tutorial_outcome");
  if (outcomesE.length > 0) {
    const mr = outcomesE[0].data.mastery_ref;
    assert(mr !== null && typeof mr === "object", "mastery_ref presente como objeto");
    if (mr) {
      assert(mr.kind === "item", "mastery_ref.kind preservado");
      assert(typeof mr.id === "string" && mr.id.length > 0, "mastery_ref.id preservado");
      assert(
        mr.id === planE.contextHints?.tutorial?.mastery_ref?.id,
        "mastery_ref.id idêntico ao contrato emitido",
      );
    }
  }

  // ─── G4: múltiplos turns acumulam eventos ────────────────────────────────
  console.log("\n[smoke-infra] G4: múltiplos turns acumulam tutorial_outcome");
  const sessMulti = "persist-multi";
  const plan1 = await runTurn(sessMulti, { turn: 3 });
  execWithPlan(sessMulti, plan1);
  const plan2 = await runTurn(sessMulti, { turn: 4 });
  execWithPlan(sessMulti, plan2);
  const plan3 = await runTurn(sessMulti, { turn: 5 });
  execWithPlan(sessMulti, plan3);
  const stateMulti = getState(sessMulti);
  const outcomesMulti = stateMulti.eventLog.filter((e) => e.type === "tutorial_outcome");
  assert(outcomesMulti.length === 3, `3 eventos acumulados (got ${outcomesMulti.length})`);
  if (outcomesMulti.length === 3) {
    const turns = outcomesMulti.map((e) => e.data.turn).sort((a, b) => a - b);
    assert(
      turns.length === 3 && turns[0] !== turns[1] && turns[1] !== turns[2],
      `turns distintos entre eventos (got: ${turns.join(",")})`,
    );
  }

  // ─── G5: confusion → outcome=attempted (mesmo com correct move) ──────────
  console.log("\n[smoke-infra] G5: correct (confusion) → tutorial_outcome attempted");
  const sessC = "persist-correct";
  const planC = await runTurn(sessC, {
    turn: 4,
    contextHints: { extracted_signals: ["confusion"] },
  });
  execWithPlan(sessC, planC);
  const stateC = getState(sessC);
  const outcomesC = stateC.eventLog.filter((e) => e.type === "tutorial_outcome");
  assert(outcomesC.length === 1, "1 evento tutorial_outcome para correct");
  if (outcomesC.length > 0) {
    const d = outcomesC[0].data;
    assert(d.move_type === "correct", `move_type=correct (got ${d.move_type})`);
    assert(d.outcome === "attempted", `outcome=attempted (got ${d.outcome})`);
  }

  // ─── G6: shape JSON-serializável ────────────────────────────────────────
  console.log("\n[smoke-infra] G6: tutorial_outcome event é JSON-serializável");
  if (outcomesMulti.length > 0) {
    try {
      const round = JSON.parse(JSON.stringify(outcomesMulti[0]));
      assert(round.type === "tutorial_outcome", "type preservado");
      assert(round.data.move_type === outcomesMulti[0].data.move_type, "move_type preservado");
      assert(round.data.outcome === outcomesMulti[0].data.outcome, "outcome preservado");
    } catch (err) {
      assert(false, `serialização falhou: ${err.message}`);
    }
  }

  // ─── G7: outcomes classification (correct/incorrect/partial) deferred ────
  console.log("\n[smoke-infra] G7: outcomes classification (correct/incorrect/partial)");
  recordBypass(
    "v0.2 emite apenas attempted/deferred — classification real (correct/incorrect/partial) depende de feedback detection v0.3",
  );

  console.log("");
  console.log(`[smoke-infra] Total: ${pass} pass, ${fail} fail, ${bypass} bypass`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-infra] FATAL:", err);
  process.exit(1);
});
