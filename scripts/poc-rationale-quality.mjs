#!/usr/bin/env node
/**
 * PoC qualitativo — compara rationale "Baked" (do menu fixture) vs "Fresh"
 * (gerado por Qwen3 com prompt real do planejador). Para cada rationale,
 * drota compõe via Qwen3 com mesmo selected_content. Output: handoff
 * markdown lado-a-lado pra review humano.
 *
 * Categoria: PoC qualitativo. Distinto de:
 *   - Unit/Smoke (pass/fail)
 *   - Benchmark (quantitativo: cost, latency)
 *
 * Pergunta que responde: "rationale baked é bom o suficiente vs rationale
 * gerado fresh, ou degrada drota output a ponto de comprometer pedagogia?"
 *
 * Pré-req: Qwen3 stack up em LLM_LOCAL_ENDPOINT.
 *
 * Uso:
 *   node scripts/poc-rationale-quality.mjs [--persona ryo|paula]
 *
 * Tempo: ~15min por persona (3 Qwen3 calls: 1 rationale fresh + 2 drota A/B).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(new Agent({ headersTimeout: 600_000, bodyTimeout: 600_000 }));

const argv = process.argv.slice(2);
const PERSONA_KEY = argv[argv.indexOf("--persona") + 1] ?? "ryo";
const ENDPOINT =
  process.env.LLM_LOCAL_ENDPOINT ??
  "http://172.28.160.1:9000/v1/chat/completions";
const MODEL = process.env.LLM_LOCAL_MODEL ?? "qwen3-30b";

const PERSONAS = {
  ryo: {
    id: "ryo-ochiai",
    name: "Ryo",
    age: 11,
    profile: { interests: ["tênis", "dragon_ball"], deflective: true },
  },
  paula: {
    id: "paula-mendes",
    name: "Paula",
    age: 10,
    profile: { interests: ["natureza", "histórias"] },
  },
};

async function callQwen3(systemPrompt, userMessage, maxTokens = 600) {
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
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(600_000),
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
  console.log(`[poc] Probing ${probe}...`);
  const r = await fetch(probe, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Qwen3 offline (HTTP ${r.status})`);
  console.log("  ✓ Qwen3 up");
}

function parseJsonLoose(raw) {
  try { return JSON.parse(raw); } catch {}
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}

async function main() {
  await probeQwen3();

  const persona = PERSONAS[PERSONA_KEY];
  if (!persona) throw new Error(`unknown persona: ${PERSONA_KEY}`);
  console.log(`[poc] Persona: ${persona.name} (${persona.id})`);

  process.env.ASC_USE_ACTION_MENU = "true";
  process.env.ASC_ACTION_MENU_BASE_DIR = "fixtures/profiles";

  // Imports após env vars
  const { buildSystemPrompt } = await import("../planejador/dist/plan.js");
  const { lookupActionMenu } = await import("../planejador/dist/strategist/menu-lookup.js");
  const { buildDrotaPrompt } = await import("../motor-drota/dist/server.js");
  const { parseDrotaOutput } = await import("../motor-drota/dist/parse-output.js");
  const { rankPool } = await import("../motor-drota/dist/evaluate.js");
  const { selectFromPool } = await import("../motor-drota/dist/select.js");

  // Lookup menu → pega items + source.strategic_rationale (Baked)
  console.log("\n[poc] === Etapa 1: lookup menu (Baked) ===");
  const menuResult = await lookupActionMenu(persona.id, "fixtures/profiles", {
    topK: 5,
    bypassCache: true,
  });
  if (menuResult.outcome !== "ok") {
    throw new Error(`menu lookup failed: outcome=${menuResult.outcome}`);
  }
  const bakedRationale = menuResult.source?.strategic_rationale;
  const bakedHints = menuResult.source?.context_hints ?? { language: "pt-br" };
  if (!bakedRationale) {
    throw new Error(`menu fixture ${persona.id}-menu.json não tem source.strategic_rationale`);
  }
  console.log(`  ✓ Baked rationale (${bakedRationale.length} chars): ${bakedRationale.slice(0, 100)}...`);

  const ranked = rankPool(menuResult.items);
  const fakeState = { sessionId: "poc", trustLevel: 0.42, budgetRemaining: 90, turn: 1 };
  const { selected } = selectFromPool(ranked, fakeState);
  console.log(`  Selected item: ${selected.item.id} (type=${selected.item.type})`);

  // Etapa 2: gera rationale FRESH chamando Qwen3 com prompt do planejador
  console.log("\n[poc] === Etapa 2: rationale Fresh via Qwen3 ===");
  const planejadorInput = {
    sessionId: "poc",
    persona,
    state: { ...fakeState, eventLog: [] },
    incomingMessage: "oi",
  };
  const planejadorPrompt = buildSystemPrompt(planejadorInput);
  console.log(`  Planejador prompt: ${planejadorPrompt.length} chars`);
  const freshT0 = Date.now();
  const freshResp = await callQwen3(planejadorPrompt, "Emita o JSON com rationale + hints.", 400);
  const freshLat = Date.now() - freshT0;
  const freshParsed = parseJsonLoose(freshResp.content);
  if (!freshParsed?.strategicRationale) {
    console.error(`[poc] Qwen3 returned unparseable rationale: ${freshResp.content}`);
    throw new Error("rationale fresh parse failed");
  }
  const freshRationale = freshParsed.strategicRationale;
  const freshHints = freshParsed.contextHints ?? { language: "pt-br" };
  console.log(`  ✓ Fresh rationale (${freshRationale.length} chars, ${freshLat}ms): ${freshRationale.slice(0, 100)}...`);

  // Etapa 3: drota compõe 2x com mesmo selected_content, rationales diferentes
  console.log("\n[poc] === Etapa 3: drota A (Baked) ===");
  const drotaInputA = {
    persona,
    state: { sessionId: "poc-a", trustLevel: 0.42, budgetRemaining: 90, turn: 1 },
    contentPool: menuResult.items,
    contextHints: bakedHints,
    strategicRationale: bakedRationale,
    instruction_addition: "",
  };
  const promptA = buildDrotaPrompt(drotaInputA, selected);
  const drotaA = await callQwen3(promptA, "Materialize o content selecionado em JSON.");
  const parsedA = parseDrotaOutput(drotaA.content);
  console.log(`  ✓ Drota A (${drotaA.latency_ms}ms, in=${drotaA.tokens_in}, out=${drotaA.tokens_out})`);

  console.log("\n[poc] === Etapa 4: drota B (Fresh) ===");
  const drotaInputB = {
    persona,
    state: { sessionId: "poc-b", trustLevel: 0.42, budgetRemaining: 90, turn: 1 },
    contentPool: menuResult.items,
    contextHints: freshHints,
    strategicRationale: freshRationale,
    instruction_addition: "",
  };
  const promptB = buildDrotaPrompt(drotaInputB, selected);
  const drotaB = await callQwen3(promptB, "Materialize o content selecionado em JSON.");
  const parsedB = parseDrotaOutput(drotaB.content);
  console.log(`  ✓ Drota B (${drotaB.latency_ms}ms, in=${drotaB.tokens_in}, out=${drotaB.tokens_out})`);

  // Build handoff markdown
  const outputA = parsedA.parsed.linguisticMaterialization ?? "[parse_failed]";
  const outputB = parsedB.parsed.linguisticMaterialization ?? "[parse_failed]";
  const md = `# PoC qualitativo — rationale Baked vs Fresh (ops#1069 follow-up)

**Persona:** ${persona.name} (${persona.id}, age ${persona.age})
**Selected content:** \`${selected.item.id}\` (type=${selected.item.type})
**Drota LLM:** Qwen3 30B local (\`${MODEL}\`)
**Planejador LLM:** Qwen3 30B local (direct fetch, bypass gateway)
**Data:** ${new Date().toISOString()}

## Pergunta que este PoC responde

"O rationale **Baked** (texto static no \`action-menu.json\`, consumido pelo skip path do S-T-10-08) produz drota output **qualitativamente equivalente** ao rationale **Fresh** (gerado per-turn via LLM)?"

Se sim, justifica o skip (motor#115) sem comprometer pedagogia.

---

## Rationale A — Baked (fixture)

> ${bakedRationale}

_${bakedRationale.length} chars_

## Rationale B — Fresh (Qwen3 ${freshLat}ms, in=${freshResp.tokens_in}, out=${freshResp.tokens_out})

> ${freshRationale}

_${freshRationale.length} chars_

---

## Drota output A (com Baked)

> ${outputA.replace(/\n/g, "\n> ")}

_latency: ${drotaA.latency_ms}ms; tokens: in=${drotaA.tokens_in}, out=${drotaA.tokens_out}_

## Drota output B (com Fresh)

> ${outputB.replace(/\n/g, "\n> ")}

_latency: ${drotaB.latency_ms}ms; tokens: in=${drotaB.tokens_in}, out=${drotaB.tokens_out}_

---

## Métricas objetivas

| | A (Baked) | B (Fresh) |
|---|---|---|
| Rationale source | fixture (instant read) | Qwen3 ${freshLat}ms |
| Rationale chars | ${bakedRationale.length} | ${freshRationale.length} |
| Drota latency | ${drotaA.latency_ms}ms | ${drotaB.latency_ms}ms |
| Drota tokens in | ${drotaA.tokens_in} | ${drotaB.tokens_in} |
| Drota tokens out | ${drotaA.tokens_out} | ${drotaB.tokens_out} |
| **Total LLM time** | ${drotaA.latency_ms}ms | ${freshLat + drotaB.latency_ms}ms |
| **Total LLM calls** | 1 | 2 |

## Verdict humano (Jun)

- [ ] **GO** — Baked é qualitativamente equivalente ou superior; skip path produz output bom
- [ ] **TUNE** — Baked é diferente mas aceitável com ajustes na geração do rationale (recomendações abaixo)
- [ ] **NO-GO** — Baked degrada significativamente; manter LLM rationale call por enquanto

_Análise qualitativa pelo Jun:_

**Coerência ao perfil de ${persona.name}:**

**Aderência a Brota Mestre §X:**

**Comparativo de tom/registro:**

**Observações pedagógicas:**

---

## Refs

- Spec: [ops#1069 S-T-10-08](https://github.com/ascendimacy/ascendimacy-ops/issues/1069)
- PR companion: motor#115 (skip path impl)
- Methodology: PoC qualitativo (categoria nova proposta 2026-05-16) — distinto de unit/smoke (pass/fail), benchmark (quantitativo)
`;

  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve("docs/handoffs");
  await mkdir(outDir, { recursive: true });
  const mdPath = path.join(outDir, `${date}-poc-rationale-quality-${persona.id}.md`);
  await writeFile(mdPath, md, "utf-8");

  console.log("\n" + md);
  console.log(`\n[poc] Markdown: ${mdPath}`);
}

main().catch((err) => {
  console.error("[poc] FATAL:", err);
  process.exit(1);
});
