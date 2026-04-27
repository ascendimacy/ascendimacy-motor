#!/usr/bin/env node
/**
 * Smoke real Infomaniak — chama o gateway 1× com o stack completo
 * (Router → bucket → retry → undici Agent → SDK OpenAI → Infomaniak).
 *
 * Run:
 *   set -a && . ~/ascendimacy-sts/.env && set +a
 *   node llm-gateway/scripts/smoke.mjs
 */

import { Router, installAgent, createFileLogger } from "../dist/index.js";

installAgent();

const runId = `smoke-${Date.now()}`;
const logger = createFileLogger(runId);
const router = new Router({ logger });

const t0 = Date.now();
console.log(`[smoke] calling Infomaniak via gateway...`);

try {
  const r = await router.chatCompletion({
    step: "drota",
    provider: "infomaniak",
    systemPrompt: "Você é gentil e responde em pt-br.",
    userMessage: "diga apenas 'ok' em pt-br.",
    maxTokens: 32,
    run_id: runId,
  });
  const totalMs = Date.now() - t0;
  console.log(`[smoke] ✓ provider=${r.provider} model=${r.model}`);
  console.log(`[smoke] content: ${r.content}`);
  console.log(`[smoke] tokens: in=${r.tokens.in} out=${r.tokens.out} cacheRead=${r.tokens.cacheRead ?? 0}`);
  console.log(`[smoke] latency_ms=${r.latency_ms} total_ms=${totalMs} attempts=${r.attempt_count} was_fallback=${r.was_fallback}`);
  process.exit(0);
} catch (err) {
  const e = err;
  console.error(`[smoke] ✗ ${e.name ?? "Error"}: ${e.message ?? String(err)}`);
  if (e.cause) {
    console.error(`[smoke] cause.code=${e.cause.code} cause.msg=${e.cause.message}`);
  }
  process.exit(1);
}
