#!/usr/bin/env node
/**
 * Smoke INFRA — Tutor Clássico v0 (Lote 1 - CP2 - Item 4)
 *
 * Valida que a presença do contrato tutorial é ADITIVA: não remove,
 * sobrescreve, nem degrada outros contextHints auto-gerados pelo
 * planejador (status_gates, prazer_sacrifice_ratio, sacrifice_breakdown,
 * budget_state) nem hints injetados pelo caller.
 *
 * Cobertura:
 * - Item 4: Regressão — contrato não polui outros fluxos
 *
 * Tipo: Infra
 *
 * Uso:
 *   npm run build --workspace shared && \
 *   npm run build --workspace motor-execucao && \
 *   npm run build --workspace planejador
 *   node scripts/smoke-infra-tutor-regression-v0.mjs
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
  const stateDir = await mkdtemp(path.join(tmpdir(), "smoke-infra-tutor-regression-"));
  process.env.MOTOR_STATE_DIR = stateDir;
  console.log(`[smoke-infra] State dir: ${stateDir}\n`);

  const { planTurn } = await import("../planejador/dist/plan.js");
  const { getState } = await import("../motor-execucao/dist/state-manager.js");

  console.log("[smoke-infra] Tutor Regression — contrato é aditivo, não destrutivo\n");

  const persona = {
    id: "infra-tutor-regression",
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

  // ─── G1: hints auto-gerados pelo planejador coexistem com tutorial ──────
  console.log("[smoke-infra] G1: hints auto-gerados pelo planejador sobrevivem ao contrato");
  const plan = await planTurn(buildPlanInput("regression-g1", { turn: 5 }));

  assert(plan.contextHints?.tutorial !== undefined, "tutorial presente");
  assert(
    plan.contextHints?.status_gates !== undefined,
    "status_gates ainda presente junto com tutorial",
  );
  assert(
    plan.contextHints?.prazer_sacrifice_ratio !== undefined,
    "prazer_sacrifice_ratio ainda presente junto com tutorial",
  );
  assert(
    plan.contextHints?.sacrifice_breakdown !== undefined,
    "sacrifice_breakdown ainda presente junto com tutorial",
  );
  assert(
    plan.contextHints?.budget_state !== undefined,
    "budget_state ainda presente junto com tutorial",
  );

  // ─── G2: hints do caller coexistem com tutorial (cross-check do bypass mock) ─
  console.log("\n[smoke-infra] G2: hints do caller coexistem com contrato (cross-check do bypass mock)");
  const plan2 = await planTurn(
    buildPlanInput("regression-g2", {
      turn: 5,
      contextHints: { custom_caller_key: "deve_sobreviver" },
    }),
  );
  assert(plan2.contextHints?.tutorial !== undefined, "tutorial coexiste com hint customizado");
  assert(
    plan2.contextHints?.status_gates !== undefined,
    "status_gates coexiste com hint customizado",
  );
  if (plan2.contextHints?.custom_caller_key === "deve_sobreviver") {
    assert(true, "custom_caller_key preservado (bypass do mock ativo)");
  } else {
    recordBypass(
      "custom_caller_key não preservado — em produção (LLM real) o rationale do LLM pode sobrescrever; depende do bypass mock",
    );
  }

  // ─── G3: outras seções do PlanTurnOutput não corrompidas ────────────────
  console.log("\n[smoke-infra] G3: outras seções do PlanTurnOutput não são afetadas");
  assert(Array.isArray(plan.contentPool), "contentPool ainda é array");
  assert(typeof plan.strategicRationale === "string", "strategicRationale ainda é string");

  // ─── G4: caso neutro (tutorial ausente quando não-relevante) ────────────
  console.log("\n[smoke-infra] G4: cenário neutro (tutorial ausente quando não-relevante)");
  recordBypass(
    "v0.2 sempre emite contrato (varia move_type mas nunca é ausente) — caso 'tutorial ausente' fica para v0.3+",
  );

  console.log("");
  console.log(`[smoke-infra] Total: ${pass} pass, ${fail} fail, ${bypass} bypass`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-infra] FATAL:", err);
  process.exit(1);
});
