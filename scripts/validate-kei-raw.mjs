#!/usr/bin/env node
/**
 * Variante do validate-kei-case.mjs que mostra RAW LLM response (pré-parse).
 * Pra distinguir entre "modelo retornou vazio" vs "JSON malformado caindo no fallback".
 */

import OpenAI from "openai";
import {
  SEMANTIC_SIGNALS,
  SIGNAL_DESCRIPTIONS,
} from "../shared/dist/semantic-signals.js";

const args = {
  userMessage: "não preciso ser borboleta, só melhorar o que tem",
  conversationHistoryTail: [
    {
      role: "assistant",
      content:
        "às vezes a gente passa por uma transformação grande, tipo lagarta virando borboleta. já sentiu algo assim?",
    },
    { role: "user", content: "sei lá, acho que não" },
  ],
  personaName: "Kei",
  personaAge: 13,
  trustLevel: 0.4,
};

const signalsList = SEMANTIC_SIGNALS.map(
  (s) => `- ${s}: ${SIGNAL_DESCRIPTIONS[s]}`,
).join("\n");
const historyFmt = args.conversationHistoryTail
  .map((m) => `${m.role === "user" ? args.personaName : "Bot"}: ${m.content}`)
  .join("\n");

const prompt = `Você é um listener semântico. Sua tarefa é detectar signals em mensagem de criança/adolescente respondendo a um bot educacional.

**Importante**: você só CAPTURA, não interpreta nem corrige. Output: lista de signals da taxonomia abaixo presentes na mensagem do sujeito (ou na progressão history → mensagem).

[Sujeito]
nome: ${args.personaName}
idade: ${args.personaAge}
trust_level atual: ${args.trustLevel.toFixed(2)} (0-1)

[História recente (últimas 3 trocas)]
${historyFmt}

[Mensagem do sujeito agora]
${args.userMessage}

[Taxonomia de signals — 15 categorias]
${signalsList}

**Regras**:
1. Só liste signals com evidência clara na mensagem ou progressão. **Quando em dúvida, omita.**
2. Não faça mais de 1 signal por categoria.
3. Considere a história: signals como mood_drift_up/down ou voluntary_topic_deepening exigem comparação com turns anteriores.
4. Se nenhum signal claro, retorne lista vazia.

[Output schema]
Retorne APENAS JSON válido, sem markdown fence:
{
  "signals": ["signal_name_1", "signal_name_2", ...],
  "evidence": {
    "signal_name_1": "trecho da mensagem ou observação curta",
    ...
  },
  "overall_confidence": 0.7
}`;

console.log("=== Prompt size ===");
console.log(`${prompt.length} chars`);
console.log();

const client = new OpenAI({
  apiKey: process.env.INFOMANIAK_API_KEY,
  baseURL: process.env.INFOMANIAK_BASE_URL ?? "https://api.infomaniak.com/2/ai/108102/openai/v1",
});

const model = process.env.SIGNAL_EXTRACTOR_MODEL ?? "mistral3";
console.log(`=== Calling ${model} ===`);
const t0 = Date.now();
const r = await client.chat.completions.create({
  model,
  messages: [{ role: "user", content: prompt }],
  max_tokens: 512,
});
const latency_ms = Date.now() - t0;

const msg = r.choices[0]?.message;
const raw = msg?.content ?? "";
const reasoning = msg?.reasoning;

console.log(`=== Raw content (${raw.length} chars, ${latency_ms}ms) ===`);
console.log(raw);
console.log();
if (reasoning) {
  console.log(`=== Reasoning (${reasoning.length} chars) ===`);
  console.log(reasoning.slice(0, 1500));
  console.log();
}
console.log("=== Usage ===");
console.log(JSON.stringify(r.usage, null, 2));
