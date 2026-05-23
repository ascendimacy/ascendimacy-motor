#!/usr/bin/env node
/**
 * PoC qualitativo — drota-materialized vs static item.content.
 *
 * Categoria: PoC qualitativo (ops#1070 S-T-10-09). Distinto de:
 *   - Unit/Smoke (pass/fail mechanics)
 *   - Benchmark (quantitativo: cost, latency)
 *
 * Pergunta empírica (ops#1070 S-T-10-09):
 *   "Se `ActionMenuItem.content` (gerado pelo producer S-T-10-08 ou
 *    bakeado manual) já é uma frase rica em pt-br, drota LLM composition
 *    ADICIONA VALOR (adaptação persona + bridge/quest + tom) ou pode ser
 *    SKIPPED, usando item.content direto como linguisticMaterialization?"
 *
 * Se ADICIONA VALOR → manter drota call (sem skip — só rationale skip
 *   atual da motor#115 fica em prod).
 * Se SUFICIENTE → habilitar skip drota composition (S-T-10-09):
 *   item.content rich enough → output direto, -100% LLM calls per-turn
 *   em hit path. Trade-off: perde adaptação persona/idade contextual.
 *
 * Implementação:
 *   - Pra cada item do menu fixture (Ryo + Paula):
 *     Branch A (drota current): callLlm com STABLE_DROTA_PREFIX +
 *       buildDrotaPrompt → captura linguisticMaterialization
 *     Branch B (skip static): linguisticMaterialization = item.content
 *   - Compara side-by-side, emite handoff markdown pra Jun ratificar
 *     GO/TUNE/NO-GO por item + agregado.
 *
 * Output: docs/handoffs/2026-05-22-poc-skip-drota-composition-<persona>.md
 *
 * Refs:
 *   - ops#1070 (story S-T-10-09)
 *   - ops#1058 (variance KPIs)
 *   - motor#115 (rationale skip — precedente metodológico)
 *   - scripts/poc-fixture-vs-producer.mjs (PoC pattern)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, setGlobalDispatcher } from "undici";
import yaml from "js-yaml";

// Undici timeout aligned with Qwen3 --parallel 1 + reasoning chains longas
setGlobalDispatcher(
  new Agent({ headersTimeout: 2_400_000, bodyTimeout: 2_400_000 }),
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const argv = process.argv.slice(2);
const PERSONA_KEY = argv[argv.indexOf("--persona") + 1] ?? "ryo";

const ENDPOINT =
  process.env.LLM_LOCAL_ENDPOINT ??
  "http://172.28.160.1:9000/v1/chat/completions";
const MODEL = process.env.LLM_LOCAL_MODEL ?? "qwen3-30b";

// ─── Personas + menu fixtures ───────────────────────────────────────────────
const PERSONAS = {
  ryo: {
    key: "ryo",
    personaId: "ryo-ochiai",
    personaLabel: "Ryo (deflective)",
    name: "Ryo",
    age: 14,
    trustLevel: 0.42,
    profileFixture: "fixtures/profiles/ryo-ochiai.pre-phase2.json",
    menuFixture: "fixtures/profiles/ryo-ochiai-menu.json",
  },
  paula: {
    key: "paula",
    personaId: "paula-mendes",
    personaLabel: "Paula (analytical-receptive)",
    name: "Paula",
    age: 38,
    trustLevel: 0.42,
    profileFixture: "fixtures/paula-mendes.yaml",
    profileKind: "yaml",
    menuFixture: "fixtures/profiles/paula-mendes-menu.json",
  },
};

// ─── Qwen3 LLM call adapter ────────────────────────────────────────────────
async function callQwen3(systemPrompt, userMessage) {
  const t0 = Date.now();
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    max_tokens: 1500,
    temperature: 0.7,
  };
  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2_400_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = await resp.json();
  return {
    text: json.choices[0].message.content,
    tokens: {
      in: json.usage?.prompt_tokens ?? 0,
      out: json.usage?.completion_tokens ?? 0,
    },
    latency_ms: Date.now() - t0,
  };
}

async function probeQwen3() {
  console.error(`[poc] probing ${ENDPOINT}...`);
  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 3,
      stream: false,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`Qwen3 probe failed HTTP ${resp.status}`);
  console.error("  ✓ Qwen3 up");
}

// ─── Drota prompt construction (mirrors motor-drota/src/server.ts) ──────────
// Importa STABLE_DROTA_PREFIX + buildDrotaPrompt do dist build pra fidelidade
// 100% ao prompt usado em prod (não duplica a string aqui).
const { STABLE_DROTA_PREFIX, buildDrotaPrompt } = await import(
  path.join(REPO_ROOT, "motor-drota", "dist", "server.js")
);

// Converte ActionMenuItem → ContentItem (curiosity_hook) pra alimentar
// buildDrotaPrompt. Espelha planejador/src/strategist/menu-lookup.ts.
function menuItemToContentItem(menuItem) {
  return {
    id: menuItem.id,
    type: "curiosity_hook",
    domain: "action_menu",
    casel_target: [],
    age_range: [7, 17],
    surprise: Math.round((menuItem.weight ?? 0.5) * 10),
    verified: true,
    base_score: Math.round((menuItem.weight ?? 0.5) * 10),
    fact: menuItem.content,
    bridge: "",
    quest: "",
    sacrifice_type: "reflect",
  };
}

// ─── Branch A: drota composition real ──────────────────────────────────────
async function brandchA_drotaMaterialize(persona, profile, menu, item) {
  const contentItem = menuItemToContentItem(item);
  const scoredItem = {
    item: contentItem,
    score: contentItem.base_score,
    reasons: ["poc_skip_drota_test"],
  };
  const input = {
    persona: {
      id: persona.personaId,
      name: persona.name,
      age: persona.age,
      profile,
    },
    state: {
      sessionId: `poc-${persona.key}-${Date.now()}`,
      trustLevel: persona.trustLevel,
      budgetRemaining: 1000,
      turn: 1,
    },
    contextHints: menu.source?.context_hints ?? { language: "pt-br" },
    strategicRationale: menu.source?.strategic_rationale ?? "",
    contentPool: [scoredItem],
    instruction_addition: "",
  };
  const systemPrompt = buildDrotaPrompt(input, scoredItem);
  const userMessage = "Materialize o content selecionado em JSON.";
  const result = await callQwen3(systemPrompt, userMessage);
  // Tenta parsear JSON do output drota — extractJson logic compatível
  let materialization = result.text;
  try {
    const trimmed = result.text.trim();
    let jsonStr = null;
    if (trimmed.startsWith("{")) {
      jsonStr = trimmed;
    } else {
      const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      } else {
        const start = trimmed.indexOf("{");
        const end = trimmed.lastIndexOf("}");
        if (start >= 0 && end > start) jsonStr = trimmed.slice(start, end + 1);
      }
    }
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      if (parsed.linguisticMaterialization) {
        materialization = parsed.linguisticMaterialization;
      }
    }
  } catch (e) {
    // Sem JSON válido — usa raw response como fallback
  }
  return {
    materialization,
    rawResponse: result.text,
    tokens: result.tokens,
    latencyMs: result.latency_ms,
  };
}

// ─── Branch B: skip static ────────────────────────────────────────────────
function branchB_skipStatic(item) {
  return {
    materialization: item.content,
    tokens: { in: 0, out: 0 },
    latencyMs: 0,
  };
}

// ─── Markdown handoff builder ──────────────────────────────────────────────
function buildHandoff(persona, menu, results) {
  const lines = [];
  lines.push(`# PoC qualitativo — drota-materialized vs static item.content`);
  lines.push("");
  lines.push(`**Persona:** ${persona.personaLabel} (\`${persona.personaId}\`)`);
  lines.push(`**Trust level:** ${persona.trustLevel}`);
  lines.push(`**Menu source:** \`${persona.menuFixture}\` (${menu.items.length} items)`);
  lines.push(`**Drota composer:** STABLE_DROTA_PREFIX + buildDrotaPrompt (motor-drota/dist/server.js)`);
  lines.push(`**LLM:** Qwen3 30B local (\`${MODEL}\`)`);
  lines.push(`**Data:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Pergunta que este PoC responde");
  lines.push("");
  lines.push("> Se `ActionMenuItem.content` já é frase rica em pt-br, o drota");
  lines.push("> LLM composition (atual, prod) ADICIONA VALOR ou pode ser SKIPPED");
  lines.push("> usando `item.content` direto como `linguisticMaterialization`?");
  lines.push("");
  lines.push("- ADICIONA → manter drota call (status quo)");
  lines.push("- SUFICIENTE → habilitar skip path S-T-10-09 (-100% LLM calls hit path)");
  lines.push("");
  lines.push("---");
  lines.push("");
  // Per-item comparisons
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const item = r.item;
    lines.push(`## Item ${i + 1}: \`${item.id}\` (\`${item.type}\` · played_as=\`${item.played_as}\` · intensity=\`${item.intensity}\` · weight=${item.weight})`);
    lines.push("");
    lines.push(`**item.content** (${item.content.length} chars):`);
    lines.push("");
    lines.push(`> ${item.content}`);
    lines.push("");
    lines.push("### Branch A — drota-materialized (LLM call)");
    lines.push("");
    if (r.errorA) {
      lines.push(`_(error: ${r.errorA})_`);
    } else {
      lines.push(`> ${r.branchA.materialization}`);
      lines.push("");
      lines.push(`_(${r.branchA.materialization.length} chars · ${r.branchA.latencyMs}ms · ${r.branchA.tokens.in}in/${r.branchA.tokens.out}out)_`);
    }
    lines.push("");
    lines.push("### Branch B — skip static (item.content direto)");
    lines.push("");
    lines.push(`> ${r.branchB.materialization}`);
    lines.push("");
    lines.push(`_(${r.branchB.materialization.length} chars · 0ms · 0 tokens)_`);
    lines.push("");
    lines.push("### Verdict por item (Jun)");
    lines.push("");
    lines.push("- [ ] **GO skip** — Branch B suficiente (item.content ≥ qualidade A)");
    lines.push("- [ ] **TUNE** — skip aceitável com modificação (especificar)");
    lines.push("- [ ] **NO-GO skip** — Branch A agrega valor essencial");
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  // Aggregate metrics
  const totalA = results.filter((r) => !r.errorA).reduce(
    (acc, r) => ({
      latency: acc.latency + r.branchA.latencyMs,
      tokensIn: acc.tokensIn + r.branchA.tokens.in,
      tokensOut: acc.tokensOut + r.branchA.tokens.out,
    }),
    { latency: 0, tokensIn: 0, tokensOut: 0 },
  );
  const validA = results.filter((r) => !r.errorA).length;
  lines.push("## Métricas agregadas");
  lines.push("");
  lines.push(`| Métrica | Branch A (drota) | Branch B (skip) |`);
  lines.push(`|---|---|---|`);
  lines.push(`| LLM calls per turn | 1 (per item) | **0** |`);
  lines.push(`| Latency total | ${totalA.latency}ms (${validA}/${results.length} valid) | **0ms** |`);
  lines.push(`| Tokens in/out | ${totalA.tokensIn}/${totalA.tokensOut} | **0/0** |`);
  lines.push(`| Mean per item | ${validA > 0 ? Math.round(totalA.latency / validA) : 0}ms · ${validA > 0 ? Math.round(totalA.tokensIn / validA) : 0}/${validA > 0 ? Math.round(totalA.tokensOut / validA) : 0} tokens | 0ms |`);
  lines.push("");
  lines.push("## Verdict agregado (Jun)");
  lines.push("");
  lines.push("- [ ] **GO** — skip drota composition pode ser habilitado em prod (S-T-10-09)");
  lines.push("- [ ] **TUNE** — skip aceitável com gate condicional (ex: só item.length > THRESHOLD)");
  lines.push("- [ ] **NO-GO** — drota agrega valor essencial pra adaptação persona/contexto");
  lines.push("");
  lines.push("_Análise qualitativa Jun:_");
  lines.push("");
  lines.push("**Onde drota agregou (Branch A > B):**");
  lines.push("");
  lines.push("**Onde drota não agregou (A == B):**");
  lines.push("");
  lines.push("**Recomendação threshold (se TUNE):**");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("_Methodology: PoC qualitativo (categoria formalizada ops#1058)._");
  lines.push("_Gerado por scripts/poc-skip-drota-composition.mjs · ops#1070 S-T-10-09_");
  return lines.join("\n");
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const persona = PERSONAS[PERSONA_KEY];
  if (!persona) {
    console.error(`Persona inválida: ${PERSONA_KEY}. Use ryo ou paula.`);
    process.exit(2);
  }

  console.error(`\n=== PoC skip-drota-composition · ${persona.personaLabel} ===\n`);

  await probeQwen3();

  const profileRaw = readFileSync(path.join(REPO_ROOT, persona.profileFixture), "utf-8");
  const profile = persona.profileKind === "yaml" ? yaml.load(profileRaw) : JSON.parse(profileRaw);
  const menu = JSON.parse(
    readFileSync(path.join(REPO_ROOT, persona.menuFixture), "utf-8"),
  );
  console.error(`[poc] persona loaded · menu has ${menu.items.length} items`);

  const results = [];
  for (let i = 0; i < menu.items.length; i++) {
    const item = menu.items[i];
    console.error(`\n[item ${i + 1}/${menu.items.length}] ${item.id} (${item.content.length} chars)`);
    const branchB = branchB_skipStatic(item);
    let branchA, errorA;
    try {
      branchA = await brandchA_drotaMaterialize(persona, profile, menu, item);
      console.error(`  Branch A: ${branchA.latencyMs}ms · ${branchA.tokens.in}in/${branchA.tokens.out}out · ${branchA.materialization.length} chars`);
    } catch (e) {
      errorA = e.message;
      console.error(`  Branch A FAILED: ${errorA}`);
    }
    results.push({ item, branchA, branchB, errorA });
  }

  // Save handoff
  const outDir = path.join(REPO_ROOT, "docs", "handoffs");
  await mkdir(outDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outDir, `${today}-poc-skip-drota-composition-${persona.key}.md`);
  const md = buildHandoff(persona, menu, results);
  writeFileSync(outPath, md, "utf-8");
  console.error(`\n✓ Handoff saved: ${outPath}`);
  console.error(`  Items: ${results.length} · Branch A ok: ${results.filter((r) => !r.errorA).length}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
