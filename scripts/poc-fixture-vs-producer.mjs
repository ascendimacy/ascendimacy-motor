#!/usr/bin/env node
/**
 * PoC qualitativo — fixture manual vs producer-generated rationale/hints.
 *
 * Categoria: PoC qualitativo (ops#1069). Distinto de:
 *   - Unit/Smoke (pass/fail)
 *   - Benchmark (quantitativo: cost, latency)
 *
 * Pergunta empírica (motor#117 follow-up):
 *   "Os campos `source.strategic_rationale` + `source.context_hints` que
 *    foram PRE-BAKED MANUALMENTE em fixtures (`ryo-ochiai-menu.json`,
 *    `paula-mendes-menu.json`) durante motor#115 dev MATCH ou DEGRADAM
 *    quando comparados ao output REAL do producer rodando prompt v0.4
 *    contra Qwen3 30B local?"
 *
 * Se MATCH ou melhor → fixtures podem ser substituídos por producer output,
 *   reduz manual burden (fixture vira CI-generated).
 * Se DEGRADA → contract drift confirmado (Agent 11 leitura b); precisa fix
 *   prompt v0.5 antes de skip path em prod ser confiável.
 *
 * Implementação: chama `generateActionMenu` (motor#117 producer) com
 *   llmCall = Qwen3 direct fetch (padrão measure-menu-variance.mjs).
 *   Captura `source.strategic_rationale` + `source.context_hints` + items.
 *   Compara contra fixture manual baked. Emite handoff markdown side-by-side.
 *
 * Pré-req: Qwen3 stack up em LLM_LOCAL_ENDPOINT, fixtures Ryo/Paula presentes.
 *
 * Uso:
 *   node scripts/poc-fixture-vs-producer.mjs --persona ryo
 *   node scripts/poc-fixture-vs-producer.mjs --persona paula
 *
 * Tempo: ~5-10min por persona (1 Qwen3 menu generation call).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, setGlobalDispatcher } from "undici";
import yaml from "js-yaml";

// undici default headersTimeout=300s; Qwen3 30B com prompt grande
// pode demorar +5min até primeira resposta. Bump global (mesma config
// que poc-isa-labels-quality.mjs).
setGlobalDispatcher(
  new Agent({ headersTimeout: 1_200_000, bodyTimeout: 1_200_000 }),
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const argv = process.argv.slice(2);
const PERSONA_KEY = argv[argv.indexOf("--persona") + 1] ?? "ryo";

const ENDPOINT =
  process.env.LLM_LOCAL_ENDPOINT ??
  "http://172.28.160.1:9000/v1/chat/completions";
const MODEL = process.env.LLM_LOCAL_MODEL ?? "qwen3-30b";

// ─── Imports do build output do motor-drota ─────────────────────────────────
const { generateActionMenu, PROMPT_TEMPLATE_VERSION } = await import(
  path.join(REPO_ROOT, "motor-drota", "dist", "menu-generator.js")
);
const { RYO_HINT } = await import(
  path.join(REPO_ROOT, "motor-drota", "dist", "persona-hints.js")
);

// ─── Persona specs ──────────────────────────────────────────────────────────
//
// Ryo: profile JSON em fixtures/profiles/ryo-ochiai.pre-phase2.json,
//   hint canônico RYO_HINT (motor-drota/persona-hints.ts).
// Paula: profile YAML em fixtures/paula-mendes.yaml (sintético LAST-CO).
//   NÃO há PAULA_HINT canônico — construímos hint mínimo aqui pra alimentar
//   prompt. Hint compatível com PersonaHint shape; bias inspirado no perfil
//   "receptive curious analytical" da Paula (38a fintech architect).
const PAULA_HINT = {
  persona_id: "paula-mendes",
  age: 38,
  archetype: "analytical-receptive",
  bias: [
    { played_as: "canal", weight: 0.25 },
    { played_as: "espelho", weight: 0.22 },
    { played_as: "bridge", weight: 0.20 },
    { played_as: "diamante", weight: 0.15 },
    { played_as: "arena", weight: 0.10 },
    { played_as: "recovery", weight: 0.08 },
  ],
  intensity_cap: "firm",  // adulto, não Kids
  personal_vocab: [],
  notes:
    "Paula analytical-receptive: arquiteta sênior tech, 38a, intelectualiza " +
    "afeto via análise; aceita bridge/diamante com âncora cultural ou " +
    "técnica concreta (Bauman, Han, Arendt); evitar coaching-speak " +
    "motivacional; respeita diretividade. Trust 0.42 — rapport_building.",
};

const PERSONAS = {
  ryo: {
    key: "ryo",
    personaId: "ryo-ochiai",
    personaLabel: "Ryo (deflective)",
    trustLevel: 0.42,
    profileFixture: "fixtures/profiles/ryo-ochiai.pre-phase2.json",
    profileKind: "json",
    manualFixture: "fixtures/profiles/ryo-ochiai-menu.json",
    hint: RYO_HINT,
  },
  paula: {
    key: "paula",
    personaId: "paula-mendes",
    personaLabel: "Paula (analytical-receptive)",
    trustLevel: 0.42,
    profileFixture: "fixtures/paula-mendes.yaml",
    profileKind: "yaml",
    manualFixture: "fixtures/profiles/paula-mendes-menu.json",
    hint: PAULA_HINT,
  },
};

// ─── Qwen3 LLM call adapter ─────────────────────────────────────────────────
function makeQwen3LlmCall() {
  return async (systemPrompt, userMessage) => {
    const t0 = Date.now();
    const body = {
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 3000,
      temperature: 0.7,
    };
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1_200_000),
    });
    if (!resp.ok) throw new Error(`LLM local HTTP ${resp.status}`);
    const json = await resp.json();
    const latency_ms = Date.now() - t0;
    return {
      content: json.choices[0].message.content,
      tokens: {
        in: json.usage?.prompt_tokens ?? 0,
        out: json.usage?.completion_tokens ?? 0,
        reasoning: 0,
      },
      provider: "openai-compat",
      model: MODEL,
      // Anotação adicional (não faz parte do LlmCallResult interface mas
      // útil pro PoC; ignorado pelo generator).
      latency_ms,
    };
  };
}

async function probeQwen3() {
  const probe = ENDPOINT.replace("/chat/completions", "/models");
  console.log(`[poc] Probing ${probe}...`);
  const r = await fetch(probe, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Qwen3 offline (HTTP ${r.status})`);
  console.log("  ✓ Qwen3 up");
}

// ─── Profile loaders ────────────────────────────────────────────────────────
function loadProfile(spec) {
  const p = path.join(REPO_ROOT, spec.profileFixture);
  const raw = readFileSync(p, "utf-8");
  if (spec.profileKind === "yaml") return yaml.load(raw);
  return JSON.parse(raw);
}

function loadManualFixture(spec) {
  const p = path.join(REPO_ROOT, spec.manualFixture);
  return JSON.parse(readFileSync(p, "utf-8"));
}

// ─── Markdown builder ───────────────────────────────────────────────────────
function fmtHints(hints) {
  if (!hints) return "_(null / absent)_";
  if (typeof hints !== "object") return `_(unexpected shape: ${typeof hints})_`;
  const keys = Object.keys(hints);
  if (keys.length === 0) return "_(empty object)_";
  return keys.map((k) => `  - \`${k}\`: \`${JSON.stringify(hints[k])}\``).join("\n");
}

function fmtRationale(r) {
  if (!r) return "_(null / absent — producer não emitiu campo)_";
  if (typeof r !== "string") return `_(unexpected shape: ${typeof r})_`;
  return `> ${r}\n\n_(${r.length} chars)_`;
}

function fmtItem(item) {
  if (!item) return "_(empty)_";
  const fields = [
    `id=\`${item.id}\``,
    `type=\`${item.type}\``,
    item.played_as ? `played_as=\`${item.played_as}\`` : null,
    item.intensity ? `intensity=\`${item.intensity}\`` : null,
    item.weight != null ? `weight=${item.weight}` : null,
    item.is_critical ? `is_critical=true` : null,
  ].filter(Boolean);
  return `${fields.join(", ")}\n  > ${(item.content ?? "").replace(/\n/g, " ")}`;
}

function buildMarkdown(spec, manual, real, meta) {
  const manualSrc = manual.source ?? {};
  const realSrc = real.menu?.source ?? {};

  const manualHints = manualSrc.context_hints;
  const realHints = realSrc.context_hints;

  const manualRationale = manualSrc.strategic_rationale;
  const realRationale = realSrc.strategic_rationale;

  const manualItems = manual.items ?? [];
  const realItems = real.menu?.items ?? [];

  const sampleManualItem = manualItems[0];
  const sampleRealItem = realItems[0];

  const warningsBlock = meta.warnings.length
    ? meta.warnings.map((w) => `- \`${w}\``).join("\n")
    : "_(none)_";

  return `# PoC qualitativo — fixture-vs-producer

**Persona:** ${spec.personaLabel} (${spec.personaId})
**Trust level:** ${spec.trustLevel}
**Producer:** \`generateActionMenu\` (motor#117, prompt ${PROMPT_TEMPLATE_VERSION})
**LLM:** Qwen3 30B local (\`${MODEL}\`)
**Data:** ${new Date().toISOString()}

## Pergunta que este PoC responde

"Os campos \`source.strategic_rationale\` + \`source.context_hints\` que foram
PRE-BAKED MANUALMENTE em \`${path.basename(spec.manualFixture)}\` durante
desenvolvimento de motor#115 (skip path) MATCH ou DEGRADAM quando comparados
ao output REAL do producer rodando prompt v0.4 contra Qwen3 30B local?"

Se MATCH ou melhor → fixtures podem ser substituídos por producer output
(reduz manual burden, fixture vira CI-generated).
Se DEGRADA → contract drift confirmado (Agent 11 leitura b); precisa fix
prompt v0.5 antes de skip path em prod ser confiável.

---

## 1. \`source.strategic_rationale\` — side-by-side

### Manual baked (\`${path.basename(spec.manualFixture)}\`)

${fmtRationale(manualRationale)}

### Producer-generated (Qwen3 + prompt ${PROMPT_TEMPLATE_VERSION})

${fmtRationale(realRationale)}

---

## 2. \`source.context_hints\` — side-by-side

### Manual baked

${fmtHints(manualHints)}

### Producer-generated

${fmtHints(realHints)}

---

## 3. Items — count + sample

| | Manual baked | Producer-generated |
|---|---|---|
| Items count | ${manualItems.length} | ${realItems.length} |
| Sample item (first) | ${fmtItem(sampleManualItem)} | ${fmtItem(sampleRealItem)} |

### Items reais (producer-generated) — full list

${realItems.map((it, i) => `${i + 1}. ${fmtItem(it)}`).join("\n")}

### Items manuais (fixture baked) — full list

${manualItems.map((it, i) => `${i + 1}. ${fmtItem(it)}`).join("\n")}

---

## 4. Métricas objetivas (producer run)

| Métrica | Valor |
|---|---|
| Generator outcome | ${real.menu ? "ok (menu retornado)" : "null (hard failure)"} |
| Latency total (ms) | ${meta.latencyMs} |
| Tokens in | ${meta.tokensIn} |
| Tokens out | ${meta.tokensOut} |
| Warnings | ${warningsBlock.replace(/\n/g, " ")} |
| Schema version | ${real.menu?.schema_version ?? "—"} |

### Warnings detalhados

${warningsBlock}

---

## 5. Verdict humano (Jun)

Por dimensão:

### \`strategic_rationale\`

- [ ] **GO**: producer output ≥ manual quality → substituir fixture
- [ ] **TUNE**: producer output aceitável mas com gaps → ajustar prompt v0.5
- [ ] **NO-GO**: producer output degrada → manter fixture manual

### \`context_hints\`

- [ ] **GO**
- [ ] **TUNE**
- [ ] **NO-GO**

### Items (estrutura + relevance)

- [ ] **GO**
- [ ] **TUNE**
- [ ] **NO-GO**

### Decisão agregada

- [ ] **GO substituir fixtures por CI-generated**
- [ ] **TUNE prompt v0.5** (fixture continua manual até prompt convergir)
- [ ] **NO-GO continuar manual** (producer não é confiável pra skip path em prod)

_Análise qualitativa pelo Jun:_

**Specificity ao perfil ${spec.personaLabel}:**

**Persona-tuning (vocabulário, registro, estratégia):**

**Gaps observados:**

**Recomendação prompt v0.5 (se TUNE):**

---

_Methodology: PoC qualitativo (categoria proposta 2026-05-16) — distinto de
unit/smoke (pass/fail), benchmark (quantitativo). Compara output do
producer real (motor#117 mergeado) contra goldens manuais baked em
fixtures durante dev de motor#115._
`;
}

// ─── Main runner ────────────────────────────────────────────────────────────
async function runOnePersona(spec) {
  console.log(`\n[poc] === Persona: ${spec.personaLabel} ===`);
  console.log(`  profile: ${spec.profileFixture}`);
  console.log(`  manual fixture: ${spec.manualFixture}`);
  console.log(`  prompt version: ${PROMPT_TEMPLATE_VERSION}`);

  const profile = loadProfile(spec);
  const manual = loadManualFixture(spec);

  const warnings = [];
  let lastTokensIn = 0;
  let lastTokensOut = 0;

  const baseCall = makeQwen3LlmCall();
  const wrappedCall = async (sys, user) => {
    console.log(`    Qwen3 call... (system=${sys.length} chars, user=${user.length} chars)`);
    const r = await baseCall(sys, user);
    lastTokensIn += r.tokens.in;
    lastTokensOut += r.tokens.out;
    console.log(`    ✓ ${r.latency_ms}ms, in=${r.tokens.in}, out=${r.tokens.out}`);
    return r;
  };

  const t0 = Date.now();
  let menu = null;
  let fatalError = null;
  try {
    menu = await generateActionMenu(
      {
        personaId: spec.personaId,
        trustLevel: spec.trustLevel,
        profile,
        personaHint: spec.hint,
      },
      {
        llmCall: wrappedCall,
        onWarning: (w) => {
          warnings.push(w.code);
          console.log(`    ⚠ warning: ${w.code} — ${w.message}`);
        },
      },
    );
  } catch (err) {
    fatalError = err;
    console.error(`    ✗ FATAL: ${err.message}`);
  }
  const latencyMs = Date.now() - t0;

  if (fatalError) {
    console.error(`\n[poc] Generator threw: ${fatalError.message}`);
    console.error(fatalError.stack);
  } else if (menu === null) {
    console.error(`\n[poc] Generator returned null (hard failure path). Warnings: ${warnings.join(", ")}`);
  } else {
    console.log(`\n[poc] ✓ Generator returned menu with ${menu.items.length} items`);
    console.log(`  rationale: ${menu.source?.strategic_rationale?.slice(0, 100) ?? "(absent)"}`);
    console.log(`  hints: ${JSON.stringify(menu.source?.context_hints ?? null)}`);
  }

  const md = buildMarkdown(
    spec,
    manual,
    { menu },
    {
      latencyMs,
      tokensIn: lastTokensIn,
      tokensOut: lastTokensOut,
      warnings,
      fatalError: fatalError ? String(fatalError.message) : null,
    },
  );

  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(REPO_ROOT, "docs/handoffs");
  await mkdir(outDir, { recursive: true });
  const mdPath = path.join(
    outDir,
    `${date}-poc-fixture-vs-producer-${spec.personaId}.md`,
  );
  const jsonPath = path.join(
    outDir,
    `${date}-poc-fixture-vs-producer-${spec.personaId}-raw.json`,
  );
  writeFileSync(mdPath, md, "utf-8");
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        spec: { ...spec, hint: spec.hint },
        manual,
        producer: { menu, warnings, latencyMs, tokensIn: lastTokensIn, tokensOut: lastTokensOut, fatalError: fatalError ? String(fatalError.message) : null },
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`\n[poc] Markdown: ${mdPath}`);
  console.log(`[poc] Raw JSON: ${jsonPath}`);

  return { menu, warnings, latencyMs, tokensIn: lastTokensIn, tokensOut: lastTokensOut, mdPath, jsonPath };
}

async function main() {
  const spec = PERSONAS[PERSONA_KEY];
  if (!spec) {
    console.error(`Unknown persona: ${PERSONA_KEY}. Use ryo or paula.`);
    process.exit(2);
  }

  await probeQwen3();
  await runOnePersona(spec);
}

main().catch((err) => {
  console.error("[poc] FATAL:", err);
  process.exit(1);
});
