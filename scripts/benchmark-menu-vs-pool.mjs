#!/usr/bin/env node
/**
 * S-T-10-07 (ops#1005) — A/B benchmark menu (lookup) vs pool (scoring).
 *
 * Roda 2 scenarios × N turns × 1 persona com Qwen3 LOCAL no drota.
 * Coleta: latency planejador, latency drota, tokens drota, menu_hit/miss.
 * Output: JSON com runs detalhados + tabela markdown agregada.
 *
 * Pré-req: Qwen3 stack up em LLM_LOCAL_ENDPOINT.
 *
 * Uso:
 *   node scripts/benchmark-menu-vs-pool.mjs [--turns N] [--persona kei|ryo|paula]
 *
 * Notas de design:
 * - Planejador usa USE_MOCK_LLM=true em AMBOS scenarios (rationale não é foco;
 *   se fosse real, dobra o tempo de execução).
 * - Drota usa Qwen3 direto em AMBOS scenarios (a chamada que domina latência).
 * - Diferença entre scenarios: ASC_USE_ACTION_MENU=true vs false.
 *
 * Discovery esperado: drota cost ~igual entre scenarios. Menu lookup substitui
 * scoring DETERMINÍSTICO (~ms), não LLM rationale. Spec assumia -75% LLM calls
 * mas ASC_USE_ACTION_MENU atual não pula nenhuma chamada LLM per-turn — gap
 * documentado no handoff.
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Agent, setGlobalDispatcher } from "undici";

// undici default headersTimeout=300s; Qwen3 30B pode demorar +5min.
setGlobalDispatcher(
  new Agent({ headersTimeout: 2_400_000, bodyTimeout: 2_400_000 }),
);

// ─── Config ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const TURNS = Number(argv[argv.indexOf("--turns") + 1] ?? 3);
const PERSONA_KEY = (argv[argv.indexOf("--persona") + 1] ?? "ryo");
const ENDPOINT =
  process.env.LLM_LOCAL_ENDPOINT ??
  "http://172.28.160.1:9000/v1/chat/completions";
const MODEL = process.env.LLM_LOCAL_MODEL ?? "qwen3-30b";

const PERSONAS = {
  ryo: {
    id: "ryo-ochiai",
    name: "Ryo",
    age: 11,
    fixture: "ryo-ochiai.pre-phase2.json",
  },
  kei: {
    id: "kei-ochiai",
    name: "Kei",
    age: 9,
    fixture: "kei-ochiai.pre-phase2.json",
  },
  paula: {
    id: "paula-mendes",
    name: "Paula",
    age: 10,
    fixture: null, // só yaml, não pre-phase2
  },
};

const USER_MESSAGES = [
  "oi",
  "me conta uma coisa que vc acha legal",
  "outra coisa parecida",
  "isso é demais",
  "tem mais?",
];

// ─── Setup env ANTES de imports ─────────────────────────────────────────
process.env.USE_MOCK_LLM = "true"; // planejador rationale mockado
process.env.ASC_DEBUG_MODE = "false";
process.env.MOTOR_STATE_DIR = await mkdtemp(path.join(tmpdir(), "bench-"));

// ─── Qwen3 direct call ───────────────────────────────────────────────────
async function callQwen3(systemPrompt, userMessage) {
  const t0 = Date.now();
  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 600,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(2_400_000),
  });
  if (!resp.ok) throw new Error(`Qwen3 HTTP ${resp.status}`);
  const json = await resp.json();
  return {
    content: json.choices[0].message.content,
    tokens_in: json.usage?.prompt_tokens ?? 0,
    tokens_out: json.usage?.completion_tokens ?? 0,
    latency_ms: Date.now() - t0,
  };
}

async function probeQwen3() {
  const probe = ENDPOINT.replace("/chat/completions", "/models");
  console.log(`[bench] Probing ${probe}...`);
  const r = await fetch(probe, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Qwen3 offline (HTTP ${r.status})`);
  console.log("  ✓ Qwen3 up");
}

// ─── Run helpers ─────────────────────────────────────────────────────────
async function runScenario(scenarioName, useMenu, planTurn, executePlaybook, getState, persona, inventory, rankPool, selectFromPool, buildDrotaPrompt, parseDrotaOutput) {
  console.log(`\n[bench] ====== Scenario: ${scenarioName} (useMenu=${useMenu}) ======`);
  if (useMenu) {
    process.env.ASC_USE_ACTION_MENU = "true";
    process.env.ASC_ACTION_MENU_BASE_DIR = "fixtures/profiles";
  } else {
    delete process.env.ASC_USE_ACTION_MENU;
  }

  const sessionId = `bench-${scenarioName}-${Date.now()}`;
  getState(sessionId); // init

  const turns = [];
  for (let i = 0; i < TURNS; i++) {
    const userMsg = USER_MESSAGES[i % USER_MESSAGES.length];
    console.log(`\n[bench] turn ${i + 1}/${TURNS} — user: "${userMsg}"`);

    // ─── plan_turn ─────
    const t0 = Date.now();
    const state = getState(sessionId);
    const plan = await planTurn({
      sessionId,
      persona,
      state: { ...state, turn: i + 1 },
    });
    const planLatency = Date.now() - t0;

    const menuHit = plan.contextHints?.["plan_source"] === "action_menu" ||
      plan.contentPool.some((s) => s.reasons?.some((r) => r.includes("from_action_menu")));
    console.log(`  plan_turn: ${planLatency}ms — menu_hit=${menuHit}, pool_size=${plan.contentPool.length}`);

    // ─── drota composition with Qwen3 ─────
    const ranked = rankPool(plan.contentPool);
    if (ranked.length === 0) {
      console.log("  [skip] pool empty");
      turns.push({ turn: i + 1, userMsg, planLatency, menuHit, drotaSkip: true });
      continue;
    }
    const { selected } = selectFromPool(ranked, { ...state, turn: i + 1 });
    const drotaInput = {
      persona,
      state: { sessionId, trustLevel: 0.3, budgetRemaining: 90, turn: i + 1 },
      contentPool: plan.contentPool,
      contextHints: plan.contextHints,
      strategicRationale: plan.strategicRationale,
      instruction_addition: plan.instruction_addition ?? "",
    };
    const drotaPrompt = buildDrotaPrompt(drotaInput, selected);
    const qwen = await callQwen3(drotaPrompt, "Materialize o content selecionado em JSON.");
    console.log(`  drota Qwen3: ${qwen.latency_ms}ms — in=${qwen.tokens_in}, out=${qwen.tokens_out}`);

    const parsed = parseDrotaOutput(qwen.content);
    const output = parsed.parsed.linguisticMaterialization ?? "[parse_failed]";
    console.log(`  out: ${output.slice(0, 140)}${output.length > 140 ? "..." : ""}`);

    executePlaybook(
      {
        sessionId,
        playbookId: "p.bench",
        output,
        metadata: { contextHints: plan.contextHints, userMessage: userMsg, personaId: persona.id },
      },
      inventory,
    );

    turns.push({
      turn: i + 1,
      userMsg,
      planLatency,
      menuHit,
      drotaLatency: qwen.latency_ms,
      drotaTokensIn: qwen.tokens_in,
      drotaTokensOut: qwen.tokens_out,
      drotaPromptChars: drotaPrompt.length,
      output: output.slice(0, 300),
    });
  }
  return { scenarioName, useMenu, turns };
}

// ─── Aggregate + markdown ────────────────────────────────────────────────
function aggregate(scenario) {
  const valid = scenario.turns.filter((t) => !t.drotaSkip);
  const sum = (xs, key) => xs.reduce((a, b) => a + (b[key] ?? 0), 0);
  const avg = (xs, key) => (xs.length ? sum(xs, key) / xs.length : 0);
  const hits = valid.filter((t) => t.menuHit).length;
  return {
    scenarioName: scenario.scenarioName,
    useMenu: scenario.useMenu,
    turnCount: valid.length,
    avgPlanLatencyMs: Math.round(avg(valid, "planLatency")),
    avgDrotaLatencyMs: Math.round(avg(valid, "drotaLatency")),
    totalLatencyMs: sum(valid, "planLatency") + sum(valid, "drotaLatency"),
    avgDrotaPromptChars: Math.round(avg(valid, "drotaPromptChars")),
    avgTokensIn: Math.round(avg(valid, "drotaTokensIn")),
    avgTokensOut: Math.round(avg(valid, "drotaTokensOut")),
    totalTokensIn: sum(valid, "drotaTokensIn"),
    totalTokensOut: sum(valid, "drotaTokensOut"),
    menuHitRate: valid.length ? hits / valid.length : 0,
  };
}

function buildMarkdown(persona, agg, scenarios) {
  const a = agg[0];
  const b = agg[1];
  return `# S-T-10-07 benchmark — menu (lookup) vs pool (scoring)

**Persona:** ${persona.name} (${persona.id}, age ${persona.age})
**Turns por scenario:** ${TURNS}
**Drota LLM:** Qwen3 30B local (\`${MODEL}\`)
**Planejador LLM:** mock (USE_MOCK_LLM=true)
**Data:** ${new Date().toISOString()}

## Métricas agregadas

| Métrica | A (no menu) | B (menu lookup) | Delta B vs A |
|---|---|---|---|
| Turns válidos | ${a.turnCount} | ${b.turnCount} | — |
| Plan latency avg (ms) | ${a.avgPlanLatencyMs} | ${b.avgPlanLatencyMs} | ${pct(a.avgPlanLatencyMs, b.avgPlanLatencyMs)} |
| Drota latency avg (ms) | ${a.avgDrotaLatencyMs} | ${b.avgDrotaLatencyMs} | ${pct(a.avgDrotaLatencyMs, b.avgDrotaLatencyMs)} |
| Total latency (ms) | ${a.totalLatencyMs} | ${b.totalLatencyMs} | ${pct(a.totalLatencyMs, b.totalLatencyMs)} |
| Drota prompt chars avg | ${a.avgDrotaPromptChars} | ${b.avgDrotaPromptChars} | ${pct(a.avgDrotaPromptChars, b.avgDrotaPromptChars)} |
| Tokens in avg | ${a.avgTokensIn} | ${b.avgTokensIn} | ${pct(a.avgTokensIn, b.avgTokensIn)} |
| Tokens out avg | ${a.avgTokensOut} | ${b.avgTokensOut} | ${pct(a.avgTokensOut, b.avgTokensOut)} |
| Total tokens (in+out) | ${a.totalTokensIn + a.totalTokensOut} | ${b.totalTokensIn + b.totalTokensOut} | ${pct(a.totalTokensIn + a.totalTokensOut, b.totalTokensIn + b.totalTokensOut)} |
| menu_hit_rate | ${(a.menuHitRate * 100).toFixed(0)}% | ${(b.menuHitRate * 100).toFixed(0)}% | — |

## Outputs por turn

${scenarios.map((s) => `### Scenario: ${s.scenarioName}\n\n${s.turns.map((t) => `**Turn ${t.turn}** — user: \`${t.userMsg}\`\n${t.drotaSkip ? "_[pool empty, skipped]_" : `\n> ${t.output.replace(/\n/g, "\n> ")}\n\n_latency: plan ${t.planLatency}ms + drota ${t.drotaLatency}ms = ${t.planLatency + t.drotaLatency}ms; tokens: in=${t.drotaTokensIn} out=${t.drotaTokensOut}; menu_hit=${t.menuHit}_`}`).join("\n\n")}`).join("\n\n---\n\n")}

## Análise

`;
}

function pct(a, b) {
  if (a === 0) return b === 0 ? "—" : "+∞";
  const d = ((b - a) / a) * 100;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}%`;
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  await probeQwen3();

  const persona = PERSONAS[PERSONA_KEY];
  if (!persona) throw new Error(`unknown persona: ${PERSONA_KEY}`);
  console.log(`[bench] Persona: ${persona.name} (${persona.id}), turns=${TURNS}`);

  // Imports após env vars
  const { planTurn } = await import("../planejador/dist/plan.js");
  const { executePlaybook } = await import("../motor-execucao/dist/executor.js");
  const { getState } = await import("../motor-execucao/dist/state-manager.js");
  const { buildDrotaPrompt } = await import("../motor-drota/dist/server.js");
  const { parseDrotaOutput } = await import("../motor-drota/dist/parse-output.js");
  const { rankPool } = await import("../motor-drota/dist/evaluate.js");
  const { selectFromPool } = await import("../motor-drota/dist/select.js");

  const personaInput = { ...persona, profile: {} };

  const inventory = {
    version: "bench",
    playbooks: [
      {
        id: "p.bench",
        title: "bench",
        category: "test",
        triggers: ["x"],
        content: "bench",
        estimatedSacrifice: 1,
        estimatedConfidenceGain: 1,
      },
    ],
  };

  const scenarios = [];
  scenarios.push(
    await runScenario("A_no_menu", false, planTurn, executePlaybook, getState, personaInput, inventory, rankPool, selectFromPool, buildDrotaPrompt, parseDrotaOutput),
  );
  scenarios.push(
    await runScenario("B_menu_lookup", true, planTurn, executePlaybook, getState, personaInput, inventory, rankPool, selectFromPool, buildDrotaPrompt, parseDrotaOutput),
  );

  const agg = scenarios.map(aggregate);
  const md = buildMarkdown(persona, agg, scenarios);

  const outDir = path.resolve("docs/handoffs");
  await mkdir(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const mdPath = path.join(outDir, `${date}-sprint1-benchmark.md`);
  const jsonPath = path.join(outDir, `${date}-sprint1-benchmark-raw.json`);
  await writeFile(mdPath, md, "utf-8");
  await writeFile(jsonPath, JSON.stringify({ persona, turnsPerScenario: TURNS, scenarios, agg }, null, 2), "utf-8");

  console.log("\n" + md);
  console.log(`\n[bench] Markdown: ${mdPath}`);
  console.log(`[bench] Raw JSON: ${jsonPath}`);
}

main().catch((err) => {
  console.error("[bench] FATAL:", err);
  process.exit(1);
});
