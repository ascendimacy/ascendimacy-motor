#!/usr/bin/env node
/**
 * Smoke E2E repetition_inquiry com Qwen3 LOCAL (ops#1068 follow-up #4 + LLM real).
 *
 * Mostra o protocolo inteiro com LLM real:
 *  1. planTurn (USE_MOCK_LLM=true → mock rationale + REAL contextHints.repetition_inquiry)
 *  2. drota — buildDrotaPrompt() + chamada DIRETA a Qwen3 (padrão measure-menu-variance,
 *     bypass do llm-gateway que não roteia openai-compat)
 *  3. parseDrotaOutput → linguisticMaterialization (a pergunta real do drota)
 *  4. executePlaybook com contextHints → _asked logged
 *  5. Próximo executePlaybook com userMessage="b" → _answered logged choice=b
 *
 * Pré-req:
 *   - Qwen3 stack up em LLM_LOCAL_ENDPOINT (default http://172.28.160.1:9000)
 *   - Build atual: npm run build
 *
 * Uso:
 *   node scripts/smoke-inquiry-llm.mjs
 *   LLM_LOCAL_ENDPOINT=http://outro:porta/v1/chat/completions node scripts/...
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Agent, setGlobalDispatcher } from "undici";

// undici default headersTimeout=300s; Qwen3 30B com prompt grande
// pode demorar +5min até primeira resposta. Bump global.
setGlobalDispatcher(
  new Agent({ headersTimeout: 2_400_000, bodyTimeout: 2_400_000 }),
);

// USE_MOCK_LLM=true só pra planejador (que vai mockar rationale).
// Drota vai usar direct fetch a Qwen3 — não passa pelo llm-client.
process.env.USE_MOCK_LLM = "true";
process.env.ASC_DEBUG_MODE = "false";

const ENDPOINT =
  process.env.LLM_LOCAL_ENDPOINT ??
  "http://172.28.160.1:9000/v1/chat/completions";
const MODEL = process.env.LLM_LOCAL_MODEL ?? "qwen3-30b";

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

async function callQwen3(systemPrompt, userMessage) {
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    max_tokens: 600, // drota output é JSON pequeno (~200-400 tokens)
    temperature: 0.7,
  };
  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2_400_000), // 10min — prompt processing + gen pode passar 5min
  });
  if (!resp.ok) throw new Error(`Qwen3 HTTP ${resp.status}: ${await resp.text()}`);
  const json = await resp.json();
  return {
    content: json.choices[0].message.content,
    tokens: {
      in: json.usage?.prompt_tokens ?? 0,
      out: json.usage?.completion_tokens ?? 0,
    },
  };
}

async function probeQwen3() {
  const probe = ENDPOINT.replace("/chat/completions", "/models");
  console.log(`[smoke] Probing ${probe}...`);
  try {
    const r = await fetch(probe, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    console.log(`  ✓ Qwen3 up (models: ${(j.models ?? j.data ?? []).map((m) => m.name ?? m.id).join(", ")})`);
  } catch (err) {
    throw new Error(`Qwen3 offline em ${probe}: ${err.message}\nStart llama.cpp SYCL stack first (llama-qwen3-30b.bat no Windows).`);
  }
}

async function main() {
  await probeQwen3();

  const stateDir = await mkdtemp(path.join(tmpdir(), "smoke-inq-llm-"));
  process.env.MOTOR_STATE_DIR = stateDir;
  console.log(`[smoke] State dir: ${stateDir}\n`);

  // Imports após env vars
  const { planTurn } = await import("../planejador/dist/plan.js");
  const { executePlaybook } = await import("../motor-execucao/dist/executor.js");
  const { getState, logEvent } = await import("../motor-execucao/dist/state-manager.js");
  const { buildDrotaPrompt } = await import("../motor-drota/dist/server.js");
  const { parseDrotaOutput } = await import("../motor-drota/dist/parse-output.js");
  const { rankPool } = await import("../motor-drota/dist/evaluate.js");
  const { selectFromPool } = await import("../motor-drota/dist/select.js");

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

  const persona = {
    id: "kei-ochiai",
    name: "Kei",
    age: 9,
    profile: { repetition_inquiry: {} }, // defaults
  };

  function buildPlanInput(sessionId, extras = {}) {
    const state = getState(sessionId);
    return {
      sessionId,
      persona,
      state: { ...state, ...extras },
    };
  }

  // ─── Seed state pra forçar inquiry trigger ───────────────────────────────
  console.log("[smoke] Seeding session com 3× playbook_executed pra 'ling_inuit_snow'...");
  const sessionId = `smoke-llm-${Date.now()}`;
  getState(sessionId); // init
  for (let i = 0; i < 3; i++) {
    logEvent(sessionId, {
      timestamp: new Date(Date.now() - (3 - i) * 60_000).toISOString(),
      type: "playbook_executed",
      playbookId: "p.smoke",
      data: { selectedContentId: "ling_inuit_snow" },
    });
  }

  // ─── planTurn ────────────────────────────────────────────────────────────
  console.log("\n[smoke] Turn 1 — planTurn (mock LLM rationale + REAL inquiry decision)");
  const plan = await planTurn(buildPlanInput(sessionId, { turn: 5 }));
  const inquiry = plan.contextHints.repetition_inquiry;
  assert(inquiry !== undefined, "contextHints.repetition_inquiry presente");
  if (inquiry) {
    assert(
      inquiry.candidate_ids?.includes("ling_inuit_snow"),
      `candidate_ids inclui 'ling_inuit_snow' (got: ${JSON.stringify(inquiry.candidate_ids)})`,
    );
  }

  // ─── drota REAL com Qwen3 ────────────────────────────────────────────────
  console.log("\n[smoke] Turn 1 — drota composition com Qwen3 (sem mock)");
  const ranked = rankPool(plan.contentPool);
  assert(ranked.length > 0, `pool tem items rankeáveis (got: ${ranked.length})`);
  const { selected } = selectFromPool(ranked, { ...getState(sessionId), turn: 5 });
  const drotaInput = {
    persona,
    state: { sessionId, trustLevel: 0.3, budgetRemaining: 90, turn: 5 },
    contentPool: plan.contentPool,
    contextHints: plan.contextHints,
    strategicRationale: plan.strategicRationale,
    instruction_addition: plan.instruction_addition ?? "",
  };
  const drotaPrompt = buildDrotaPrompt(drotaInput, selected);
  console.log(`  [info] prompt length=${drotaPrompt.length} chars, calling Qwen3...`);
  const t0 = Date.now();
  const qwenResp = await callQwen3(drotaPrompt, "Materialize o content selecionado em JSON.");
  const dt = Date.now() - t0;
  console.log(`  [info] Qwen3 returned in ${dt}ms (in=${qwenResp.tokens.in}, out=${qwenResp.tokens.out})`);

  const parsed = parseDrotaOutput(qwenResp.content);
  assert(parsed.parsed.linguisticMaterialization !== undefined, "Qwen3 produziu JSON parseável");
  assert(
    !parsed.skipReason,
    `parse sem skipReason (got: ${parsed.skipReason ?? "ok"})`,
  );
  if (parsed.parsed.linguisticMaterialization) {
    console.log(`\n  ┌──── DROTA OUTPUT (Qwen3) ────`);
    console.log(`  │ ${parsed.parsed.linguisticMaterialization.split("\n").join("\n  │ ")}`);
    console.log(`  └─────────────────────────────`);
  }

  // Validação semântica leve — drota deve oferecer escolha (a/b/c) ou similar
  const mat = (parsed.parsed.linguisticMaterialization ?? "").toLowerCase();
  const hasChoiceMarker =
    mat.includes("(a)") ||
    mat.includes("a)") ||
    mat.includes("parecid") ||
    mat.includes("de novo") ||
    mat.includes("outra coisa") ||
    mat.includes("novo");
  assert(hasChoiceMarker, "drota output contém marker de escolha (a/b/c ou linguagem natural)");

  // ─── executePlaybook → loga _asked ───────────────────────────────────────
  console.log("\n[smoke] Turn 1 — executePlaybook → loga _asked");
  executePlaybook(
    {
      sessionId,
      playbookId: "p.smoke",
      output: parsed.parsed.linguisticMaterialization ?? "fallback",
      metadata: { contextHints: plan.contextHints, userMessage: "" },
    },
    inventory,
  );
  const stateAfterAsk = getState(sessionId);
  const askedEvents = stateAfterAsk.eventLog.filter((e) => e.type === "repetition_inquiry_asked");
  assert(askedEvents.length === 1, `1 _asked event logged (got: ${askedEvents.length})`);

  // ─── Turn 2: criança responde "1" → parse + _answered ────────────────────
  console.log("\n[smoke] Turn 2 — user 'b' → executePlaybook → _answered");
  executePlaybook(
    {
      sessionId,
      playbookId: "p.smoke",
      output: "ok, vamos pra algo parecido",
      metadata: { userMessage: "b" },
    },
    inventory,
  );
  const stateAfterAnswer = getState(sessionId);
  const answered = stateAfterAnswer.eventLog.filter((e) => e.type === "repetition_inquiry_answered");
  assert(answered.length === 1, `1 _answered event logged (got: ${answered.length})`);
  if (answered.length > 0) {
    const d = answered[0].data;
    assert(d.choice === "b", `_answered.choice='b' (got: ${d.choice})`);
    assert(d.stage === "literal", `_answered.stage='literal' (got: ${d.stage})`);
  }

  console.log("");
  console.log(`[smoke] Total: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke] FATAL:", err);
  process.exit(1);
});
