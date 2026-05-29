#!/usr/bin/env node
/**
 * Smoke FUNCIONAL — Tutor Clássico v0 (Lote 2 - CP9 - Item 13)
 *
 * E2E multi-turn: golden path do tutor passando por 4 movimentos em
 * sequência (explain → correct → recall → close), validando que o
 * contrato evolui corretamente turn-a-turn e que estado/policies/
 * alternatives são coerentes com a história acumulada da sessão.
 *
 * Diferenças dos INFRA smokes:
 * - Testa COMPORTAMENTO acumulativo (não shape de um turn isolado)
 * - Usa USE_MOCK_LLM=true (planejador determinístico)
 * - NÃO chama materializer LLM (Qwen3/Claude) — CP5 já valida que o
 *   prompt é construído corretamente. Aqui foca em planejador + executor
 *   em sequência multi-turn, que é onde nasce o COMPORTAMENTO pedagógico.
 *
 * Cobertura:
 * - Item 13: E2E multi-turn golden path + state persistence + decisões
 *            chainando via eventLog (turno N consome eventos de N-1)
 *
 * Tipo: Funcional
 *
 * Uso:
 *   npm run build --workspace shared && \
 *   npm run build --workspace motor-execucao && \
 *   npm run build --workspace planejador
 *   node scripts/smoke-func-tutor-e2e-v0.mjs
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
  const stateDir = await mkdtemp(path.join(tmpdir(), "smoke-func-tutor-e2e-"));
  process.env.MOTOR_STATE_DIR = stateDir;
  console.log(`[smoke-func] State dir: ${stateDir}\n`);

  const { planTurn } = await import("../planejador/dist/plan.js");
  const { executePlaybook } = await import("../motor-execucao/dist/executor.js");
  const { getState } = await import("../motor-execucao/dist/state-manager.js");

  console.log("[smoke-func] Tutor E2E — golden path explain → correct → recall → close\n");

  const persona = {
    id: "func-tutor-e2e",
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

  const sessionId = "func-tutor-e2e-session";

  async function planAndExec(contextHints) {
    const state = getState(sessionId);
    const planInput = { sessionId, persona, state };
    if (contextHints) planInput.contextHints = contextHints;
    const plan = await planTurn(planInput);
    const selectedContentId = plan.contentPool?.[0]?.item?.id;
    executePlaybook(
      {
        sessionId,
        playbookId: "p.smoke",
        output: "stub output",
        selectedContentId,
        metadata: {
          contextHints: plan.contextHints,
          userMessage: "",
          personaId: persona.id,
        },
      },
      inventory,
    );
    return plan;
  }

  // ─── T1: explain (default, fresh session) ──────────────────────────────
  console.log("[smoke-func] T1: turn fresh, sem sinais → explain");
  const plan1 = await planAndExec();
  const t1 = plan1.contextHints?.tutorial;
  assert(t1?.move_type === "explain", `T1: move_type=explain (got ${t1?.move_type})`);
  assert(t1?.advance_policy === "hold_until_attempted", "T1: advance_policy=hold_until_attempted");
  assert(t1?.failure_policy === undefined, "T1: sem failure_policy (intro)");
  assert(t1?.move_alternatives === undefined, "T1: sem alternatives (decisão unânime)");
  assert(typeof t1?.mastery_ref?.id === "string", "T1: mastery_ref ancorado no top scored item");

  // ─── T2: confusion → correct (cooldown bloqueia recall, sem alt) ──────
  console.log("\n[smoke-func] T2: confusion → correct; recall bloqueado por cooldown (v0.2.5)");
  const plan2 = await planAndExec({ extracted_signals: ["confusion"] });
  const t2 = plan2.contextHints?.tutorial;
  assert(t2?.move_type === "correct", `T2: move_type=correct (got ${t2?.move_type})`);
  assert(t2?.advance_policy === "hold_until_correct", "T2: advance_policy=hold_until_correct");
  assert(t2?.failure_policy === "simplify", "T2: failure_policy=simplify");
  // v0.2.5: cooldown de 2 turns bloqueia recall em T1/T2.
  // Como recall não é elegível, não aparece nem como alternative.
  const t2Alt = t2?.move_alternatives ?? [];
  assert(
    !t2Alt.some((a) => a.move_type === "recall"),
    `T2: recall AUSENTE de alternatives (cooldown ativo, state.turn=1 < 2) (got ${JSON.stringify(t2Alt.map((a) => a.move_type))})`,
  );

  // ─── T3: sem sinais → recall (eventLog tem T1+T2 playbook_executed) ────
  console.log("\n[smoke-func] T3: sem sinais → recall (eventLog tem playbook_executed prior)");
  const plan3 = await planAndExec();
  const t3 = plan3.contextHints?.tutorial;
  assert(t3?.move_type === "recall", `T3: move_type=recall (got ${t3?.move_type})`);
  assert(t3?.advance_policy === "can_move_on", "T3: advance_policy=can_move_on");
  assert(t3?.failure_policy === "re_explain", "T3: failure_policy=re_explain");
  assert(t3?.move_alternatives === undefined, "T3: sem alternatives (só recall satisfeito)");

  // ─── T4: exit_marker_explicit → close; recall em alt ───────────────────
  console.log("\n[smoke-func] T4: extracted_signals=[exit_marker_explicit] → close; recall em alt");
  const plan4 = await planAndExec({ extracted_signals: ["exit_marker_explicit"] });
  const t4 = plan4.contextHints?.tutorial;
  assert(t4?.move_type === "close", `T4: move_type=close (got ${t4?.move_type})`);
  assert(t4?.advance_policy === "can_move_on", "T4: advance_policy=can_move_on");
  const t4Alt = t4?.move_alternatives ?? [];
  assert(
    t4Alt.some((a) => a.move_type === "recall"),
    `T4: recall em alternatives (got ${JSON.stringify(t4Alt.map((a) => a.move_type))})`,
  );

  // ─── G_state: estado acumulado coerente ────────────────────────────────
  console.log("\n[smoke-func] G_state: estado acumulado coerente após 4 turns");
  const finalState = getState(sessionId);
  assert(finalState.turn === 4, `state.turn=4 (got ${finalState.turn})`);
  assert(finalState.budgetRemaining < 100, `budget consumido (got ${finalState.budgetRemaining})`);

  // ─── G_outcomes: 4 tutorial_outcome events na ordem esperada ───────────
  console.log("\n[smoke-func] G_outcomes: sequência [attempted, attempted, attempted, deferred]");
  // eventLog é DESC (newest first) — reverse pra ordem cronológica
  const outcomes = finalState.eventLog
    .filter((e) => e.type === "tutorial_outcome")
    .slice()
    .reverse();
  assert(outcomes.length === 4, `4 eventos tutorial_outcome (got ${outcomes.length})`);
  if (outcomes.length === 4) {
    const outcomeSeq = outcomes.map((e) => e.data.outcome);
    const moveSeq = outcomes.map((e) => e.data.move_type);
    assert(
      JSON.stringify(outcomeSeq) === JSON.stringify(["attempted", "attempted", "attempted", "deferred"]),
      `outcomes na ordem esperada (got ${JSON.stringify(outcomeSeq)})`,
    );
    assert(
      JSON.stringify(moveSeq) === JSON.stringify(["explain", "correct", "recall", "close"]),
      `move_types na ordem esperada (got ${JSON.stringify(moveSeq)})`,
    );
  }

  // ─── G_mastery_chain: mastery_ref muda conforme move_type evolui ───────
  console.log("\n[smoke-func] G_mastery_chain: mastery_ref evolui com a sessão");
  assert(
    typeof t3?.mastery_ref?.id === "string" && t3.mastery_ref.id.length > 0,
    "T3 mastery_ref presente",
  );
  // T3 é recall → mastery_ref.id deve apontar pro último playbook_executed
  // (lastExecutedId = T2's selectedContentId, que é o topItem que o
  // planejador escolheu em T2). Como o scorer rotaciona, T1.mastery_ref
  // (= T1's topItem) DEVE ser diferente de T3.mastery_ref (= T2's topItem).
  if (t1?.mastery_ref && t3?.mastery_ref) {
    assert(
      t1.mastery_ref.id !== t3.mastery_ref.id,
      `mastery_ref evolui ao longo da sessão (T1=${t1.mastery_ref.id} ≠ T3=${t3.mastery_ref.id})`,
    );
  }
  // T3.mastery_ref.id deve coincidir com o item escolhido em T2 (recall
  // aponta pro item recém-apresentado pra consolidar).
  const t2SelectedId = plan2.contentPool?.[0]?.item?.id;
  if (t3?.mastery_ref && t2SelectedId) {
    assert(
      t3.mastery_ref.id === t2SelectedId,
      `T3.mastery_ref.id === T2.selectedContentId (recall ancora no item recém-apresentado): T3=${t3.mastery_ref.id} vs T2.selected=${t2SelectedId}`,
    );
  }

  // ─── G_helix_integration: par Helix em contextHints quando ativo ───────
  console.log("\n[smoke-func] G_helix: integração Helix");
  // Helix não foi ativado nesta persona — sem kidsHelixState, não há par.
  // Persistência via spec: contextHints.helix_active_pair só presente
  // quando state.kidsHelixState existe.
  recordBypass(
    "persona sem kidsHelixState — Helix tie-break testado separadamente em smoke-infra-tutor-helix-v0",
  );

  console.log("");
  console.log(`[smoke-func] Total: ${pass} pass, ${fail} fail, ${bypass} bypass`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-func] FATAL:", err);
  process.exit(1);
});
