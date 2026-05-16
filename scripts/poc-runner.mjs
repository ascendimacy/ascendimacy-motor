#!/usr/bin/env node
/**
 * PoC qualitativo — runner reutilizável.
 *
 * Framework para PoCs qualitativos (categoria nova proposta 2026-05-16, distinta
 * de unit/smoke pass/fail e benchmark quantitativo). Produz handoff markdown
 * side-by-side comparando variantes de um campo (ex: rationale baked vs fresh,
 * isa labels A vs B, etc.) com Qwen3 local no drota.
 *
 * Uso (programático):
 *   import { runPoc } from "./poc-runner.mjs";
 *   await runPoc({ pocName, persona, variantNames, setupVariants, selectedContent, handoffSections });
 *
 * Pré-req: Qwen3 stack up em LLM_LOCAL_ENDPOINT.
 *
 * Spec shape (ver runPoc abaixo).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Agent, setGlobalDispatcher } from "undici";

// undici default headersTimeout=300s; Qwen3 30B com prompt grande
// pode demorar +5min até primeira resposta. Bump global.
setGlobalDispatcher(new Agent({ headersTimeout: 600_000, bodyTimeout: 600_000 }));

const ENDPOINT =
  process.env.LLM_LOCAL_ENDPOINT ??
  "http://172.28.160.1:9000/v1/chat/completions";
const MODEL = process.env.LLM_LOCAL_MODEL ?? "qwen3-30b";

// ─── Qwen3 helpers ───────────────────────────────────────────────────────
export async function callQwen3(systemPrompt, userMessage, maxTokens = 600) {
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

export async function probeQwen3() {
  const probe = ENDPOINT.replace("/chat/completions", "/models");
  console.log(`[poc] Probing ${probe}...`);
  const r = await fetch(probe, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Qwen3 offline (HTTP ${r.status})`);
  console.log("  ✓ Qwen3 up");
}

export function parseJsonLoose(raw) {
  try { return JSON.parse(raw); } catch {}
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}

// ─── Dynamic imports of motor-drota internals ────────────────────────────
async function loadDrotaDeps() {
  const { buildDrotaPrompt } = await import("../motor-drota/dist/server.js");
  const { parseDrotaOutput } = await import("../motor-drota/dist/parse-output.js");
  const { rankPool } = await import("../motor-drota/dist/evaluate.js");
  const { selectFromPool } = await import("../motor-drota/dist/select.js");
  return { buildDrotaPrompt, parseDrotaOutput, rankPool, selectFromPool };
}

// ─── Markdown builder ────────────────────────────────────────────────────
function buildMarkdown({ pocName, persona, selectedItem, variants, handoffSections }) {
  const question = handoffSections?.question ?? "(no question provided)";
  const verdictOptions = handoffSections?.verdictOptions ?? ["GO", "TUNE", "NO-GO"];
  const additionalMetrics = handoffSections?.additionalMetrics?.(variants) ?? {};

  // Per-variant setup section (e.g. rationale A baked / B fresh)
  const setupSections = variants
    .map((v) => {
      const lat = v.setupLatencyMs != null ? ` ${v.setupLatencyMs}ms` : "";
      const tin = v.setupTokensIn != null ? `, in=${v.setupTokensIn}` : "";
      const tout = v.setupTokensOut != null ? `, out=${v.setupTokensOut}` : "";
      const heading = `## Variant ${v.name} — ${v.label}${lat || tin || tout ? ` (${lat}${tin}${tout})` : ""}`;
      const body = v.summaryForMarkdown ?? "_(no setup summary)_";
      return `${heading}\n\n${body}`;
    })
    .join("\n\n");

  // Per-variant drota output section
  const outputSections = variants
    .map((v) => {
      const out = v.drotaOutput ?? "[parse_failed]";
      return `### Drota output ${v.name} (${v.label})\n\n> ${out.replace(/\n/g, "\n> ")}\n\n_latency: ${v.drotaLatencyMs}ms; tokens: in=${v.drotaTokensIn}, out=${v.drotaTokensOut}_`;
    })
    .join("\n\n");

  // Metrics table
  const headerRow = `| | ${variants.map((v) => `${v.name} (${v.label})`).join(" | ")} |`;
  const sepRow = `|---|${variants.map(() => "---").join("|")}|`;
  const rows = [
    `| Drota latency (ms) | ${variants.map((v) => v.drotaLatencyMs).join(" | ")} |`,
    `| Drota tokens in | ${variants.map((v) => v.drotaTokensIn).join(" | ")} |`,
    `| Drota tokens out | ${variants.map((v) => v.drotaTokensOut).join(" | ")} |`,
    `| Total LLM calls | ${variants.map((v) => v.llmCallsBefore != null ? v.llmCallsBefore + 1 : 1).join(" | ")} |`,
    `| Total LLM time (ms) | ${variants.map((v) => (v.setupLatencyMs ?? 0) + v.drotaLatencyMs).join(" | ")} |`,
  ];
  for (const [key, vals] of Object.entries(additionalMetrics)) {
    // additionalMetrics is an object: { metricName: "valA | valB" } OR { metricName: [valA, valB] }
    const cells = Array.isArray(vals) ? vals.join(" | ") : vals;
    rows.push(`| ${key} | ${cells} |`);
  }
  const metricsTable = `${headerRow}\n${sepRow}\n${rows.join("\n")}`;

  // Verdict
  const verdictChecks = verdictOptions
    .map((opt) => `- [ ] **${opt}**`)
    .join("\n");

  return `# PoC qualitativo — ${pocName}

**Persona:** ${persona.name} (${persona.id}, age ${persona.age})
**Selected content:** \`${selectedItem.item.id}\` (type=${selectedItem.item.type})
**Drota LLM:** Qwen3 30B local (\`${MODEL}\`)
**Data:** ${new Date().toISOString()}

## Pergunta que este PoC responde

${question}

---

${setupSections}

---

${outputSections}

---

## Métricas objetivas

${metricsTable}

## Verdict humano (Jun)

${verdictChecks}

_Análise qualitativa pelo Jun:_

**Coerência ao perfil de ${persona.name}:**

**Observações pedagógicas:**

---

_Methodology: PoC qualitativo (categoria proposta 2026-05-16) — distinto de unit/smoke (pass/fail), benchmark (quantitativo)_
`;
}

// ─── Main runner ─────────────────────────────────────────────────────────
/**
 * @param {object} spec
 * @param {string} spec.pocName             — e.g. "rationale-quality"
 * @param {object} spec.persona             — { id, name, age, profile }
 * @param {string[]} spec.variantNames      — e.g. ["A_baked", "B_fresh"]
 * @param {function} spec.setupVariants     — async (deps) => Variant[]
 *                                              Variant: { name, label, contextHints,
 *                                                strategicRationale, instruction_addition?,
 *                                                contentPool, summaryForMarkdown?,
 *                                                setupLatencyMs?, setupTokensIn?, setupTokensOut?,
 *                                                llmCallsBefore? }
 * @param {function} spec.selectedContent   — (deps) => ScoredContentItem
 *                                              deps: { variants, rankPool, selectFromPool, persona }
 * @param {object}   spec.handoffSections   — { question, additionalMetrics?, verdictOptions? }
 * @returns {Promise<{ mdPath: string, jsonPath: string, results: object }>}
 */
