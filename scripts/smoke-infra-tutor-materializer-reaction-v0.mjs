#!/usr/bin/env node
/**
 * Smoke INFRA — Tutor Clássico v0 (Lote 2 - CP5 - Item 8)
 *
 * Valida que o materializer REAGE ao `move_type` do contrato tutorial.
 *
 * Estratégia (decisão "C" — híbrido):
 * - planejador compõe linha "MOVIMENTO: <verbo>." em `instruction_addition`
 * - materializer (buildDrotaPrompt) já consome `instruction_addition`
 *   e renderiza dentro de <instruction_addition>...</instruction_addition>
 * - cada `move_type` produz marker distinto e detectável no prompt
 *
 * Cobertura:
 * - Item 8: materializer altera prompt conforme move_type, sem invalidar
 *   prefix caching (template estável + linha móvel no instruction_addition)
 *
 * Tipo: Infra
 *
 * Uso:
 *   npm run build --workspace shared && \
 *   npm run build --workspace motor-execucao && \
 *   npm run build --workspace planejador && \
 *   npm run build --workspace motor-drota
 *   node scripts/smoke-infra-tutor-materializer-reaction-v0.mjs
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
  const stateDir = await mkdtemp(path.join(tmpdir(), "smoke-infra-tutor-mat-reaction-"));
  process.env.MOTOR_STATE_DIR = stateDir;
  console.log(`[smoke-infra] State dir: ${stateDir}\n`);

  const { planTurn } = await import("../planejador/dist/plan.js");
  const { getState, logEvent } = await import("../motor-execucao/dist/state-manager.js");
  const { buildDrotaPrompt } = await import("../motor-drota/dist/server.js");

  console.log("[smoke-infra] Tutor materializer reaction — move_type altera prompt do materializer\n");

  const persona = {
    id: "infra-tutor-mat-reaction",
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

  function callMaterializer(plan) {
    const drotaInput = {
      persona,
      state: { sessionId: "mr", trustLevel: 0.4, budgetRemaining: 85, turn: 4 },
      contentPool: plan.contentPool,
      contextHints: plan.contextHints,
      strategicRationale: plan.strategicRationale,
      instruction_addition: plan.instruction_addition ?? "",
    };
    return buildDrotaPrompt(drotaInput, plan.contentPool?.[0] ?? null);
  }

  // ─── G1: explain (default) ──────────────────────────────────────────────
  console.log("[smoke-infra] G1: default (sem sinais) → move_type=explain → marker 'MOVIMENTO: explicar'");
  const planE = await planTurn(buildPlanInput("mr-explain", { turn: 4 }));
  assert(planE.contextHints?.tutorial?.move_type === "explain", "move_type=explain");
  assert(
    typeof planE.instruction_addition === "string" && planE.instruction_addition.includes("MOVIMENTO: explicar"),
    "instruction_addition contém 'MOVIMENTO: explicar'",
  );
  const promptE = callMaterializer(planE);
  assert(promptE.includes("MOVIMENTO: explicar"), "prompt do materializer contém 'MOVIMENTO: explicar'");

  // ─── G2: correct (confusion signal) ─────────────────────────────────────
  console.log("\n[smoke-infra] G2: confusion → move_type=correct → marker 'MOVIMENTO: corrigir'");
  const planC = await planTurn(
    buildPlanInput("mr-correct", { turn: 4, contextHints: { extracted_signals: ["confusion"] } }),
  );
  assert(planC.contextHints?.tutorial?.move_type === "correct", "move_type=correct");
  assert(
    planC.instruction_addition.includes("MOVIMENTO: corrigir"),
    "instruction_addition contém 'MOVIMENTO: corrigir'",
  );
  const promptC = callMaterializer(planC);
  assert(promptC.includes("MOVIMENTO: corrigir"), "prompt contém 'MOVIMENTO: corrigir'");
  assert(!promptC.includes("MOVIMENTO: explicar"), "prompt NÃO contém marker de explicar (não vaza)");

  // ─── G3: recall (eventLog seeded) ───────────────────────────────────────
  console.log("\n[smoke-infra] G3: eventLog seeded → move_type=recall → marker 'MOVIMENTO: retomar'");
  const sessR = "mr-recall";
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
    assert(planR.contextHints?.tutorial?.move_type === "recall", "move_type=recall");
    assert(
      planR.instruction_addition.includes("MOVIMENTO: retomar"),
      "instruction_addition contém 'MOVIMENTO: retomar'",
    );
    const promptR = callMaterializer(planR);
    assert(promptR.includes("MOVIMENTO: retomar"), "prompt contém 'MOVIMENTO: retomar'");
  } else {
    recordBypass("seedId indisponível — não pude validar marker de recall no prompt");
  }

  // ─── G4: close (exit signal) ────────────────────────────────────────────
  console.log("\n[smoke-infra] G4: exit_marker_explicit → move_type=close → marker 'MOVIMENTO: fechar'");
  const planX = await planTurn(
    buildPlanInput("mr-close", {
      turn: 4,
      contextHints: { extracted_signals: ["exit_marker_explicit"] },
    }),
  );
  assert(planX.contextHints?.tutorial?.move_type === "close", "move_type=close");
  assert(
    planX.instruction_addition.includes("MOVIMENTO: fechar"),
    "instruction_addition contém 'MOVIMENTO: fechar'",
  );
  const promptX = callMaterializer(planX);
  assert(promptX.includes("MOVIMENTO: fechar"), "prompt contém 'MOVIMENTO: fechar'");

  // ─── G5: prefix caching preservado (linha entra DEPOIS do prefixo estável) ─
  console.log("\n[smoke-infra] G5: prefix do prompt estável entre move_types diferentes");
  // Verifica que mudanças por move_type ficam DEPOIS do header do prompt
  // (linhas de persona/tom no topo são iguais entre planes diferentes).
  const headerE = promptE.split("\n").slice(0, 5).join("\n");
  const headerC = promptC.split("\n").slice(0, 5).join("\n");
  const headerX = promptX.split("\n").slice(0, 5).join("\n");
  assert(headerE === headerC, "primeiras 5 linhas do prompt iguais entre explain e correct (cache-friendly)");
  assert(headerE === headerX, "primeiras 5 linhas do prompt iguais entre explain e close (cache-friendly)");

  // ─── G6: check/apply diferidos pra v0.3 ──────────────────────────────────
  console.log("\n[smoke-infra] G6: check/apply diferidos (v0.3)");
  recordBypass("planejador v0.2 ainda não emite check/apply — marker correspondente não testável");

  // ─── G_inaugural: state.turn=0 + discovery_only → MOVIMENTO INAUGURAL (v0.2.7) ─
  console.log("\n[smoke-infra] G_inaugural: turn=0 + journey_stage=discovery_only → MOVIMENTO INAUGURAL");
  const planInaug = await planTurn(
    buildPlanInput("mr-inaugural", {
      turn: 0,
      contextHints: { journey_stage: "discovery_only" },
    }),
  );
  const tInaug = planInaug.contextHints?.tutorial;
  assert(tInaug?.move_type === "discover", "inaugural emite move_type=discover");
  assert(
    typeof planInaug.instruction_addition === "string" &&
      planInaug.instruction_addition.includes("MOVIMENTO INAUGURAL"),
    "instruction_addition contém 'MOVIMENTO INAUGURAL' (template de auto-apresentação)",
  );
  assert(
    planInaug.instruction_addition.includes("baralho") &&
      planInaug.instruction_addition.includes("4 virtudes"),
    "template menciona baralho com 4 virtudes (artefato concreto)",
  );
  assert(
    planInaug.instruction_addition.includes("Sou um tutor"),
    "template declara identidade de tutor explicitamente",
  );
  const inaugLower = (planInaug.instruction_addition ?? "").toLowerCase();
  assert(
    inaugLower.includes("se você não curtir") ||
      inaugLower.includes("se for chato") ||
      inaugLower.includes("se não rolar"),
    "template inclui consent gate explícito",
  );

  // ─── G_inaugural_turn1: T1 normal NÃO emite MOVIMENTO INAUGURAL ─────────
  console.log("\n[smoke-infra] G_inaugural_turn1: state.turn=1 + discover NÃO usa template inaugural");
  const planT1 = await planTurn(
    buildPlanInput("mr-t1-discover", {
      turn: 1,
      contextHints: { journey_stage: "discovery_only" },
    }),
  );
  assert(planT1.contextHints?.tutorial?.move_type === "discover", "T1: ainda discover (cooldown N/A, gate ativo)");
  assert(
    !planT1.instruction_addition.includes("MOVIMENTO INAUGURAL"),
    "T1 NÃO usa template inaugural (apenas turn=0 usa)",
  );
  assert(
    planT1.instruction_addition.includes("MOVIMENTO: descobrir"),
    "T1 usa MOVIMENTO: descobrir genérico",
  );

  // ─── G7: instruction_addition preserva Gardner injection (se ativo) ─────
  console.log("\n[smoke-infra] G7: instruction_addition aditivo (não destrói outras injeções)");
  // Sem Gardner ativo nesse persona, a linha tutorial é a única.
  // Validamos que o formato segue compactação correta: 1 linha começando em MOVIMENTO.
  const trimmed = planE.instruction_addition.trim();
  assert(trimmed.startsWith("MOVIMENTO:"), "instruction_addition começa com MOVIMENTO quando só há linha tutorial");
  assert(trimmed.split("\n").length <= 2, "instruction_addition é compacto (≤ 2 linhas sem Gardner)");

  console.log("");
  console.log(`[smoke-infra] Total: ${pass} pass, ${fail} fail, ${bypass} bypass`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-infra] FATAL:", err);
  process.exit(1);
});
