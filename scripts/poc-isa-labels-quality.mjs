#!/usr/bin/env node
/**
 * PoC qualitativo — drota usa isaLabels ou ignora?
 *
 * Categoria: PoC qualitativo (ops#1069). Distinto de:
 *   - Unit/Smoke (pass/fail)
 *   - Benchmark (quantitativo: cost, latency)
 *
 * Pergunta empírica:
 *   "ISA labels (played_as, intensity, is_critical) baked em ActionMenuItem
 *    e propagados via ScoredContentItem.isaLabels (motor#109 C-T-10-01)
 *    modulam tom/registro/abordagem do drota, ou drota gera output baseado
 *    APENAS em item.content (i.e., ignora as labels)?"
 *
 * Se ISA labels NÃO influenciam drota → pré-bakeá-los em fixture é teatro
 * caro (zero ROI no path drota).
 * Se influenciam → confirma a investment de propagá-los e justifica
 * potencialmente injetá-los explicitamente no prompt drota futuramente.
 *
 * Descoberta arquitetural (read-only investigation 2026-05-16):
 *   Atualmente `serializeContentItem()` em motor-drota/server.ts NÃO inclui
 *   isaLabels no JSON do <selected_content>/<content_pool>. Eles ficam no
 *   `ScoredContentItem.isaLabels` mas são strip-ados ao montar prompt.
 *   → Este PoC ENRIQUECE manualmente o prompt com bloco <isa_labels>
 *     pra testar SE eles fariam diferença caso fossem propagados.
 *
 * Pré-req: Qwen3 stack up em LLM_LOCAL_ENDPOINT.
 *
 * Uso:
 *   node scripts/poc-isa-labels-quality.mjs [--persona ryo|paula]
 *
 * Tempo: ~10-15min (2 drota calls Qwen3 30B).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(
  new Agent({ headersTimeout: 2_400_000, bodyTimeout: 2_400_000 }),
);

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
  console.log(`[poc] Probing ${probe}...`);
  const r = await fetch(probe, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Qwen3 offline (HTTP ${r.status})`);
  console.log("  ✓ Qwen3 up");
}

/**
 * Variant A enrichment — injeta bloco <isa_labels> no prompt drota.
 *
 * Estratégia: encontra o bloco <selected_content>...</selected_content>
 * e adiciona logo após ele um <isa_labels> com rotulagem pedagógica.
 * Isso simula uma versão futura do serializer que propagasse ISA.
 *
 * Glossário curto incluído pra Qwen3 não precisar adivinhar semântica.
 */
function injectIsaLabels(promptString, isaLabels) {
  const block = `

<isa_labels>
played_as: ${isaLabels.played_as ?? "(none)"}
intensity: ${isaLabels.intensity ?? "(none)"}
is_critical: ${isaLabels.is_critical ?? false}
</isa_labels>

<isa_labels_glossary>
- played_as: que jogada pedagógica esse content executa.
  - bridge: conecta interesse da criança ao tema. Tom: leve, convidativo.
  - espelho: devolve à criança o que ela disse. Tom: receptivo, sem julgamento.
  - canal: abre pergunta dirigida. Tom: focado, exploratório.
  - diamante: âncora cultural densa (citação, prática tradicional). Tom: contemplativo, ponderado, com peso.
  - arena: convida confronto produtivo. Tom: firme, desafiador.
  - recovery: pausa pedagógica, guardrail. Tom: cuidadoso, suave.
- intensity: peso da intervenção.
  - soft: leve, baixa fricção.
  - medium: presença sem força.
  - firm: postura clara, não recua. Pode discordar/desafiar respeitosamente.
- is_critical: se true, materialização tem peso pedagógico alto — evite trivializar.
</isa_labels_glossary>`;

  // Inserir após o <selected_content>...</selected_content>
  const idx = promptString.indexOf("</selected_content>");
  if (idx === -1) {
    // Fallback — anexa antes de [BLOCO 3]
    const block3Idx = promptString.indexOf("[BLOCO 3 - Numbered instructions]");
    if (block3Idx === -1) return promptString + block;
    return (
      promptString.slice(0, block3Idx) +
      block +
      "\n\n" +
      promptString.slice(block3Idx)
    );
  }
  const insertAt = idx + "</selected_content>".length;
  return promptString.slice(0, insertAt) + block + promptString.slice(insertAt);
}