export async function runPoc(spec) {
  if (!spec?.pocName) throw new Error("spec.pocName required");
  if (!spec?.persona) throw new Error("spec.persona required");
  if (!spec?.setupVariants) throw new Error("spec.setupVariants required");
  if (!spec?.selectedContent) throw new Error("spec.selectedContent required");

  await probeQwen3();

  const { persona } = spec;
  console.log(`[poc] PoC: ${spec.pocName}  Persona: ${persona.name} (${persona.id})`);

  const drotaDeps = await loadDrotaDeps();
  const deps = {
    ...drotaDeps,
    persona,
    callQwen3,
    parseJsonLoose,
  };

  // 1) Setup variants (each provides contextHints + strategicRationale + contentPool)
  console.log(`\n[poc] === Etapa 1: setupVariants ===`);
  const variantsRaw = await spec.setupVariants(deps);
  if (!Array.isArray(variantsRaw) || variantsRaw.length === 0) {
    throw new Error("setupVariants must return non-empty array");
  }
  console.log(`  ✓ ${variantsRaw.length} variants prepared`);

  // 2) Select content (shared across variants — fairness)
  console.log(`\n[poc] === Etapa 2: selectedContent ===`);
  const selected = await spec.selectedContent({ ...deps, variants: variantsRaw });
  if (!selected?.item?.id) throw new Error("selectedContent must return ScoredContentItem with .item.id");
  console.log(`  ✓ Selected: ${selected.item.id} (type=${selected.item.type})`);

  // 3) For each variant, build drota prompt and call Qwen3
  const fakeState = { sessionId: "poc", trustLevel: 0.42, budgetRemaining: 90, turn: 1 };
  const results = [];
  for (let i = 0; i < variantsRaw.length; i++) {
    const v = variantsRaw[i];
    console.log(`\n[poc] === Etapa 3.${i + 1}: drota ${v.name} (${v.label}) ===`);
    const drotaInput = {
      persona,
      state: { ...fakeState, sessionId: `poc-${v.name}` },
      contentPool: v.contentPool,
      contextHints: v.contextHints,
      strategicRationale: v.strategicRationale,
      instruction_addition: v.instruction_addition ?? "",
    };
    const prompt = drotaDeps.buildDrotaPrompt(drotaInput, selected);
    const resp = await callQwen3(prompt, "Materialize o content selecionado em JSON.");
    const parsed = drotaDeps.parseDrotaOutput(resp.content);
    const output = parsed.parsed.linguisticMaterialization ?? "[parse_failed]";
    console.log(`  ✓ ${v.name} (${resp.latency_ms}ms, in=${resp.tokens_in}, out=${resp.tokens_out})`);
    results.push({
      ...v,
      drotaOutput: output,
      drotaLatencyMs: resp.latency_ms,
      drotaTokensIn: resp.tokens_in,
      drotaTokensOut: resp.tokens_out,
      drotaRawContent: resp.content,
    });
  }

  // 4) Build markdown + write
  const md = buildMarkdown({
    pocName: spec.pocName,
    persona,
    selectedItem: selected,
    variants: results,
    handoffSections: spec.handoffSections,
  });

  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve("docs/handoffs");
  await mkdir(outDir, { recursive: true });
  const mdPath = path.join(outDir, `${date}-poc-${spec.pocName}-${persona.id}.md`);
  const jsonPath = path.join(outDir, `${date}-poc-${spec.pocName}-${persona.id}-raw.json`);
  await writeFile(mdPath, md, "utf-8");
  await writeFile(
    jsonPath,
    JSON.stringify(
      { pocName: spec.pocName, persona, selectedItem: selected, variants: results },
      null,
      2,
    ),
    "utf-8",
  );

  console.log("\n" + md);
  console.log(`\n[poc] Markdown: ${mdPath}`);
  console.log(`[poc] Raw JSON: ${jsonPath}`);

  return { mdPath, jsonPath, results };
}
