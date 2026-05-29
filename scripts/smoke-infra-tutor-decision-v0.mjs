#!/usr/bin/env node
/**
 * Smoke INFRA — Tutor Clássico v0 (Lote 1 - CP4 - Itens 6 + 7)
 *
 * Valida a heurística determinística de decisão de `move_type` em
 * `computeBasicTutorialContext` + integração com `extracted_signals`.
 *
 * Heurística v0.2 (ratificada em docs/specs/2026-05-28-loop-tutorial-v0.md):
 *  1. exit_marker_*    -> close
 *  2. confusion/distress/frustration -> correct
 *  3. top item já em eventLog (playbook_executed) -> recall
 *  4. default          -> explain
 *
 * Cobertura:
 * - Item 6: Decisão variada de move_type (sai do always-explain)
 * - Item 7: Integração com extracted_signals
 *
 * Tipo: Infra
 *
 * Uso:
 *   npm run build --workspace shared && \
 *   npm run build --workspace motor-execucao && \
 *   npm run build --workspace planejador
 *   node scripts/smoke-infra-tutor-decision-v0.mjs
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
  const stateDir = await mkdtemp(path.join(tmpdir(), "smoke-infra-tutor-decision-"));
  process.env.MOTOR_STATE_DIR = stateDir;
  console.log(`[smoke-infra] State dir: ${stateDir}\n`);

  const { planTurn } = await import("../planejador/dist/plan.js");
  const { getState, logEvent } = await import("../motor-execucao/dist/state-manager.js");

  console.log("[smoke-infra] Tutor Decision — heurística determinística (CP4)\n");

  const persona = {
    id: "infra-tutor-decision",
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

  // ─── G1: default (sem sinais, sessão nova) → explain ─────────────────────
  console.log("[smoke-infra] G1: default sem sinais → explain");
  const plan1 = await planTurn(buildPlanInput("decision-g1", { turn: 4 }));
  assert(plan1.contextHints?.tutorial?.move_type === "explain", "move_type=explain (default)");

  // ─── G2: exit_marker_explicit → close ────────────────────────────────────
  console.log("\n[smoke-infra] G2: extracted_signals=[exit_marker_explicit] → close");
  const plan2 = await planTurn(
    buildPlanInput("decision-g2", {
      turn: 4,
      contextHints: { extracted_signals: ["exit_marker_explicit"] },
    }),
  );
  assert(plan2.contextHints?.tutorial?.move_type === "close", "move_type=close");
  assert(
    /sa.da|fechar/i.test(plan2.contextHints?.tutorial?.teaching_goal ?? ""),
    "teaching_goal reflete fechamento/saída",
  );

  // ─── G3: confusion → correct ─────────────────────────────────────────────
  console.log("\n[smoke-infra] G3: extracted_signals=[confusion] → correct");
  const plan3 = await planTurn(
    buildPlanInput("decision-g3", {
      turn: 4,
      contextHints: { extracted_signals: ["confusion"] },
    }),
  );
  assert(plan3.contextHints?.tutorial?.move_type === "correct", "move_type=correct");

  // ─── G4: distress também → correct (sinal sinônimo) ──────────────────────
  console.log("\n[smoke-infra] G4: extracted_signals=[distress] → correct (sinônimo)");
  const plan4 = await planTurn(
    buildPlanInput("decision-g4", {
      turn: 4,
      contextHints: { extracted_signals: ["distress"] },
    }),
  );
  assert(plan4.contextHints?.tutorial?.move_type === "correct", "distress trata como correct");

  // ─── G5: top item já em eventLog → recall ────────────────────────────────
  console.log("\n[smoke-infra] G5: top item já apresentado → recall");
  const sessG5 = "decision-g5";
  // Descobre primeiro qual item o scorer vai retornar
  const probe = await planTurn(buildPlanInput(sessG5, { turn: 1 }));
  const targetId = probe.contextHints?.tutorial?.mastery_ref?.id;
  if (typeof targetId === "string" && targetId.length > 0) {
    // Semeia evento de playbook_executed pra esse content
    logEvent(sessG5, {
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      type: "playbook_executed",
      playbookId: "p.smoke",
      data: { selectedContentId: targetId },
    });
    const plan5 = await planTurn(buildPlanInput(sessG5, { turn: 5 }));
    assert(
      plan5.contextHints?.tutorial?.move_type === "recall",
      `move_type=recall após eventLog ter playbook_executed para '${targetId}'`,
    );
    assert(
      plan5.contextHints?.tutorial?.mastery_ref?.id === targetId,
      "mastery_ref.id continua ancorado no item recordado",
    );
  } else {
    recordBypass("targetId indisponível — não foi possível semear eventLog");
  }

  // ─── G6: prioridade — exit_marker vence confusion ────────────────────────
  console.log("\n[smoke-infra] G6: prioridade — exit_marker vence sobre confusion");
  const plan6 = await planTurn(
    buildPlanInput("decision-g6", {
      turn: 4,
      contextHints: { extracted_signals: ["confusion", "exit_marker_implicit"] },
    }),
  );
  assert(plan6.contextHints?.tutorial?.move_type === "close", "exit vence confusion");

  // ─── G7: sinais desconhecidos não disparam decisão (fallback explain) ────
  console.log("\n[smoke-infra] G7: sinais não-mapeados → explain (fallback robusto)");
  const plan7 = await planTurn(
    buildPlanInput("decision-g7", {
      turn: 4,
      contextHints: { extracted_signals: ["signal_que_nao_existe_xyz"] },
    }),
  );
  assert(plan7.contextHints?.tutorial?.move_type === "explain", "sinais desconhecidos não corrompem decisão");

  // ─── G8: check/apply diferidos pra v0.3 ──────────────────────────────────
  console.log("\n[smoke-infra] G8: check/apply diferidos (v0.3)");
  recordBypass("move_type=check e move_type=apply não emitidos em v0.2 — diferidos pra v0.3");

  // ─── G9: discovery gate (v0.2.6) → move_type=discover ────────────────────
  console.log("\n[smoke-infra] G9: journey_stage=discovery_only → move_type=discover (v0.2.6)");
  const planDisc = await planTurn(
    buildPlanInput("decision-g9", {
      turn: 4,
      contextHints: { journey_stage: "discovery_only" },
    }),
  );
  const tDisc = planDisc.contextHints?.tutorial;
  assert(tDisc?.move_type === "discover", `journey_stage=discovery_only → discover (got ${tDisc?.move_type})`);
  assert(tDisc?.mastery_ref === undefined, "discover NÃO ancora em mastery_ref (sem conteúdo)");
  assert(tDisc?.advance_policy === "can_move_on", "advance_policy=can_move_on em discover");

  // ─── G10: discover é overridable por exit_marker (prioridade preservada) ──
  console.log("\n[smoke-infra] G10: exit_marker vence sobre discovery_only");
  const planExitDisc = await planTurn(
    buildPlanInput("decision-g10", {
      turn: 4,
      contextHints: {
        journey_stage: "discovery_only",
        extracted_signals: ["exit_marker_explicit"],
      },
    }),
  );
  assert(
    planExitDisc.contextHints?.tutorial?.move_type === "close",
    `exit > discovery: move_type=close (got ${planExitDisc.contextHints?.tutorial?.move_type})`,
  );

  // ─── G11: discover ignorado quando journey_stage avançou ────────────────
  console.log("\n[smoke-infra] G11: journey_stage=applied_double_helix → comportamento regular");
  const planApplied = await planTurn(
    buildPlanInput("decision-g11", {
      turn: 4,
      contextHints: { journey_stage: "applied_double_helix" },
    }),
  );
  assert(
    planApplied.contextHints?.tutorial?.move_type === "explain",
    `applied stage → explain regular (got ${planApplied.contextHints?.tutorial?.move_type})`,
  );

  console.log("");
  console.log(`[smoke-infra] Total: ${pass} pass, ${fail} fail, ${bypass} bypass`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-infra] FATAL:", err);
  process.exit(1);
});
