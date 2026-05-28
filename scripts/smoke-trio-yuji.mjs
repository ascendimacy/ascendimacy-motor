#!/usr/bin/env node
/**
 * Smoke E2E trio Yuji — Ryo+Kei+Saki concurrent mock LLM.
 *
 * Spec: agent E6-M batch 6 (smoke E2E concurrent).
 *
 * Spawna 3 sessões orchestrator.runTurn() concorrentes (uma por kid Yuji),
 * cada uma com N turns mock determinístico via USE_MOCK_LLM=true. Valida:
 *   - 3 sessões completam N turns sem cross-pollination
 *   - KPIs por persona (latency, fallback rate, distinct responses)
 *   - Cross-pollination = 0 (nenhuma resposta de session A em session B/C)
 *
 * NOTA — desvio vs spec original: a spec mencionava POST /sessions/:id/turn
 * via BFF. Esse endpoint não existe (BFF é card-based: start-card + SSE
 * turn-state, sem /turn). Usamos orchestrator.runTurn() direto — mesmo
 * pattern de scripts/smoke.mjs, que é o primitivo per-turn real do motor.
 * USE_MOCK_LLM=true cobre a parte "mock determinístico" da spec; ver
 * orchestrator/src/mcp-clients.ts createMockClients() para o mock canônico.
 *
 * Isolation: cada sessão recebe seu próprio set de MCP clients (connectAll
 * × 3). Cross-pollination detector valida que finalResponses não contêm
 * nome de outra persona, e que trace files preservam personaId correto.
 *
 * Usage:
 *   USE_MOCK_LLM=true node scripts/smoke-trio-yuji.mjs           # 50 turns
 *   USE_MOCK_LLM=true TURNS=10 node scripts/smoke-trio-yuji.mjs  # quick
 *
 * Output:
 *   - console.table com KPIs por persona
 *   - smoke-artifacts/trio-yuji-{timestamp}.json (estruturado pra CI)
 *   - exit 0 se pass, exit 1 se fail
 *
 * Refs: smoke.mjs (single-turn pattern), sts-group-dyad.mjs (concurrente
 *   via Qwen3 — diferente target).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");

// Mock LLM é default — script é smoke determinístico.
if (process.env["USE_MOCK_LLM"] === undefined) {
  process.env["USE_MOCK_LLM"] = "true";
}

// ─── Personas ────────────────────────────────────────────────────────────
export const PERSONAS = [
  { id: "ryo-kid", name: "Ryo", age: 8 },
  { id: "kei-kid", name: "Kei", age: 6 },
  { id: "saki-kid", name: "Saki", age: 4 },
];

// ─── Canned user messages ────────────────────────────────────────────────
// 50 variadas — mix curiosidade, emoção, idiomas, perguntas. Suficiente
// pra exercitar variantes de plan/select sem demandar LLM real.
export const CANNED_MESSAGES = [
  "Oi, tudo bem?",
  "O que você gosta de fazer?",
  "Hoje estou um pouco triste",
  "Por que o céu é azul?",
  "Qual é a sua cor favorita?",
  "Você sabe contar até 100?",
  "Me conta uma história",
  "Que dia é hoje?",
  "Como se diz 'casa' em japonês?",
  "Estou com sono",
  "O que tem pro jantar?",
  "Posso te contar um segredo?",
  "Por que tenho que ir pra escola?",
  "Minha amiga não falou comigo hoje",
  "Como funciona o arco-íris?",
  "Quero brincar agora",
  "Olha o que eu desenhei",
  "Eu sei nadar",
  "Você gosta de doce?",
  "Estou com fome",
  "Por que os gatos ronronam?",
  "Quanto tempo falta pro fim de semana?",
  "Hoje briguei com meu irmão",
  "Me ajuda a soletrar 'biblioteca'",
  "O que é amizade?",
  "Eu tenho medo do escuro",
  "Por que choro quando estou bravo?",
  "Vou ser cientista quando crescer",
  "Como nasce um bebê?",
  "Por que tenho que dormir cedo?",
  "Olha, ganhei estrela na escola!",
  "Não quero fazer o dever",
  "Quanto é 7 vezes 8?",
  "Por que as folhas caem no outono?",
  "Hoje aprendi uma palavra nova",
  "Estou feliz hoje",
  "Por que tenho que escovar os dentes?",
  "Posso comer chocolate antes do jantar?",
  "O que significa 'saudade'?",
  "Vou viajar nas férias",
  "Como funciona a internet?",
  "Por que o sol não cai?",
  "Tô entediado",
  "Mãe disse não",
  "Conta de novo aquela história",
  "Por que tenho que arrumar o quarto?",
  "Aprendi a andar de bicicleta",
  "O que você pensa quando eu pergunto?",
  "Quero ser amigo seu",
  "Tchau, até amanhã",
];

if (CANNED_MESSAGES.length !== 50) {
  throw new Error(
    `Expected 50 canned messages, got ${CANNED_MESSAGES.length}. Fix script.`,
  );
}

// ─── Pure functions (testáveis isoladamente) ─────────────────────────────

/**
 * Aggregate KPIs per persona from flat turn results.
 * @param {Array<{persona:string,turnIdx:number,latencyMs:number,finalResponse:string,error?:string}>} turnResults
 * @returns {Record<string, {totalTurns:number,successTurns:number,fallbackRate:number,avgLatencyMs:number,p95LatencyMs:number,distinctResponses:number}>}
 */
