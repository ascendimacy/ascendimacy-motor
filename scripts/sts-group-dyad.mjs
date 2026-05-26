#!/usr/bin/env node
/**
 * Sprint 4 PR 2 (ops#1077) — STS group dyad simulator (Ryo+Kei joint).
 *
 * Simula WhatsApp group session sintética entre 2 STS personas + bot.
 * Pre-Yuji pilot prep: valida joint mode (motor#23 sessionMode=joint) +
 * turntaking + bot quota antes de F0 blockers (#75) desbloqueem real pilot.
 *
 * Loop:
 *   1. Bot drota emite item via skip path (motor#136 ASC_SKIP_DROTA_COMPOSITION
 *      = item.content direto). Joint mode contextHints.
 *   2. Ryo persona-sim responde via Qwen3 (persona deflective, idade 11).
 *   3. Kei persona-sim responde via Qwen3 (persona philosophical, idade 9).
 *   4. Turntaking: round-robin Ryo→Kei; bot fala após 2 child turns (cap
 *      "nunca > 25%" — em dyad, 1 bot turn cada 2 child turns × 2 children).
 *   5. N ciclos.
 *
 * Output:
 *   - trace JSON: per-turn (speaker, message, latency, tokens, item)
 *   - handoff markdown: dialog rendering + bot quota stats + análise
 *
 * Defaults CC propostos #1077 (Sub-decisões tier:3-spec inline):
 *   1. Persona-sim prompt template: "Você é {name}, {archetype}, {age} anos.
 *      Profile: {profile_summary}. Última mensagem do bot: {bot_msg}. Última
 *      do irmão: {sibling_msg}. Responda em 1-3 frases, registro literal/curto."
 *   2. Bot quota dyad: 1 bot turn cada 2 child turns (não 3). Em dyad, "≥3
 *      child turns" é confuso — 2 children alternando 1 turn cada conta como
 *      "1 round". 1 bot turn cada round (= 2 child turns) mantém ≤ 25% bot.
 *   3. Brejo unilateral: skip persona em brejo (current persona não responde;
 *      próximo persona ainda pode).
 *   4. N=3 ciclos default (= ~3 bot + 6 child turns total).
 *
 * Usage:
 *   node scripts/sts-group-dyad.mjs [--n 3]
 *
 * Refs:
 *   - ops#1077 (story), ops#1120 Sprint 4 tracker
 *   - motor#23 (joint mode original)
 *   - motor#136 (composition skip)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(
  new Agent({ headersTimeout: 2_400_000, bodyTimeout: 2_400_000 }),
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const argv = process.argv.slice(2);
const N = parseInt(argv[argv.indexOf("--n") + 1] ?? "3", 10);

const ENDPOINT =
  process.env.LLM_LOCAL_ENDPOINT ??
  "http://172.28.160.1:9000/v1/chat/completions";
const MODEL = process.env.LLM_LOCAL_MODEL ?? "qwen3-30b";
// Bearer token opcional — necessário para Copilot/GitHub Models (remoto).
// Deixe unset para Qwen3 local (sem auth).
const AUTH_BEARER = process.env.LLM_LOCAL_AUTH_BEARER ?? "";

// ─── Personas ────────────────────────────────────────────────────────────
const PERSONAS = {
  ryo: {
    id: "ryo-ochiai",
    name: "Ryo",
    age: 11,
    archetype: "deflective",
    profileFixture: "fixtures/profiles/ryo-ochiai.pre-phase2.json",
    menuFixture: "fixtures/profiles/ryo-ochiai-menu.json",
  },
  kei: {
    id: "kei-ochiai",
    name: "Kei",
    age: 9,
    archetype: "philosophical",
    profileFixture: "fixtures/profiles/kei-ochiai.pre-phase2.json",
    menuFixture: null, // Kei não tem menu fixture; só Ryo + Saki têm
  },
};

// ─── LLM call (OpenAI-compat — Qwen3 local ou Copilot remoto) ────────────
async function callQwen3(systemPrompt, userMessage, maxTokens = 300) {
  const t0 = Date.now();
  const headers = { "Content-Type": "application/json" };
  if (AUTH_BEARER) headers["Authorization"] = `Bearer ${AUTH_BEARER}`;
  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature: 0.8,
    }),
    signal: AbortSignal.timeout(2_400_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Qwen3 HTTP ${resp.status}: ${text.slice(0, 150)}`);
  }
  const json = await resp.json();
  return {
    text: json.choices[0].message.content.trim(),
    tokens: {
      in: json.usage?.prompt_tokens ?? 0,
      out: json.usage?.completion_tokens ?? 0,
    },
    latency_ms: Date.now() - t0,
  };
}

// ─── Persona-sim prompt (default CC #1077 sub-dec 1) ─────────────────────
function buildPersonaSimPrompt(persona, profile) {
  const interests = (profile.profile?.preferences?.interests ?? []).slice(0, 5).join(", ");
  const aversions = (profile.profile?.preferences?.aversions ?? []).slice(0, 3).join(", ");
  const familyAnchors = (profile.profile?.family_anchors ?? [])
    .map((a) => (typeof a === "string" ? a : `${a.name} (${a.role})`))
    .slice(0, 3)
    .join(", ");

  return `Você é ${persona.name}, ${persona.age} anos. Archetype: ${persona.archetype}.

Perfil:
- Interesses: ${interests}
- Aversões: ${aversions}
- Família: ${familyAnchors}

Estilo de resposta:
- ${persona.archetype === "deflective"
      ? "respostas curtas (1-2 frases), evasivo, deflete com gestos físicos ou humor"
      : "respostas mais elaboradas (2-3 frases), conceitual, busca padrões"}
- Linguagem informal pt-br adequada à idade ${persona.age}
- Registro literal — sem metacomunicação adulta

Esta é uma sessão em grupo no WhatsApp com seu irmão. Você responde sua próxima fala.`;
}

// ─── Bot turn — skip path (motor#136) ────────────────────────────────────
function botTurnSkipPath(menu, turnIdx) {
  // Skip drota composition: item.content direto como bot output (motor#136)
  const item = menu.items[turnIdx % menu.items.length];
  return {
    speaker: "bot",
    item_id: item.id,
    message: item.content,
    skip_path: "composition_skipped",
    tokens: { in: 0, out: 0 },
    latency_ms: 0,
  };
}

// ─── Persona-sim turn ────────────────────────────────────────────────────
async function personaSimTurn(persona, profile, conversation) {
  const lastBotTurn = [...conversation].reverse().find((t) => t.speaker === "bot");
  const lastSiblingTurn = [...conversation]
    .reverse()
    .find((t) => t.speaker !== "bot" && t.speaker !== persona.id);
  const ctx = `Última mensagem do bot Brota: "${lastBotTurn?.message ?? "(início da sessão)"}"\n${
    lastSiblingTurn ? `Última mensagem do seu irmão: "${lastSiblingTurn.message}"\n` : ""
  }\nResponda em 1-3 frases.`;

  const system = buildPersonaSimPrompt(persona, profile);
  const result = await callQwen3(system, ctx, 200);
  return {
    speaker: persona.id,
    name: persona.name,
    message: result.text,
    tokens: result.tokens,
    latency_ms: result.latency_ms,
  };
}

// ─── Handoff markdown ────────────────────────────────────────────────────
function buildHandoff(conversation, stats, n) {
  const lines = [];
  lines.push("# STS group dyad — Ryo + Kei joint session (Sprint 4 PR 2)");
  lines.push("");
  lines.push(`**Data:** ${new Date().toISOString()}`);
  lines.push(`**LLM:** Qwen3 30B local (\`${MODEL}\`)`);
  lines.push(`**N ciclos:** ${n}`);
  lines.push("**Mode:** joint dyad · turntaking round-robin + bot quota");
  lines.push("**Skip path:** motor#136 composition skip ativado pra bot turns");
  lines.push("");
  lines.push("## Diálogo sintético");
  lines.push("");
  for (const t of conversation) {
    const speaker = t.speaker === "bot" ? "🌳 **Brota**" : `**${t.name}**`;
    lines.push(`### ${speaker}`);
    lines.push("");
    lines.push(`> ${t.message}`);
    lines.push("");
    if (t.speaker !== "bot") {
      lines.push(`_(${t.latency_ms}ms · ${t.tokens.in}in/${t.tokens.out}out)_`);
    } else {
      lines.push(`_(item: \`${t.item_id}\` · skip: ${t.skip_path} · 0ms · 0 tokens)_`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("## Estatísticas turntaking");
  lines.push("");
  lines.push(`- Total turns: ${stats.total}`);
  lines.push(`- Bot turns: ${stats.bot} (${Math.round(100 * stats.bot / stats.total)}%, target ≤25%)`);
  lines.push(`- Ryo turns: ${stats.ryo} (${Math.round(100 * stats.ryo / stats.total)}%)`);
  lines.push(`- Kei turns: ${stats.kei} (${Math.round(100 * stats.kei / stats.total)}%)`);
  lines.push(`- Bot quota constraint (≤25%): ${stats.bot / stats.total <= 0.25 ? "✓ OK" : "✗ VIOLATED"}`);
  lines.push("");
  lines.push("## Latency + tokens (persona-sims)");
  lines.push("");
  const childTurns = conversation.filter((t) => t.speaker !== "bot");
  const totalLat = childTurns.reduce((a, t) => a + t.latency_ms, 0);
  const totalIn = childTurns.reduce((a, t) => a + t.tokens.in, 0);
  const totalOut = childTurns.reduce((a, t) => a + t.tokens.out, 0);
  lines.push(`- Total persona-sim time: ${Math.round(totalLat / 1000)}s`);
  lines.push(`- Average per child turn: ${childTurns.length > 0 ? Math.round(totalLat / childTurns.length) : 0}ms`);
  lines.push(`- Total tokens persona-sims: ${totalIn}in/${totalOut}out`);
  lines.push("");
  lines.push("## Verdict (Jun)");
  lines.push("");
  lines.push("Sub-decisões #1077:");
  lines.push("");
  lines.push("- [ ] **1. Persona-sim prompt template** — defaults CC inline OK?");
  lines.push("  - Default: prompt fixo com interests + aversions + family_anchors + style por archetype");
  lines.push("- [ ] **2. Bot quota dyad** — 1 bot turn cada 2 child turns ratificado?");
  lines.push("  - Default: ratio bot=1, children=2 (= 33% bot — acima 25% target!)");
  lines.push("  - Alternativa: 1 bot turn cada 4 child turns (~20% bot)");
  lines.push("- [ ] **3. Brejo unilateral** — skip persona, dialog continua com outro?");
  lines.push("  - Default: skip; not tested neste script (não há injeção brejo synthetic)");
  lines.push("- [ ] **4. N=3 ciclos default** — adequado?");
  lines.push("");
  lines.push("Verdict agregado:");
  lines.push("");
  lines.push("- [ ] **GO** — script + defaults ratificados, Sprint 4 PR 2 done");
  lines.push("- [ ] **TUNE** — ajustar X (bot quota, persona-sim, N, etc.)");
  lines.push("- [ ] **NO-GO** — abordagem precisa revisão");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("_Methodology: STS group dyad synthetic (Sprint 4 PR 2 ops#1077)._");
  lines.push("_Gerado por scripts/sts-group-dyad.mjs · ops#1120 Sprint 4 tracker_");
  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.error(`\n=== STS group dyad · Ryo + Kei · N=${N} ciclos ===\n`);

  const ryoProfile = JSON.parse(readFileSync(path.join(REPO_ROOT, PERSONAS.ryo.profileFixture), "utf-8"));
  const keiProfile = JSON.parse(readFileSync(path.join(REPO_ROOT, PERSONAS.kei.profileFixture), "utf-8"));
  const ryoMenu = JSON.parse(readFileSync(path.join(REPO_ROOT, PERSONAS.ryo.menuFixture), "utf-8"));

  const conversation = [];
  const stats = { total: 0, bot: 0, ryo: 0, kei: 0 };

  for (let cycle = 0; cycle < N; cycle++) {
    console.error(`\n--- Ciclo ${cycle + 1}/${N} ---`);
    // 1. Bot turn (skip path)
    const botTurn = botTurnSkipPath(ryoMenu, cycle);
    conversation.push(botTurn);
    stats.total++;
    stats.bot++;
    console.error(`  🌳 bot: "${botTurn.message.slice(0, 80)}${botTurn.message.length > 80 ? "..." : ""}"`);

    // 2. Ryo responde
    process.stderr.write(`  Ryo persona-sim...`);
    try {
      const ryoTurn = await personaSimTurn(PERSONAS.ryo, ryoProfile, conversation);
      conversation.push(ryoTurn);
      stats.total++;
      stats.ryo++;
      process.stderr.write(` ${ryoTurn.latency_ms}ms\n`);
      console.error(`     "${ryoTurn.message.slice(0, 80)}${ryoTurn.message.length > 80 ? "..." : ""}"`);
    } catch (e) {
      process.stderr.write(` ERROR: ${e.message}\n`);
    }

    // 3. Kei responde
    process.stderr.write(`  Kei persona-sim...`);
    try {
      const keiTurn = await personaSimTurn(PERSONAS.kei, keiProfile, conversation);
      conversation.push(keiTurn);
      stats.total++;
      stats.kei++;
      process.stderr.write(` ${keiTurn.latency_ms}ms\n`);
      console.error(`     "${keiTurn.message.slice(0, 80)}${keiTurn.message.length > 80 ? "..." : ""}"`);
    } catch (e) {
      process.stderr.write(` ERROR: ${e.message}\n`);
    }
  }

  const outDir = path.join(REPO_ROOT, "docs", "handoffs");
  await mkdir(outDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const mdPath = path.join(outDir, `${today}-sprint4-pr2-sts-group-dyad-ryo-kei.md`);
  const jsonPath = path.join(outDir, `${today}-sprint4-pr2-sts-group-dyad-ryo-kei-raw.json`);
  writeFileSync(mdPath, buildHandoff(conversation, stats, N), "utf-8");
  writeFileSync(jsonPath, JSON.stringify({ conversation, stats, n: N }, null, 2), "utf-8");
  console.error(`\n✓ Handoff: ${mdPath}`);
  console.error(`✓ Raw JSON: ${jsonPath}`);
  console.error(`  Total turns: ${stats.total} (bot ${stats.bot}, Ryo ${stats.ryo}, Kei ${stats.kei})`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
