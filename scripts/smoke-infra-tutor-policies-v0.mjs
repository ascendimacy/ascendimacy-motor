#!/usr/bin/env node
/**
 * Smoke INFRA — Tutor Clássico v0 (Lote 2 - CP6 - Itens 9 + 11 + move_alternatives)
 *
 * Valida os campos novos do contrato tutorial:
 *  - advance_policy: default determinístico por move_type
 *  - failure_policy: default determinístico por move_type
 *  - must_revisit_by_turn: turn atual + 3 quando failure_policy=recheck_later
 *  - move_alternatives: registro de outras decisões que tiveram condição
 *                       satisfeita mas perderam por prioridade
 *
 * Tipo: Infra
 *
 * Uso:
 *   npm run build --workspace shared && \
 *   npm run build --workspace motor-execucao && \
 *   npm run build --workspace planejador
 *   node scripts/smoke-infra-tutor-policies-v0.mjs
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
  const stateDir = await mkdtemp(path.join(tmpdir(), "smoke-infra-tutor-policies-"));
  process.env.MOTOR_STATE_DIR = stateDir;
  console.log(`[smoke-infra] State dir: ${stateDir}\n`);

  const { planTurn } = await import("../planejador/dist/plan.js");
  const { getState, logEvent } = await import("../motor-execucao/dist/state-manager.js");

  console.log("[smoke-infra] Tutor policies — advance/failure/must_revisit + move_alternatives (CP6)\n");

  const persona = {
    id: "infra-tutor-policies",
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

  // ─── G1: explain → advance=hold_until_attempted, sem failure ─────────────
  console.log("[smoke-infra] G1: explain → advance=hold_until_attempted (sem failure)");
  const planE = await planTurn(buildPlanInput("pol-explain", { turn: 4 }));
  const tE = planE.contextHints?.tutorial;
  assert(tE?.move_type === "explain", "move_type=explain");
  assert(tE?.advance_policy === "hold_until_attempted", "advance_policy=hold_until_attempted");
  assert(tE?.failure_policy === undefined, "failure_policy ausente (sem falha esperada na intro)");
  assert(tE?.must_revisit_by_turn === undefined, "must_revisit_by_turn ausente");

  // ─── G2: correct → advance=hold_until_correct, failure=simplify ──────────
  console.log("\n[smoke-infra] G2: correct → advance=hold_until_correct, failure=simplify");
  const planC = await planTurn(
    buildPlanInput("pol-correct", { turn: 4, contextHints: { extracted_signals: ["confusion"] } }),
  );
  const tC = planC.contextHints?.tutorial;
  assert(tC?.move_type === "correct", "move_type=correct");
  assert(tC?.advance_policy === "hold_until_correct", "advance_policy=hold_until_correct");
  assert(tC?.failure_policy === "simplify", "failure_policy=simplify");
  assert(
    tC?.must_revisit_by_turn === undefined,
    "must_revisit_by_turn ausente (correct usa simplify, não recheck_later)",
  );

  // ─── G3: recall → advance=can_move_on, failure=re_explain ────────────────
  console.log("\n[smoke-infra] G3: recall → advance=can_move_on, failure=re_explain");
  const sessR = "pol-recall";
  const probe = await planTurn(buildPlanInput(sessR, { turn: 1 }));
  const seedId = probe.contextHints?.tutorial?.mastery_ref?.id;
  if (typeof seedId === "string" && seedId.length > 0) {
    logEvent(sessR, {
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      type: "playbook_executed",
      playbookId: "p.smoke",
      data: { selectedContentId: seedId },
    });
    const planR = await planTurn(buildPlanInput(sessR, { turn: 5 }));
    const tR = planR.contextHints?.tutorial;
    assert(tR?.move_type === "recall", "move_type=recall");
    assert(tR?.advance_policy === "can_move_on", "advance_policy=can_move_on");
    assert(tR?.failure_policy === "re_explain", "failure_policy=re_explain");
  } else {
    recordBypass("seedId indisponível — não pude validar policies de recall");
  }

  // ─── G4: close → advance=can_move_on, sem failure ────────────────────────
  console.log("\n[smoke-infra] G4: close → advance=can_move_on (sem failure)");
  const planX = await planTurn(
    buildPlanInput("pol-close", { turn: 4, contextHints: { extracted_signals: ["exit_marker_explicit"] } }),
  );
  const tX = planX.contextHints?.tutorial;
  assert(tX?.move_type === "close", "move_type=close");
  assert(tX?.advance_policy === "can_move_on", "advance_policy=can_move_on");
  assert(tX?.failure_policy === undefined, "failure_policy ausente");

  // ─── G5: check/apply policies definidas no switch mas não emitidas ───────
  console.log("\n[smoke-infra] G5: check/apply policies definidas mas não exercitadas em v0.2");
  recordBypass(
    "check/apply não são emitidos em v0.2 — switch já tem defaults prontos pra v0.3",
  );

  // ─── G6: must_revisit_by_turn (só ativa com check, deferido) ─────────────
  console.log("\n[smoke-infra] G6: must_revisit_by_turn (só com failure=recheck_later)");
  recordBypass(
    "must_revisit_by_turn só é populado quando failure_policy=recheck_later (check), que é deferido v0.3",
  );

  // ─── G7: move_alternatives — exit + confusion → close vence, correct alt ─
  console.log("\n[smoke-infra] G7: exit + confusion → close vence; correct vira alternativa");
  const planAlt1 = await planTurn(
    buildPlanInput("pol-alt1", {
      turn: 4,
      contextHints: { extracted_signals: ["exit_marker_explicit", "confusion"] },
    }),
  );
  const tA1 = planAlt1.contextHints?.tutorial;
  assert(tA1?.move_type === "close", "winner=close");
  assert(Array.isArray(tA1?.move_alternatives), "move_alternatives é array");
  assert(tA1?.move_alternatives?.length === 1, "move_alternatives tem 1 entrada");
  assert(
    tA1?.move_alternatives?.[0]?.move_type === "correct",
    "alternativa = correct",
  );
  assert(
    typeof tA1?.move_alternatives?.[0]?.reason === "string" &&
      tA1.move_alternatives[0].reason.length > 0,
    "alternativa tem reason não-vazio",
  );

  // ─── G8: move_alternatives — exit + recall (eventLog seeded) ─────────────
  console.log("\n[smoke-infra] G8: exit + recall pendente → close vence; recall vira alternativa");
  const sessAlt2 = "pol-alt2";
  const probe2 = await planTurn(buildPlanInput(sessAlt2, { turn: 1 }));
  const seedId2 = probe2.contextHints?.tutorial?.mastery_ref?.id;
  if (typeof seedId2 === "string" && seedId2.length > 0) {
    logEvent(sessAlt2, {
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      type: "playbook_executed",
      playbookId: "p.smoke",
      data: { selectedContentId: seedId2 },
    });
    const planAlt2 = await planTurn(
      buildPlanInput(sessAlt2, {
        turn: 5,
        contextHints: { extracted_signals: ["exit_marker_explicit"] },
      }),
    );
    const tA2 = planAlt2.contextHints?.tutorial;
    assert(tA2?.move_type === "close", "winner=close (exit > recall)");
    const recallAlt = tA2?.move_alternatives?.find((a) => a.move_type === "recall");
    assert(recallAlt !== undefined, "recall presente em alternativas");
  } else {
    recordBypass("seedId2 indisponível — não pude validar alternativa recall");
  }

  // ─── G9: sem alternativas quando só uma condição é satisfeita ────────────
  console.log("\n[smoke-infra] G9: ausência de move_alternatives quando decisão é unânime");
  const planSolo = await planTurn(
    buildPlanInput("pol-solo", { turn: 4, contextHints: { extracted_signals: ["confusion"] } }),
  );
  const tSolo = planSolo.contextHints?.tutorial;
  assert(tSolo?.move_type === "correct", "winner=correct (só sinal)");
  assert(
    tSolo?.move_alternatives === undefined,
    "move_alternatives ausente quando não há also-rans",
  );

  // ─── G10: JSON-serializável (todos os campos novos) ─────────────────────
  console.log("\n[smoke-infra] G10: contrato com policies + alternatives é JSON-serializável");
  if (tA1) {
    try {
      const round = JSON.parse(JSON.stringify(tA1));
      assert(round.advance_policy === tA1.advance_policy, "advance_policy preservado");
      assert(round.failure_policy === tA1.failure_policy, "failure_policy preservado (undefined ok)");
      assert(
        Array.isArray(round.move_alternatives) &&
          round.move_alternatives[0]?.move_type === "correct",
        "move_alternatives preservadas",
      );
    } catch (err) {
      assert(false, `serialização falhou: ${err.message}`);
    }
  }

  console.log("");
  console.log(`[smoke-infra] Total: ${pass} pass, ${fail} fail, ${bypass} bypass`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-infra] FATAL:", err);
  process.exit(1);
});
