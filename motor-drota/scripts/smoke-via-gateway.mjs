#!/usr/bin/env node
/**
 * Smoke isolado motor-drota → gateway (motor#28b chunk DoD).
 *
 * Verifica que motor-drota.callLlm() chama callGateway() → spawna gateway
 * MCP via stdio → gateway chama Infomaniak/Anthropic → response volta.
 *
 * Run:
 *   set -a && . ~/ascendimacy-sts/.env && set +a
 *   node motor-drota/scripts/smoke-via-gateway.mjs
 */

import { callLlm } from "../dist/llm-client.js";
import { extractSignals } from "../dist/signal-extractor.js";
import { closeGateway } from "@ascendimacy/shared";

const t0 = Date.now();
console.log(`[smoke-via-gateway] motor-drota: callLlm + extractSignals via gateway singleton`);

try {
  // Call 1: callLlm (drota evaluate_and_select)
  const r1 = await callLlm(
    "Você é gentil. Responde em pt-br curto.",
    "diga apenas 'ok' em pt-br.",
  );
  const t1 = Date.now();
  console.log(`[smoke-via-gateway] callLlm ✓ provider=${r1.provider} model=${r1.model} latency=${t1 - t0}ms`);

  // Call 2: extractSignals (signal-extractor) — DEVE reusar mesmo gateway subprocess
  const r2 = await extractSignals({
    userMessage: "tô meio frustrado, nada está funcionando",
    conversationHistoryTail: [],
    personaName: "Test",
    personaAge: 12,
    trustLevel: 0.5,
  });
  const t2 = Date.now();
  console.log(`[smoke-via-gateway] extractSignals ✓ signals=[${r2.signals.join(",")}] confidence=${r2.overall_confidence} latency=${t2 - t1}ms`);
  console.log(`[smoke-via-gateway] total_ms=${t2 - t0}`);
} catch (err) {
  const e = err;
  console.error(`[smoke-via-gateway] ✗ ${e.name ?? "Error"}: ${e.message ?? String(err)}`);
  process.exitCode = 1;
} finally {
  await closeGateway();
}
