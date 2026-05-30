#!/usr/bin/env node
/**
 * Smoke INFRA — Tutor Clássico v0.2.8 (Discovery-Specific Pool)
 *
 * Valida que quando `move_type=discover`, o planejador chama o
 * Discovery Agent e injeta `contextHints.discovery_options`.
 *
 * Em USE_MOCK_LLM=true, discovery-agent retorna fallback determinístico
 * de 5 opções. Smoke valida shape + presença + content.
 *
 * Tipo: Infra
 *
 * Uso:
 *   npm run build --workspace shared && \
 *   npm run build --workspace motor-execucao && \
 *   npm run build --workspace planejador
 *   node scripts/smoke-infra-tutor-discovery-pool-v0.mjs
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
  if (cond) { console.log(`  ✓ ${msg}`); pass++; }
  else { console.log(`  ✗ ${msg}`); fail++; }
}

function recordBypass(msg) {
  console.log(`  ○ ${msg} (bypass)`);
  bypass++;
}

async function main() {
  const stateDir = await mkdtemp(path.join(tmpdir(), "smoke-infra-tutor-disc-"));
  process.env.MOTOR_STATE_DIR = stateDir;
  console.log(`[smoke-infra] State dir: ${stateDir}\n`);

  const { planTurn } = await import("../planejador/dist/plan.js");
  const { getState } = await import("../motor-execucao/dist/state-manager.js");

  console.log("[smoke-infra] Tutor Discovery Pool — discovery_options injetados quando discover (v0.2.8)\n");

  const persona = {
    id: "infra-tutor-disc",
    name: "Test",
    age: 12,
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

  // ─── G1: discover stage → discovery_options injetadas ──────────────────
  console.log("[smoke-infra] G1: journey_stage=discovery_only → discovery_options em contextHints");
  const planDisc = await planTurn(
    buildPlanInput("disc-g1", {
      turn: 4,
      contextHints: { journey_stage: "discovery_only" },
    }),
  );
  assert(planDisc.contextHints?.tutorial?.move_type === "discover", "move_type=discover");
  const opts = planDisc.contextHints?.discovery_options;
  assert(Array.isArray(opts), "discovery_options é array");
  assert(opts?.length >= 3, `discovery_options >= 3 opções (got ${opts?.length})`);

  // ─── G2: shape de cada opção ───────────────────────────────────────────
  console.log("\n[smoke-infra] G2: shape de cada opção (kind + text + anchor)");
  if (Array.isArray(opts) && opts.length > 0) {
    const sample = opts[0];
    assert(typeof sample.kind === "string", "opt.kind é string");
    assert(typeof sample.text === "string" && sample.text.length > 0, "opt.text é string não-vazia");
    assert(typeof sample.anchor === "string", "opt.anchor é string");
    const kinds = new Set(opts.map((o) => o.kind));
    assert(kinds.size >= 3, `variedade de kinds (got ${[...kinds].join(",")})`);
  }

  // ─── G3: NÃO emite quando move_type !== discover ────────────────────────
  console.log("\n[smoke-infra] G3: move_type=explain → discovery_options AUSENTE");
  const planExplain = await planTurn(buildPlanInput("disc-g3", { turn: 4 }));
  assert(planExplain.contextHints?.tutorial?.move_type === "explain", "move_type=explain");
  assert(
    planExplain.contextHints?.discovery_options === undefined,
    "discovery_options NÃO emitido em explain",
  );

  // ─── G4: JSON-serializável (trace-ready) ───────────────────────────────
  console.log("\n[smoke-infra] G4: discovery_options é JSON-serializável");
  if (Array.isArray(opts)) {
    try {
      const round = JSON.parse(JSON.stringify(opts));
      assert(Array.isArray(round) && round.length === opts.length, "round-trip preserva length");
      assert(round[0]?.kind === opts[0]?.kind, "kind preservado");
      assert(round[0]?.text === opts[0]?.text, "text preservado");
    } catch (err) {
      assert(false, `serialização falhou: ${err.message}`);
    }
  }

  // ─── G5: LLM real não exercitado em smoke ──────────────────────────────
  console.log("\n[smoke-infra] G5: LLM real (Qwen/Claude) — validar via STS");
  recordBypass(
    "USE_MOCK_LLM=true usa fallback determinístico de 5 opções; LLM real validado em STS smoke",
  );

  console.log("");
  console.log(`[smoke-infra] Total: ${pass} pass, ${fail} fail, ${bypass} bypass`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-infra] FATAL:", err);
  process.exit(1);
});