export function aggregateKpis(turnResults) {
  const byPersona = new Map();
  for (const r of turnResults) {
    const arr = byPersona.get(r.persona) ?? [];
    arr.push(r);
    byPersona.set(r.persona, arr);
  }
  const out = {};
  for (const [persona, results] of byPersona) {
    const total = results.length;
    const errs = results.filter((r) => r.error).length;
    const latencies = results
      .filter((r) => !r.error)
      .map((r) => r.latencyMs)
      .sort((a, b) => a - b);
    const avgLatencyMs =
      latencies.length > 0
        ? latencies.reduce((s, x) => s + x, 0) / latencies.length
        : 0;
    const p95Idx = Math.floor(latencies.length * 0.95);
    const p95LatencyMs =
      latencies.length > 0
        ? (latencies[p95Idx] ?? latencies[latencies.length - 1])
        : 0;
    const distinct = new Set(
      results.filter((r) => !r.error).map((r) => r.finalResponse),
    ).size;
    out[persona] = {
      totalTurns: total,
      successTurns: total - errs,
      fallbackRate: total > 0 ? errs / total : 0,
      avgLatencyMs: Math.round(avgLatencyMs),
      p95LatencyMs,
      distinctResponses: distinct,
    };
  }
  return out;
}

/**
 * Detect cross-pollination between concurrent sessions.
 *
 * Heurística: se uma resposta de sessão A menciona o nome de outra persona
 * (ex.: "Olá Kei!" na sessão de Ryo) sem mencionar a própria persona, isso
 * sugere leak. Funciona com responses reais; com mock canned (idêntico
 * across personas e sem nomes), retorna [] — esperado.
 *
 * @param {Array<{sessionId:string,persona:string,responses:string[]}>} sessions
 * @returns {Array<{sessionId:string,turnIdx:number,otherPersona:string,response:string}>}
 */
export function detectCrossPollination(sessions) {
  const issues = [];
  for (const sess of sessions) {
    const otherPersonas = sessions
      .filter((s) => s.sessionId !== sess.sessionId)
      .map((s) => s.persona);
    for (let i = 0; i < sess.responses.length; i++) {
      const resp = sess.responses[i] ?? "";
      const ownRe = new RegExp(`\\b${sess.persona}\\b`, "i");
      const mentionsOwn = ownRe.test(resp);
      for (const other of otherPersonas) {
        const otherRe = new RegExp(`\\b${other}\\b`, "i");
        if (otherRe.test(resp) && !mentionsOwn) {
          issues.push({
            sessionId: sess.sessionId,
            turnIdx: i,
            otherPersona: other,
            response: resp,
          });
        }
      }
    }
  }
  return issues;
}

/**
 * Load persona fixture YAML (existência + return raw content).
 * @param {string} personaId
 * @param {string} [fixturesDir]
 * @returns {string} raw YAML content
 */
export function loadPersonaFixture(
  personaId,
  fixturesDir = join(REPO_ROOT, "fixtures"),
) {
  const path = join(fixturesDir, `${personaId}.yaml`);
  if (!existsSync(path)) {
    throw new Error(`Persona fixture not found: ${path}`);
  }
  return readFileSync(path, "utf-8");
}

/**
 * Decide pass/fail from aggregated KPIs + cross-pollination.
 * @param {ReturnType<typeof aggregateKpis>} kpis
 * @param {ReturnType<typeof detectCrossPollination>} crossPollination
 * @param {number} expectedTurns
 * @returns {{pass:boolean, failures:string[]}}
 */
export function evaluateRubric(kpis, crossPollination, expectedTurns) {
  const failures = [];
  for (const persona of PERSONAS) {
    const k = kpis[persona.id];
    if (!k) {
      failures.push(`${persona.id}: no KPIs collected`);
      continue;
    }
    if (k.totalTurns !== expectedTurns) {
      failures.push(
        `${persona.id}: ${k.totalTurns}/${expectedTurns} turns completed`,
      );
    }
    if (k.fallbackRate >= 0.1) {
      failures.push(
        `${persona.id}: fallback rate ${(k.fallbackRate * 100).toFixed(1)}% >= 10%`,
      );
    }
  }
  if (crossPollination.length > 0) {
    failures.push(`cross-pollination: ${crossPollination.length} leak(s)`);
  }
  return { pass: failures.length === 0, failures };
}