async function main() {
  await probeQwen3();

  const persona = PERSONAS[PERSONA_KEY];
  if (!persona) throw new Error(`unknown persona: ${PERSONA_KEY}`);
  console.log(`[poc] Persona: ${persona.name} (${persona.id})`);

  process.env.ASC_USE_ACTION_MENU = "true";
  process.env.ASC_ACTION_MENU_BASE_DIR = "fixtures/profiles";

  // Imports após env vars (mesmo padrão de poc-rationale-quality.mjs)
  const { lookupActionMenu } = await import(
    "../planejador/dist/strategist/menu-lookup.js"
  );
  const { buildDrotaPrompt } = await import("../motor-drota/dist/server.js");
  const { parseDrotaOutput } = await import(
    "../motor-drota/dist/parse-output.js"
  );
  const { rankPool } = await import("../motor-drota/dist/evaluate.js");

  console.log("\n[poc] === Etapa 1: lookup menu + escolha item com ISA rico ===");
  const menuResult = await lookupActionMenu(persona.id, "fixtures/profiles", {
    topK: 5,
    bypassCache: true,
  });
  if (menuResult.outcome !== "ok") {
    throw new Error(`menu lookup failed: outcome=${menuResult.outcome}`);
  }
  const bakedRationale = menuResult.source?.strategic_rationale ?? "";
  const bakedHints = menuResult.source?.context_hints ?? { language: "pt-br" };

  // Pega item com ISA labels OBVIAMENTE não-default. Preferência:
  //   1. cultural_diamond + played_as=diamante + intensity=firm (forte assinatura)
  //   2. recovery (qualquer)
  //   3. arena + firm
  //   4. fallback: primeiro item com isaLabels populados
  const scored = menuResult.items;
  const ranked = rankPool(scored);
  const candidate =
    ranked.find(
      (s) =>
        s.isaLabels?.played_as === "diamante" &&
        s.isaLabels?.intensity === "firm",
    ) ??
    ranked.find((s) => s.isaLabels?.played_as === "recovery") ??
    ranked.find(
      (s) =>
        s.isaLabels?.played_as === "arena" && s.isaLabels?.intensity === "firm",
    ) ??
    ranked.find((s) => s.isaLabels?.played_as && s.isaLabels?.intensity);

  if (!candidate) {
    throw new Error(
      `nenhum item com isaLabels populados no menu ${persona.id}`,
    );
  }

  const isaLabelsFull = candidate.isaLabels ?? {};
  console.log(`  Selected item: ${candidate.item.id} (type=${candidate.item.type})`);
  console.log(
    `  ISA labels: played_as=${isaLabelsFull.played_as}, intensity=${isaLabelsFull.intensity}, is_critical=${isaLabelsFull.is_critical}`,
  );

  // Etapa 2: build prompts. Mesma persona/state/contentPool/rationale.
  // Diferença: Variant A enriquece prompt com <isa_labels> + glossário.
  //            Variant B usa prompt cru (como hoje em produção).
  const baseDrotaInput = {
    persona,
    state: {
      sessionId: "poc-isa",
      trustLevel: 0.42,
      budgetRemaining: 90,
      turn: 1,
    },
    contentPool: scored,
    contextHints: bakedHints,
    strategicRationale: bakedRationale,
    instruction_addition: "",
  };

  const promptCru = buildDrotaPrompt(baseDrotaInput, candidate);
  const promptComIsa = injectIsaLabels(promptCru, isaLabelsFull);

  console.log("\n[poc] === Etapa 2: drota A (COM isaLabels injetadas) ===");
  console.log(`  Prompt size: ${promptComIsa.length} chars`);
  const drotaA = await callQwen3(
    promptComIsa,
    "Materialize o content selecionado em JSON.",
  );
  const parsedA = parseDrotaOutput(drotaA.content);
  console.log(
    `  ✓ Drota A (${drotaA.latency_ms}ms, in=${drotaA.tokens_in}, out=${drotaA.tokens_out})`,
  );

  console.log("\n[poc] === Etapa 3: drota B (SEM isaLabels — baseline atual) ===");
  console.log(`  Prompt size: ${promptCru.length} chars`);
  const drotaB = await callQwen3(
    promptCru,
    "Materialize o content selecionado em JSON.",
  );
  const parsedB = parseDrotaOutput(drotaB.content);
  console.log(
    `  ✓ Drota B (${drotaB.latency_ms}ms, in=${drotaB.tokens_in}, out=${drotaB.tokens_out})`,
  );

  const outputA = parsedA.parsed?.linguisticMaterialization ?? "[parse_failed]";
  const outputB = parsedB.parsed?.linguisticMaterialization ?? "[parse_failed]";
  const rationaleA = parsedA.parsed?.selectionRationale ?? "[parse_failed]";
  const rationaleB = parsedB.parsed?.selectionRationale ?? "[parse_failed]";

  const md = `# PoC qualitativo — ISA labels: drota usa ou ignora? (ops#1069 follow-up)

**Persona:** ${persona.name} (${persona.id}, age ${persona.age})
**Selected content:** \`${candidate.item.id}\` (type=${candidate.item.type})
**ISA labels do item:** \`played_as=${isaLabelsFull.played_as}\`, \`intensity=${isaLabelsFull.intensity}\`, \`is_critical=${isaLabelsFull.is_critical}\`
**Item content:** ${typeof candidate.item.fact === "string" ? candidate.item.fact : JSON.stringify(candidate.item).slice(0, 200)}
**Drota LLM:** Qwen3 30B local (\`${MODEL}\`)
**Data:** ${new Date().toISOString()}

## Pergunta que este PoC responde

"ISA labels (\`played_as\`, \`intensity\`, \`is_critical\`) baked em \`ActionMenuItem\` e propagados via \`ScoredContentItem.isaLabels\` (motor#109 C-T-10-01) **modulam de fato** o tom/registro/abordagem do drota, ou drota gera output baseado APENAS em \`item.content\` (i.e., as labels são teatro caro)?"

Se ISA labels NÃO influenciam drota → pré-bakeá-los em fixture entrega valor zero no path drota.
Se influenciam → confirma a investment de propagá-los e justifica injetá-los explicitamente no prompt drota (gap detectado: hoje \`serializeContentItem\` strip-a as labels).

---

## Descoberta arquitetural (read-only investigation 2026-05-16)

Inspecionando \`motor-drota/src/server.ts\` (\`serializeContentItem\` + \`buildDrotaDynamicBody\`):

- \`serializeContentItem\` produz JSON com \`{id, type, domain, casel_target, surprise, age_range, group_compatible, ...type_specific_fields}\` — **sem \`isaLabels\`**.
- \`buildDrotaDynamicBody\` constrói \`contentPool\` serializado como \`{score, reasons, content}\` — também sem isaLabels.
- \`<selected_content>\` recebe apenas o JSON do item — sem isaLabels.

→ **No estado atual, as ISA labels populadas em \`ScoredContentItem.isaLabels\` pelo \`menu-lookup\` (motor#109) NÃO chegam ao prompt drota.** São strip-adas na serialização.

Este PoC compara:

- **Variant A**: prompt enriquecido manualmente com bloco \`<isa_labels>\` + glossário (simula versão futura do serializer que propagasse ISA).
- **Variant B**: prompt cru (estado atual de produção — labels invisíveis ao LLM).

Se A ≠ B qualitativamente → vale modificar \`serializeContentItem\` pra propagar.
Se A ≈ B → labels não fariam diferença mesmo sendo propagadas (drota ignora rótulos pedagógicos).

---

## Variant A — drota COM isaLabels injetadas no prompt

### Selection rationale (A)

> ${rationaleA.replace(/\n/g, "\n> ")}

### Linguistic materialization (A)

> ${outputA.replace(/\n/g, "\n> ")}

_latency: ${drotaA.latency_ms}ms; tokens: in=${drotaA.tokens_in}, out=${drotaA.tokens_out}_

## Variant B — drota SEM isaLabels (baseline atual produção)

### Selection rationale (B)

> ${rationaleB.replace(/\n/g, "\n> ")}

### Linguistic materialization (B)

> ${outputB.replace(/\n/g, "\n> ")}

_latency: ${drotaB.latency_ms}ms; tokens: in=${drotaB.tokens_in}, out=${drotaB.tokens_out}_

---

## Métricas objetivas

| | A (com ISA) | B (sem ISA) |
|---|---|---|
| Prompt chars | ${promptComIsa.length} | ${promptCru.length} |
| Drota latency | ${drotaA.latency_ms}ms | ${drotaB.latency_ms}ms |
| Drota tokens in | ${drotaA.tokens_in} | ${drotaB.tokens_in} |
| Drota tokens out | ${drotaA.tokens_out} | ${drotaB.tokens_out} |

ISA labels glossário adiciona ${promptComIsa.length - promptCru.length} chars (~+${Math.round(((promptComIsa.length - promptCru.length) / promptCru.length) * 100)}%).

---

## Verdict humano (Jun)

- [ ] **GO** — ISA labels modulam visivelmente o output. Investment vale. Próximo passo: estender \`serializeContentItem\` pra propagar isaLabels ao prompt drota (motor PR).
- [ ] **TUNE** — Diferença existe mas é sutil/inconsistente. Refinar glossário ou pesar mais explicitamente no prompt (e.g., instrução numerada citando played_as).
- [ ] **NO-GO** — Drota ignora isaLabels mesmo quando explícitas. Pré-bakeá-las é teatro caro no path drota. Considerar manter só pra benchmark/analytics e não propagar.

### Análise qualitativa Jun

**Drota usou \`played_as=${isaLabelsFull.played_as}\` (citou termo OU adotou tom correspondente)?**

_..._

**Tom mudou entre A e B? (cadência, peso, registro)**

_..._

**Vocabulário diferente? (palavras-chave reveladoras de "${isaLabelsFull.played_as}" ou "${isaLabelsFull.intensity}")**

_..._

**\`intensity=${isaLabelsFull.intensity}\` se manifestou em postura (firmeza vs leveza)?**

_..._

**\`is_critical=${isaLabelsFull.is_critical}\` afetou peso da materialização?**

_..._

**Coerência ao perfil de ${persona.name}:**

_..._

**Observações pedagógicas:**

_..._

---

## Refs

- Spec parent: [ops#1069](https://github.com/ascendimacy/ascendimacy-ops/issues/1069) (PoC qualitativo como categoria nova)
- ISA labels ratification: ops#999 H-AC-02
- Propagation impl: motor#109 (C-T-10-01)
- Methodology comparison: \`scripts/poc-rationale-quality.mjs\` (rationale Baked vs Fresh)
- Depends-on: motor#115 (skip rationale LLM — base branch \`feat/ops-1069-skip-rationale-llm\`)
`;

  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve("docs/handoffs");
  await mkdir(outDir, { recursive: true });
  const mdPath = path.join(
    outDir,
    `${date}-poc-isa-labels-quality-${persona.id}.md`,
  );
  await writeFile(mdPath, md, "utf-8");

  console.log("\n" + md);
  console.log(`\n[poc] Markdown: ${mdPath}`);
}

main().catch((err) => {
  console.error("[poc] FATAL:", err);
  process.exit(1);
});
