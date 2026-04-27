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
import { closeGateway } from "@ascendimacy/shared";

const t0 = Date.now();
console.log(`[smoke-via-gateway] motor-drota.callLlm → gateway → Infomaniak/Kimi K2.5`);

try {
  const r = await callLlm(
    "Você é gentil. Responde em pt-br curto.",
    "diga apenas 'ok' em pt-br.",
  );
  const totalMs = Date.now() - t0;
  console.log(`[smoke-via-gateway] ✓ provider=${r.provider} model=${r.model}`);
  console.log(`[smoke-via-gateway] content="${r.content.slice(0, 80)}"`);
  console.log(`[smoke-via-gateway] tokens: in=${r.tokens.in} out=${r.tokens.out} cacheRead=${r.tokens.cacheRead ?? 0}`);
  console.log(`[smoke-via-gateway] total_ms=${totalMs}`);
} catch (err) {
  const e = err;
  console.error(`[smoke-via-gateway] ✗ ${e.name ?? "Error"}: ${e.message ?? String(err)}`);
  process.exitCode = 1;
} finally {
  await closeGateway();
}
