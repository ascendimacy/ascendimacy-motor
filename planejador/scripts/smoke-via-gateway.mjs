#!/usr/bin/env node
/**
 * Smoke isolado planejador → gateway (motor#28c chunk DoD).
 *
 * Verifica que planejador.callLlm() chama callGateway() → spawna gateway
 * MCP via stdio → gateway chama Infomaniak/Anthropic → response volta.
 *
 * Run:
 *   set -a && . ~/ascendimacy-sts/.env && set +a
 *   node planejador/scripts/smoke-via-gateway.mjs
 */

import { callLlm, callHaiku } from "../dist/llm-client.js";
import { closeGateway } from "@ascendimacy/shared";

const t0 = Date.now();
console.log(`[smoke-via-gateway] planejador.callLlm → gateway → provider efetivo`);

try {
  const r = await callLlm(
    "Você é gentil. Responde em pt-br curto.",
    "diga apenas 'ok' em pt-br.",
  );
  const t1 = Date.now();
  console.log(`[smoke-via-gateway] callLlm ✓ provider=${r.provider} model=${r.model}`);
  console.log(`[smoke-via-gateway]   content="${r.content.slice(0, 80)}"`);
  console.log(`[smoke-via-gateway]   tokens: in=${r.tokens.in} out=${r.tokens.out}`);
  console.log(`[smoke-via-gateway]   latency_callLlm=${t1 - t0}ms`);

  const r2 = await callHaiku(
    "Você é um classificador. Responde JSON.",
    'classifique: {"texto":"olá"}',
  );
  const t2 = Date.now();
  console.log(`[smoke-via-gateway] callHaiku ✓ provider=${r2.provider} model=${r2.model}`);
  console.log(`[smoke-via-gateway]   content="${r2.content.slice(0, 80)}"`);
  console.log(`[smoke-via-gateway]   latency_callHaiku=${t2 - t1}ms`);
  console.log(`[smoke-via-gateway] total_ms=${t2 - t0}`);
} catch (err) {
  const e = err;
  console.error(`[smoke-via-gateway] ✗ ${e.name ?? "Error"}: ${e.message ?? String(err)}`);
  process.exitCode = 1;
} finally {
  await closeGateway();
}
