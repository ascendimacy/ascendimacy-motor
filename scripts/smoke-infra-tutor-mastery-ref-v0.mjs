#!/usr/bin/env node
/**
 * Smoke INFRA — Tutor Clássico v0 (Lote 1 - CP3 - Item 5)
 *
 * Valida que o contrato tutorial carrega `mastery_ref` quando o
 * planejador escolheu um top scored item — ancoragem mínima do
 * "sobre o que esta jogada é".
 *
 * Estratégia v0.1:
 * - `mastery_ref` é populado com `kind: "item"` + `id` do topK[0].item
 * - Ausente quando topK está vazio (campo é opcional no contrato)
 *
 * Cobertura:
 * - Item 5: mastery_ref ancorado no top scored item + shape válido
 *
 * Tipo: Infra
 *
 * Uso:
 *   npm run build --workspace shared && \
 *   npm run build --workspace motor-execucao && \
 *   npm run build --workspace planejador
 *   node scripts/smoke-infra-tutor-mastery-ref-v0.mjs
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
  const stateDir = await mkdtemp(path.join(tmpdir(), "smoke-infra-tutor-mastery-"));
  process.env.MOTOR_STATE_DIR = stateDir;
  console.log(`[smoke-infra] State dir: ${stateDir}\n`);

  const { planTurn } = await import("../planejador/dist/plan.js");
  const { getState } = await import("../motor-execucao/dist/state-manager.js");

  console.log("[smoke-infra] Tutor mastery_ref — ancoragem no top scored item\n");

  const persona = {
    id: "infra-tutor-mastery",
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

  // ─── G1: mastery_ref presente quando há topK ───────────────────────────
  console.log("[smoke-infra] G1: mastery_ref populado quando topK é não-vazio");
  const plan = await planTurn(buildPlanInput("mastery-g1", { turn: 4 }));
  const tutorial = plan.contextHints?.tutorial;
  const topItemId = plan.contentPool?.[0]?.item?.id;

  assert(tutorial !== undefined, "contextHints.tutorial presente");
  assert(Array.isArray(plan.contentPool), "contentPool é array");

  if (typeof topItemId === "string" && topItemId.length > 0) {
    assert(
      tutorial?.mastery_ref !== undefined,
      "mastery_ref presente quando topK[0] existe",
    );
    if (tutorial?.mastery_ref) {
      assert(tutorial.mastery_ref.kind === "item", "mastery_ref.kind === 'item'");
      assert(typeof tutorial.mastery_ref.id === "string", "mastery_ref.id é string");
      assert(
        tutorial.mastery_ref.id === topItemId,
        `mastery_ref.id === contentPool[0].item.id (got: ${tutorial.mastery_ref.id} vs ${topItemId})`,
      );
    }
  } else {
    recordBypass("topK[0] indisponível neste run — não foi possível validar mastery_ref preenchido");
  }

  // ─── G2: shape JSON-serializável (trace-ready) ──────────────────────────
  console.log("\n[smoke-infra] G2: mastery_ref é JSON-serializável (trace-ready)");
  if (tutorial?.mastery_ref) {
    let roundtrip;
    try {
      roundtrip = JSON.parse(JSON.stringify(tutorial.mastery_ref));
      assert(true, "JSON round-trip sem erro");
    } catch (err) {
      assert(false, `serialização falhou: ${err.message}`);
    }
    if (roundtrip) {
      assert(roundtrip.kind === tutorial.mastery_ref.kind, "kind preservado no round-trip");
      assert(roundtrip.id === tutorial.mastery_ref.id, "id preservado no round-trip");
    }
  } else {
    recordBypass("mastery_ref ausente neste run — não foi possível validar serialização");
  }

  // ─── G3: estabilidade entre turns (mastery_ref pode variar mas shape é estável) ─
  console.log("\n[smoke-infra] G3: shape de mastery_ref estável entre turns");
  const plan2 = await planTurn(buildPlanInput("mastery-g2", { turn: 7 }));
  const tutorial2 = plan2.contextHints?.tutorial;
  if (tutorial2?.mastery_ref) {
    assert(
      tutorial2.mastery_ref.kind === "item",
      "turn 7: mastery_ref.kind continua 'item'",
    );
    assert(typeof tutorial2.mastery_ref.id === "string", "turn 7: mastery_ref.id continua string");
  } else if (Array.isArray(plan2.contentPool) && plan2.contentPool.length > 0) {
    assert(false, "turn 7: mastery_ref deveria estar presente (contentPool não-vazio)");
  } else {
    recordBypass("turn 7: contentPool vazio — caso degradado tolerado");
  }

  // ─── G4: kind="concept"/"axis" não emitidos em v0.1 ─────────────────────
  console.log("\n[smoke-infra] G4: ancoragem semântica (kind='concept'/'axis')");
  recordBypass(
    "v0.1 só emite kind='item' — kind='concept'/'axis' depende de semântica downstream (Lote 2)",
  );

  console.log("");
  console.log(`[smoke-infra] Total: ${pass} pass, ${fail} fail, ${bypass} bypass`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-infra] FATAL:", err);
  process.exit(1);
});
