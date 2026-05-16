#!/usr/bin/env node
/**
 * Smoke E2E repetition_inquiry (ops#1068 v0.1 follow-up #4).
 *
 * Não usa orchestrator/MCP/LLM real — chama planTurn + executePlaybook
 * direto contra estado seeded em SQLite tmp DB. Cobre o loop completo:
 *
 *  G1 — Estado vazio: planTurn ainda NÃO ask (turn=0 < gate=4)
 *  G2 — Estado seeded com 3× playbook_executed pra "ling_inuit_snow" +
 *       turn=5 → planTurn SIM ask, contextHints.repetition_inquiry tem
 *       candidate_ids incluindo o item
 *  G3 — executePlaybook com contextHints.repetition_inquiry → loga _asked
 *  G4 — Próximo executePlaybook com userMessage="b" → loga _answered
 *       com choice=b, stage=literal
 *  G5 — Próximo executePlaybook com userMessage="tanto faz" pendente NOVO
 *       inquiry (cap=1 já consumido em sessão) → não cria nova pendência;
 *       fluxo deve permanecer estável
 *
 * Uso:
 *   npm run build && node scripts/smoke-repetition-inquiry.mjs
 *
 * Pré-req: USE_MOCK_LLM=true setado (script faz isso). MOTOR_STATE_DIR
 * temporário evita pollute do .motor-state.db default.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Mock LLM antes de importar planTurn (env var detection)
process.env.USE_MOCK_LLM = "true";
process.env.ASC_DEBUG_MODE = "false"; // sem NDJSON pra reduzir noise

let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    pass++;
  } else {
    console.log(`  ✗ ${msg}`);
    fail++;
  }
}

async function main() {
  // tmp state dir → isola SQLite da run
  const stateDir = await mkdtemp(path.join(tmpdir(), "smoke-inquiry-"));
  process.env.MOTOR_STATE_DIR = stateDir;
  console.log(`[smoke] State dir: ${stateDir}`);

  // Importa AFTER env vars setados
  const { planTurn } = await import("../planejador/dist/plan.js");
  const { executePlaybook } = await import("../motor-execucao/dist/executor.js");
  const { getState, logEvent } = await import("../motor-execucao/dist/state-manager.js");

  // Inventory mock pra executePlaybook
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

  // Persona pra planTurn — usa Kei (defaults universais p/ inquiry)
  const persona = {
    id: "kei-ochiai",
    name: "Kei",
    age: 9,
    profile: { repetition_inquiry: {} }, // defaults
  };

  // Helper pra montar PlanTurnInput
  function buildPlanInput(sessionId, extras = {}) {
    const state = getState(sessionId);
    return {
      sessionId,
      persona,
      state: {
        ...state,
        ...extras,
      },
    };
  }

  // ─── G1 ─────────────────────────────────────────────────────────────────
  console.log("[smoke] G1: sessão nova, turn=0 → NÃO ask (gate=4)");
  const sessG1 = `smoke-g1-${Date.now()}`;
  const planG1 = await planTurn(buildPlanInput(sessG1));
  assert(
    planG1.contextHints.repetition_inquiry === undefined,
    "contextHints.repetition_inquiry ausente",
  );
  assert(
    planG1.contextHints.repetition_inquiry_suppressed === "turn_too_early",
    `suppressed_reason=turn_too_early (got: ${planG1.contextHints.repetition_inquiry_suppressed})`,
  );

  // ─── G2 ─────────────────────────────────────────────────────────────────
  console.log("[smoke] G2: turn=5 + 3× playbook_executed pra 'ling_inuit_snow' → SIM ask");
  const sessG2 = `smoke-g2-${Date.now()}`;
  // Inicializa estado
  getState(sessG2);
  // Seeda 3 events de playbook_executed pro mesmo content
  for (let i = 0; i < 3; i++) {
    logEvent(sessG2, {
      timestamp: new Date(Date.now() - (3 - i) * 60_000).toISOString(),
      type: "playbook_executed",
      playbookId: "p.smoke",
      data: { selectedContentId: "ling_inuit_snow" },
    });
  }
  // Atualiza turn → simula 5 turns passados
  const planG2 = await planTurn(buildPlanInput(sessG2, { turn: 5 }));
  const inquiryG2 = planG2.contextHints.repetition_inquiry;
  assert(inquiryG2 !== undefined, "contextHints.repetition_inquiry presente");
  if (inquiryG2) {
    assert(
      Array.isArray(inquiryG2.candidate_ids) && inquiryG2.candidate_ids.includes("ling_inuit_snow"),
      `candidate_ids contém 'ling_inuit_snow' (got: ${JSON.stringify(inquiryG2.candidate_ids)})`,
    );
    assert(inquiryG2.threshold_used === 2, `threshold_used=2 (got: ${inquiryG2.threshold_used})`);
    assert(inquiryG2.default_on_skip === "b", `default_on_skip=b (got: ${inquiryG2.default_on_skip})`);
  }

  // ─── G3 ─────────────────────────────────────────────────────────────────
  console.log("[smoke] G3: executePlaybook com contextHints.repetition_inquiry → loga _asked");
  executePlaybook(
    {
      sessionId: sessG2,
      playbookId: "p.smoke",
      output: "Quer (a), (b), ou (c)?",
      metadata: { contextHints: planG2.contextHints, userMessage: "" },
    },
    inventory,
  );
  const stateG3 = getState(sessG2);
  const askedEvents = stateG3.eventLog.filter((e) => e.type === "repetition_inquiry_asked");
  assert(askedEvents.length === 1, `1 _asked event logged (got: ${askedEvents.length})`);
  if (askedEvents.length > 0) {
    const data = askedEvents[0].data;
    assert(
      Array.isArray(data.candidate_ids) && data.candidate_ids.includes("ling_inuit_snow"),
      "_asked.data.candidate_ids persistido",
    );
    assert(data.default_on_skip === "b", `_asked.data.default_on_skip='b' (got: ${data.default_on_skip})`);
  }

  // ─── G4 ─────────────────────────────────────────────────────────────────
  console.log("[smoke] G4: próximo executePlaybook com userMessage='b' → loga _answered choice=b");
  executePlaybook(
    {
      sessionId: sessG2,
      playbookId: "p.smoke",
      output: "ok, vamos pra um parecido",
      metadata: { userMessage: "b" },
    },
    inventory,
  );
  const stateG4 = getState(sessG2);
  const answeredEvents = stateG4.eventLog.filter((e) => e.type === "repetition_inquiry_answered");
  assert(answeredEvents.length === 1, `1 _answered event logged (got: ${answeredEvents.length})`);
  if (answeredEvents.length > 0) {
    const data = answeredEvents[0].data;
    assert(data.choice === "b", `_answered.data.choice='b' (got: ${data.choice})`);
    assert(data.stage === "literal", `_answered.data.stage='literal' (got: ${data.stage})`);
    assert(data.confidence === 1, `_answered.data.confidence=1 (got: ${data.confidence})`);
  }

  // ─── G5 ─────────────────────────────────────────────────────────────────
  console.log("[smoke] G5: planTurn re-rodado após _answered → cap_reached (não ask de novo)");
  // Loga mais 2 events de mesmo content pra manter o threshold OK
  for (let i = 0; i < 2; i++) {
    logEvent(sessG2, {
      timestamp: new Date().toISOString(),
      type: "playbook_executed",
      playbookId: "p.smoke",
      data: { selectedContentId: "ling_inuit_snow" },
    });
  }
  const planG5 = await planTurn(buildPlanInput(sessG2, { turn: 7 }));
  assert(
    planG5.contextHints.repetition_inquiry === undefined,
    "contextHints.repetition_inquiry ausente (cap atingido)",
  );
  assert(
    planG5.contextHints.repetition_inquiry_suppressed === "cap_reached",
    `suppressed_reason=cap_reached (got: ${planG5.contextHints.repetition_inquiry_suppressed})`,
  );

  console.log("");
  console.log(`[smoke] Total: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke] FATAL:", err);
  process.exit(1);
});