// ─── Main runtime ────────────────────────────────────────────────────────

async function runSessionTurns(connectAll, persona, sessionId, messages, tracesDir) {
  const clients = await connectAll();
  const results = [];
  try {
    const { runTurn } = await import(
      join(REPO_ROOT, "orchestrator/dist/orchestrator.js")
    );
    for (let i = 0; i < messages.length; i++) {
      const t0 = Date.now();
      try {
        const out = await runTurn(
          clients,
          sessionId,
          persona.id,
          messages[i],
          tracesDir,
        );
        results.push({
          persona: persona.id,
          turnIdx: i,
          latencyMs: Date.now() - t0,
          finalResponse: out.finalResponse,
        });
      } catch (err) {
        results.push({
          persona: persona.id,
          turnIdx: i,
          latencyMs: Date.now() - t0,
          finalResponse: "",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    const { disconnectAll } = await import(
      join(REPO_ROOT, "orchestrator/dist/mcp-clients.js")
    );
    await disconnectAll(clients);
  }
  return results;
}

async function main() {
  const TURNS = parseInt(process.env["TURNS"] ?? "50", 10);
  if (TURNS < 1 || TURNS > CANNED_MESSAGES.length) {
    console.error(
      `[trio-yuji] TURNS must be 1..${CANNED_MESSAGES.length}, got ${TURNS}`,
    );
    process.exit(1);
  }
  const messages = CANNED_MESSAGES.slice(0, TURNS);

  // Verifica fixtures antes de tentar runTurn (early fail).
  for (const p of PERSONAS) {
    loadPersonaFixture(p.id);
  }

  const tracesDir = join(REPO_ROOT, "traces");
  mkdirSync(tracesDir, { recursive: true });

  const { connectAll } = await import(
    join(REPO_ROOT, "orchestrator/dist/mcp-clients.js")
  );

  const startTs = Date.now();
  const sessionIds = PERSONAS.map(
    (p) => `smoke-trio-${p.id}-${startTs}`,
  );

  console.log(
    `[trio-yuji] Starting 3 concurrent sessions × ${TURNS} turns (mock=${process.env["USE_MOCK_LLM"]})...`,
  );

  const t0 = Date.now();
  const results = await Promise.all(
    PERSONAS.map((p, idx) =>
      runSessionTurns(connectAll, p, sessionIds[idx], messages, tracesDir),
    ),
  );
  const elapsedMs = Date.now() - t0;

  const allTurns = results.flat();
  const kpis = aggregateKpis(allTurns);

  const sessionsForCheck = PERSONAS.map((p, idx) => ({
    sessionId: sessionIds[idx],
    persona: p.name,
    responses: results[idx].map((r) => r.finalResponse),
  }));
  const crossPollination = detectCrossPollination(sessionsForCheck);

  console.log("\n[trio-yuji] === KPIs per persona ===");
  console.table(kpis);
  console.log(`\n[trio-yuji] Cross-pollination issues: ${crossPollination.length}`);
  console.log(
    `[trio-yuji] Elapsed: ${elapsedMs}ms (${(elapsedMs / 1000).toFixed(1)}s)`,
  );

  const artifactsDir = join(REPO_ROOT, "smoke-artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactPath = join(artifactsDir, `trio-yuji-${ts}.json`);
  writeFileSync(
    artifactPath,
    JSON.stringify(
      {
        timestamp: ts,
        turnsPerPersona: TURNS,
        elapsedMs,
        sessionIds,
        kpis,
        crossPollination,
        useMockLlm: process.env["USE_MOCK_LLM"] === "true",
      },
      null,
      2,
    ),
  );
  console.log(`[trio-yuji] Artifact: ${artifactPath}`);

  const { pass, failures } = evaluateRubric(kpis, crossPollination, TURNS);
  if (!pass) {
    console.error("[trio-yuji] FAIL:");
    for (const f of failures) console.error(" -", f);
    process.exit(1);
  }
  console.log("[trio-yuji] PASS — 3 sessions × " + TURNS + " turns, zero cross-pollination");
}

// guard — só executa main quando invocado direto (não em import via tests)
const isMain = process.argv[1] && process.argv[1] === __filename;
if (isMain) {
  main().catch((err) => {
    console.error("[trio-yuji] Uncaught:", err);
    process.exit(1);
  });
}
