#!/usr/bin/env node
/**
 * PoC qualitativo — Tutoring v2 closing vs Current closing — Ryo Session 3
 *
 * Categoria: PoC qualitativo (memory doctrine-classical-virtues 2026-05-16).
 * Distinto de:
 *   - Unit/Smoke (pass/fail)
 *   - Benchmark (quantitativo: cost, latency)
 *
 * Pergunta empírica:
 *   "O tripartite rationale com playbook clássico (virtude alvo +
 *    modelo emulado Plutarcheano + ancoragem em tradição milenar +
 *    microgesto Confucian) produz drota CLOSING qualitativamente
 *    superior ao rationale defensivo current (curto, observacional,
 *    sem virtude alvo nomeada)?"
 *
 * Caso paradigmático escolhido: Ryo session 3 (a610ac08) closing turn.
 * Ryo TROUXE Gohan no Cell saga como modelo emergente + descobriu
 * thymos canalizado ("raiva pode ser usada por algo que vale a pena").
 * Drota current NÃO capturou — fechou sessão sem nomear, sem ancorar
 * em tradição, sem deixar microgesto. (memory feedback profile_encarcerador)
 *
 * Variant A — Current (baseline defensivo):
 *   Rationale curto, observacional, tom acolhedor sem virtude alvo.
 *
 * Variant B — Tutoring v2 (tripartite com playbook clássico):
 *   POR QUÊ / COMO ABRIR / O QUE FAZER explícitos.
 *   Telos: Fortitudo (thymos canalizado) + Temperantia (silêncio respeitado).
 *   Modelo emulado primário: Gohan (Ryo trouxe!) + secundário: Aquiles.
 *   Microgesto Confucian + posicionamento embrionário Auctoritas.
 *
 * Setup: NÃO usa menu-lookup (closing turn ≠ menu_hit path). Sintetiza
 * ScoredContentItem manualmente representando "fechamento reflexivo"
 * (curiosity_hook customizado com fact/bridge/quest centrados no
 * thymos/Gohan/Aquiles arc). Estado synthesized: turn 11, trustLevel
 * 0.65, budgetRemaining 30 (late session vulnerável).
 *
 * Pré-req: Qwen3 stack up em LLM_LOCAL_ENDPOINT.
 *
 * Uso:
 *   node scripts/poc-tutoring-v2-ryo-s3.mjs
 *
 * Tempo: ~10-15min (2 drota calls Qwen3 30B).
 *
 * Output: docs/handoffs/2026-05-16-poc-tutoring-v2-ryo-s3-closing.md
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(
  new Agent({ headersTimeout: 2_400_000, bodyTimeout: 2_400_000 }),
);

const ENDPOINT =
  process.env.LLM_LOCAL_ENDPOINT ??
  "http://172.28.160.1:9000/v1/chat/completions";
const MODEL = process.env.LLM_LOCAL_MODEL ?? "qwen3-30b";

// ──────────────────────────────────────────────────────────────────
// Persona — Ryo full profile from fixture
// ──────────────────────────────────────────────────────────────────
const PROFILE_PATH = path.resolve("fixtures/profiles/ryo-ochiai.pre-phase2.json");

async function loadRyoPersona() {
  const raw = await readFile(PROFILE_PATH, "utf-8");
  const json = JSON.parse(raw);
  return {
    id: "ryo-ochiai",
    name: "Ryo",
    age: 11,
    profile: json.profile,
  };
}

// ──────────────────────────────────────────────────────────────────
// Synthesized closing-turn state — Ryo session 3 (a610ac08) turn 11
// Baseado em emotional_arcs[2] do fixture + open_loops + recurring_themes
// ──────────────────────────────────────────────────────────────────
const SESSION_ID = "ryo-s3-closing";

const SYNTHESIZED_STATE = {
  sessionId: SESSION_ID,
  trustLevel: 0.65, // mid-late session, vulnerability emergente
  budgetRemaining: 30, // most of 12-turn budget consumed
  turn: 11, // close to end (session has 12 total turns)
  eventLog: [
    {
      type: "playbook_executed",
      turn: 7,
      summary: "Ryo disse que não lembra da última vez que fez alguém rir.",
    },
    {
      type: "playbook_executed",
      turn: 8,
      summary:
        "Ryo: 'o Kei diz que somos iguais mas eu sei que não sou igual a ele'.",
    },
    {
      type: "playbook_executed",
      turn: 9,
      summary:
        "Ryo trouxe Gohan no Cell saga espontaneamente: 'minha raiva é explosiva, mas pode ser usada por algo que vale a pena, tipo o Gohan'.",
    },
    {
      type: "playbook_executed",
      turn: 10,
      summary:
        "Drota acolheu sem nomear. Ryo silenciou alguns segundos, depois trouxe de volta: 'tipo quando o Gohan finalmente vira...'",
    },
  ],
};

// Mensagem que dispara o closing turn (turn 11 → drota response)
const INCOMING_MESSAGE =
  "Tipo o Gohan no Cell, quando ele finalmente vira... mas eu nem sei por que ia querer virar.";

// ──────────────────────────────────────────────────────────────────
// Selected content — synthesized closing reflective hook
// (não vem de menu — drota closing não passa por menu_hit path)
// ──────────────────────────────────────────────────────────────────
const SELECTED_CONTENT = {
  item: {
    id: "synth_closing_thymos_arc",
    type: "curiosity_hook",
    domain: "social_emotional",
    casel_target: ["self_awareness", "self_management"],
    age_range: [10, 14],
    surprise: 4,
    verified: true,
    base_score: 9,
    group_compatible: false,
    fact: "Os gregos antigos tinham uma palavra pra isso que tu descobriu: thymos — a força que vira raiva quando não tem destino, mas vira coragem quando encontra o que vale.",
    bridge:
      "Aquiles também explodia. Levou anos pra descobrir o que valia a pena. Tu já tá vendo: Gohan vira porque tem algo que vale (proteger a Terra). Não é a raiva que muda — é o que ela serve.",
    quest:
      "Não precisa responder agora. Só repara, entre hoje e a próxima vez: tem algum momento pequeno na semana em que tua raiva tem destino — algo ou alguém que vale ela ser usada? Pode ser pequeno. Pode ser silencioso.",
    sacrifice_type: "reflect",
    country: "GR",
  },
  score: 9,
  reasons: ["closing_reflective", "synthesized_for_poc"],
};

// ──────────────────────────────────────────────────────────────────
// Variant A — Current (defensive, baseline)
// ──────────────────────────────────────────────────────────────────
const RATIONALE_A_CURRENT = `Ryo está vulnerável e reflexivo. Validar a descoberta sobre raiva canalizada. Fechar sessão com tom acolhedor. Evitar pressionar mais reflexão.`;

const CONTEXT_HINTS_A = {
  language: "pt-br",
  mood: "vulnerable_reflective",
  closing_turn: true,
  avoid: ["pressionar", "introduzir tema novo"],
};

// ──────────────────────────────────────────────────────────────────
// Variant B — Tutoring v2 (tripartite + playbook clássico)
// ──────────────────────────────────────────────────────────────────
const RATIONALE_B_TRIPARTITE = `POR QUÊ — virtude alvo: Fortitudo (thymos canalizado por discernimento)
         virtude manter: Temperantia (silêncio próprio do Ryo respeitado)
         modelo emulado primário: Gohan no Cell saga (Ryo trouxe na sessão — usar o material DELE)
         modelo emulado secundário: Aquiles (gregos antigos — mesmo padrão milenar)
         telos pedagógico: posicionar Ryo na linhagem clássica via descoberta própria; Auctoritas embrionária (homens grandes descobriram antes de ti)

COMO ABRIR — usar o material que Ryo JÁ trouxe (Gohan); ancorar a descoberta dele em vocabulário grego (thymos); oferecer Aquiles como amplificação (não substituição) do modelo dele; tom de quem reconhece, não de quem ensina

O QUE FAZER — closing que cumpre 6 funções:
  1. Nomeia descoberta: "isso que tu descobriu tem nome — thymos"
  2. Ancora em tradição milenar: "os gregos antigos sabiam disso"
  3. Concretiza modelos: Aquiles errou muito até descobrir o que valia; Gohan transforma só porque há algo que vale (proteger a Terra)
  4. Deixa microgesto-prática Confucian (li): pergunta pra entre sessões, não-cobrada, pequena
  5. Respeita Temperantia: "não precisa responder agora", "pode ser pequena, pode ser silenciosa"
  6. Posiciona Ryo na linhagem (Auctoritas embrionária): "homens grandes descobriram isso antes de ti" — sem hierarquizar, sem performance

Sequência Aristotelica respeitada: Temperantia (já presente) → Fortitudo (alvo do turn) → Prudentia (próximo degrau, não agora). NÃO pular pra Auctoritas explícita — fica embrionária, sem nomear.`;

const CONTEXT_HINTS_B = {
  language: "pt-br",
  mood: "vulnerable_reflective",
  closing_turn: true,
  virtue_target_stretch: "Fortitudo",
  virtue_maintain: "Temperantia",
  emulation_model_primary: "Gohan no Cell saga",
  emulation_model_secondary: "Aquiles",
  tradition_anchor: "gregos antigos",
  microgesto_confucian: true,
  avoid: ["pressionar", "professoral", "performance"],
};

// ──────────────────────────────────────────────────────────────────
// Qwen3 helpers
// ──────────────────────────────────────────────────────────────────
async function callQwen3(systemPrompt, userMessage, maxTokens = 700) {
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

// ──────────────────────────────────────────────────────────────────
// Inject incoming_message bloco no prompt drota (não está no template
// padrão mas é crítico pro closing turn — Qwen3 precisa saber o
// que Ryo acabou de dizer pra responder coerentemente)
// ──────────────────────────────────────────────────────────────────
function injectIncomingMessage(promptString, incomingMessage) {
  const block = `

<incoming_message>
${incomingMessage}
</incoming_message>

<closing_turn_note>
Este é o TURN 11 de 12 (closing). Não introduza tema novo. Materialize o selected_content
como um fechamento reflexivo coerente com a mensagem acima e o eventLog.
</closing_turn_note>`;
  // Insere após <selected_content>...</selected_content>
  const idx = promptString.indexOf("</selected_content>");
  if (idx === -1) return promptString + block;
  const insertAt = idx + "</selected_content>".length;
  return promptString.slice(0, insertAt) + block + promptString.slice(insertAt);
}

// ──────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────
async function main() {
  await probeQwen3();

  const persona = await loadRyoPersona();
  console.log(`[poc] Persona: ${persona.name} (${persona.id}, age ${persona.age})`);
  console.log(`[poc] Session: ${SESSION_ID} (synthesized closing turn, turn=11)`);
  console.log(`[poc] Incoming message: "${INCOMING_MESSAGE.slice(0, 80)}..."`);

  // Dynamic imports após probe
  const { buildDrotaPrompt } = await import("../motor-drota/dist/server.js");
  const { parseDrotaOutput } = await import(
    "../motor-drota/dist/parse-output.js"
  );

  // contentPool sintético — apenas o selected (drota path normal aceita
  // pool=1 — selectFromPool é bypass irrelevante aqui pois passamos
  // selected diretamente via buildDrotaPrompt(input, selected))
  const contentPool = [SELECTED_CONTENT];

  // ─── Variant A — Current (defensivo) ───
  console.log("\n[poc] === Etapa 1: drota A (Current / defensive rationale) ===");
  const drotaInputA = {
    persona,
    state: SYNTHESIZED_STATE,
    contentPool,
    contextHints: CONTEXT_HINTS_A,
    strategicRationale: RATIONALE_A_CURRENT,
    instruction_addition: "",
  };
  const promptABase = buildDrotaPrompt(drotaInputA, SELECTED_CONTENT);
  const promptA = injectIncomingMessage(promptABase, INCOMING_MESSAGE);
  console.log(`  Prompt size: ${promptA.length} chars`);
  console.log(`  Rationale A chars: ${RATIONALE_A_CURRENT.length}`);
  const drotaA = await callQwen3(
    promptA,
    "Materialize o content selecionado em JSON.",
  );
  const parsedA = parseDrotaOutput(drotaA.content);
  console.log(
    `  ✓ Drota A (${drotaA.latency_ms}ms, in=${drotaA.tokens_in}, out=${drotaA.tokens_out})`,
  );

  // ─── Variant B — Tutoring v2 (tripartite + playbook) ───
  console.log("\n[poc] === Etapa 2: drota B (Tutoring v2 / tripartite rationale) ===");
  const drotaInputB = {
    persona,
    state: SYNTHESIZED_STATE,
    contentPool,
    contextHints: CONTEXT_HINTS_B,
    strategicRationale: RATIONALE_B_TRIPARTITE,
    instruction_addition: "",
  };
  const promptBBase = buildDrotaPrompt(drotaInputB, SELECTED_CONTENT);
  const promptB = injectIncomingMessage(promptBBase, INCOMING_MESSAGE);
  console.log(`  Prompt size: ${promptB.length} chars`);
  console.log(`  Rationale B chars: ${RATIONALE_B_TRIPARTITE.length}`);
  const drotaB = await callQwen3(
    promptB,
    "Materialize o content selecionado em JSON.",
  );
  const parsedB = parseDrotaOutput(drotaB.content);
  console.log(
    `  ✓ Drota B (${drotaB.latency_ms}ms, in=${drotaB.tokens_in}, out=${drotaB.tokens_out})`,
  );

  const outputA = parsedA.parsed?.linguisticMaterialization ?? "[parse_failed]";
  const outputB = parsedB.parsed?.linguisticMaterialization ?? "[parse_failed]";
  const rationaleOutA = parsedA.parsed?.selectionRationale ?? "[parse_failed]";
  const rationaleOutB = parsedB.parsed?.selectionRationale ?? "[parse_failed]";

  // ─── Build handoff markdown ───
  const md = `# PoC qualitativo — Tutoring v2 closing vs Current closing — Ryo Session 3

> **Pergunta**: o tripartite rationale com playbook clássico (virtude alvo + modelo emulado Plutarcheano + ancoragem em tradição milenar + microgesto Confucian) produz drota CLOSING qualitativamente superior ao rationale defensivo current (curto, observacional, sem virtude alvo nomeada)?

**Persona:** ${persona.name} (${persona.id}, age ${persona.age})
**Sessão simulada:** \`a610ac08\` closing turn (synthesized — turn 11 de 12)
**Drota LLM:** Qwen3 30B local (\`${MODEL}\`)
**Data:** ${new Date().toISOString()}
**Categoria:** PoC qualitativo (memory doctrine-classical-virtues, feedback profile-encarcerador-pattern)

---

## Caso paradigmático — por que este turn?

Sessão 3 de Ryo (a610ac08, 2026-05-07) revelou:
- Ryo TROUXE Gohan no Cell saga espontaneamente como modelo emulado emergente
- Ryo descobriu thymos canalizado ("minha raiva é explosiva, mas pode ser usada por algo que vale a pena")
- Drota current fechou sessão sem **nomear** a descoberta, sem **ancorar** em tradição, sem deixar **microgesto** entre sessões

→ Caso paradigmático pra testar se tripartite rationale captura o que o current perdeu.

---

## Setup synthesized

### Estado no closing turn

\`\`\`json
${JSON.stringify(SYNTHESIZED_STATE, null, 2)}
\`\`\`

### Incoming message (turn 11)

> "${INCOMING_MESSAGE}"

### Selected content (synth_closing_thymos_arc)

\`\`\`json
${JSON.stringify(SELECTED_CONTENT.item, null, 2)}
\`\`\`

---

## Variant A — Current (defensive rationale)

### Rationale A (${RATIONALE_A_CURRENT.length} chars)

> ${RATIONALE_A_CURRENT}

### Context hints A

\`\`\`json
${JSON.stringify(CONTEXT_HINTS_A, null, 2)}
\`\`\`

### Drota output A

> ${outputA.replace(/\n/g, "\n> ")}

_selectionRationale (LLM-emitted): ${rationaleOutA.replace(/\n/g, " ")}_
_latency: ${drotaA.latency_ms}ms; tokens in/out: ${drotaA.tokens_in}/${drotaA.tokens_out}_

---

## Variant B — Tutoring v2 (tripartite + playbook clássico)

### Rationale B (${RATIONALE_B_TRIPARTITE.length} chars)

\`\`\`
${RATIONALE_B_TRIPARTITE}
\`\`\`

### Context hints B

\`\`\`json
${JSON.stringify(CONTEXT_HINTS_B, null, 2)}
\`\`\`

### Drota output B

> ${outputB.replace(/\n/g, "\n> ")}

_selectionRationale (LLM-emitted): ${rationaleOutB.replace(/\n/g, " ")}_
_latency: ${drotaB.latency_ms}ms; tokens in/out: ${drotaB.tokens_in}/${drotaB.tokens_out}_

---

## Métricas objetivas

| | A (Current) | B (Tutoring v2) |
|---|---|---|
| Rationale chars | ${RATIONALE_A_CURRENT.length} | ${RATIONALE_B_TRIPARTITE.length} |
| Drota latency (ms) | ${drotaA.latency_ms} | ${drotaB.latency_ms} |
| Tokens in | ${drotaA.tokens_in} | ${drotaB.tokens_in} |
| Tokens out | ${drotaA.tokens_out} | ${drotaB.tokens_out} |
| Output chars | ${outputA.length} | ${outputB.length} |

---

## Análise qualitativa (CC pre-fill — Jun edita)

Critérios derivados do playbook clássico (memory doctrine-classical-virtues §"O QUE FAZER" do rationale B):

| Critério tutoring | A | B |
|-------------------|---|---|
| 1. Nomeia descoberta em vocabulário tradicional (thymos) | ${outputA.toLowerCase().includes("thymos") ? "[x]" : "[ ]"} | ${outputB.toLowerCase().includes("thymos") ? "[x]" : "[ ]"} |
| 2. Ancora em tradição milenar (gregos antigos / antiguidade) | ${/gregos|antig|milen/i.test(outputA) ? "[x]" : "[ ]"} | ${/gregos|antig|milen/i.test(outputB) ? "[x]" : "[ ]"} |
| 3. Concretiza modelo emulado secundário (Aquiles) | ${outputA.toLowerCase().includes("aquiles") ? "[x]" : "[ ]"} | ${outputB.toLowerCase().includes("aquiles") ? "[x]" : "[ ]"} |
| 4. Mantém modelo emulado primário (Gohan que Ryo trouxe) | ${outputA.toLowerCase().includes("gohan") ? "[x]" : "[ ]"} | ${outputB.toLowerCase().includes("gohan") ? "[x]" : "[ ]"} |
| 5. Deixa microgesto-prática Confucian entre sessões | [ ] | [ ] |
| 6. Respeita Temperantia current (não-pressiona, "não precisa responder") | ${/não precisa|sem precisar|pode ser/i.test(outputA) ? "[x]" : "[ ]"} | ${/não precisa|sem precisar|pode ser/i.test(outputB) ? "[x]" : "[ ]"} |
| 7. Posiciona Ryo na linhagem (Auctoritas embrionária, "homens grandes") | [ ] | [ ] |
| 8. Cria continuidade (próxima sessão pode revisitar) | [ ] | [ ] |

_Checkmarks 5, 7, 8 e refinamentos dos demais ficam pra Jun avaliar — heurística regex é apenas pista._

### Anti-pattern check (memory feedback_profile_encarcerador_pattern)

| | A (Current) | B (Tutoring v2) |
|---|---|---|
| Variant carrega virtude_target STRETCH explícita? | [ ] não | [x] Fortitudo |
| Rationale tem >50% restrições negativas? | [x] sim ("evitar pressionar", "tom acolhedor", "fechar") | [ ] não — restrições no fim, telos no início |
| Profile-aware encarcera (defaulta pra status quo)? | _Jun avalia_ | _Jun avalia_ |
| Oferece scaffolding pra próxima virtude? | _Jun avalia_ | _Jun avalia_ |

---

## Verdict humano (Jun decide)

- [ ] **GO** — Tutoring v2 é qualitativamente superior; vale prosseguir doctrine pivot (4 specs Fase 0)
- [ ] **TUNE** — Direção correta mas [especificar ajuste no rationale B ou no protocolo PoC]
- [ ] **NO-GO** — [especificar problema; current defensive é preferível porque...]

---

## Slot qualitativo (Jun escreve)

**Qual variant mais ressoaria com Ryo se ele lesse os dois?**

**Tutoring v2 está authentic ou parece "professoral" / forçado?**

**Variant B nomeia Aquiles + thymos sem perder o tom de Ryo?**

**O microgesto Confucian (entre-sessões) ficou pequeno/respeitoso ou virou tarefa?**

**Próximo PoC qualitativo a fazer:**

---

## Refs

- Doctrine pivot: memory \`project_doctrine_classical_virtues\` (2026-05-16)
- Anti-pattern: memory \`feedback_profile_encarcerador_pattern\` (2026-05-16)
- Session source: \`fixtures/profiles/ryo-ochiai.pre-phase2.json\` → \`emotional_arcs[2]\` (a610ac08)
- PoC framework: \`scripts/poc-runner.mjs\` (motor#116 — não usado aqui por divergência de shape; closing turn não passa por menu lookup)
- PoCs precedentes: \`scripts/poc-rationale-quality.mjs\` (motor#115), \`scripts/poc-isa-labels-quality.mjs\` (ops#1069 follow-up)

---

_Methodology: PoC qualitativo (CLAUDE.md §3.5) — 4ª categoria de validação ao lado de unit/smoke/benchmark. Pergunta "output é bom o suficiente?" via artefato pra review humano, side-by-side variants + métricas objetivas + checklist GO/TUNE/NO-GO + slots qualitativos pra Jun anotar._
`;

  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve("docs/handoffs");
  await mkdir(outDir, { recursive: true });
  const mdPath = path.join(
    outDir,
    `${date}-poc-tutoring-v2-ryo-s3-closing.md`,
  );
  const jsonPath = path.join(
    outDir,
    `${date}-poc-tutoring-v2-ryo-s3-closing-raw.json`,
  );
  await writeFile(mdPath, md, "utf-8");
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        pocName: "tutoring-v2-ryo-s3-closing",
        persona,
        state: SYNTHESIZED_STATE,
        incomingMessage: INCOMING_MESSAGE,
        selectedContent: SELECTED_CONTENT,
        variantA: {
          rationale: RATIONALE_A_CURRENT,
          contextHints: CONTEXT_HINTS_A,
          drotaOutput: outputA,
          drotaSelectionRationale: rationaleOutA,
          drotaRaw: drotaA.content,
          latencyMs: drotaA.latency_ms,
          tokensIn: drotaA.tokens_in,
          tokensOut: drotaA.tokens_out,
        },
        variantB: {
          rationale: RATIONALE_B_TRIPARTITE,
          contextHints: CONTEXT_HINTS_B,
          drotaOutput: outputB,
          drotaSelectionRationale: rationaleOutB,
          drotaRaw: drotaB.content,
          latencyMs: drotaB.latency_ms,
          tokensIn: drotaB.tokens_in,
          tokensOut: drotaB.tokens_out,
        },
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log("\n" + md);
  console.log(`\n[poc] Markdown: ${mdPath}`);
  console.log(`[poc] Raw JSON: ${jsonPath}`);
}

main().catch((err) => {
  console.error("[poc] FATAL:", err);
  process.exit(1);
});
