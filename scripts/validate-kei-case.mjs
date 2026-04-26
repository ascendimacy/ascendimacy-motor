#!/usr/bin/env node
/**
 * Gate A — valida Signal Extractor contra o caso Kei "não preciso ser borboleta".
 *
 * Caso central que motivou o handoff strategic-gaps. Roda contra LLM real.
 */

import { extractSignals } from "../motor-drota/dist/signal-extractor.js";

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

console.log("=== Input ===");
console.log("userMessage:", JSON.stringify(args.userMessage));
console.log("history length:", args.conversationHistoryTail.length);
console.log("personaName:", args.personaName);
console.log("personaAge:", args.personaAge);
console.log("trustLevel:", args.trustLevel);
console.log();

console.log("=== Provider config ===");
console.log("SIGNAL_EXTRACTOR_PROVIDER:", process.env.SIGNAL_EXTRACTOR_PROVIDER ?? "(default → infomaniak)");
console.log("SIGNAL_EXTRACTOR_MODEL:", process.env.SIGNAL_EXTRACTOR_MODEL ?? "(default → mistral3)");
console.log("INFOMANIAK_API_KEY set:", !!process.env.INFOMANIAK_API_KEY);
console.log("ANTHROPIC_API_KEY set:", !!process.env.ANTHROPIC_API_KEY);
console.log();

const t0 = Date.now();
let result;
try {
  result = await extractSignals(args);
} catch (e) {
  console.error("ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
}
const latency_ms = Date.now() - t0;

console.log("=== Output (raw) ===");
console.log(JSON.stringify(result, null, 2));
console.log();
console.log("=== Latency ===");
console.log(`${latency_ms}ms`);
console.log();
console.log("=== Critério de aceite ===");
const found = result.signals.includes("philosophical_self_acceptance");
console.log(`philosophical_self_acceptance capturado: ${found ? "✅ SIM" : "❌ NÃO"}`);
if (latency_ms > 15000) {
  console.log(`⚠️  latency ${latency_ms}ms > 15s alarm threshold`);
} else if (latency_ms > 5000) {
  console.log(`ℹ️  latency ${latency_ms}ms (alvo ~5s, ok mas não ideal)`);
} else {
  console.log(`✅ latency ${latency_ms}ms dentro do alvo`);
}
