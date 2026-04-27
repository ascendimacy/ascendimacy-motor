#!/usr/bin/env node
/**
 * Smoke E2E orchestrator → children → gateway → providers (motor#28d DoD).
 *
 * Spawna planejador + motor-drota como o orchestrator real faz. Chama
 * tools que invocam callGateway internamente. Stderr dos children é
 * inherited por default no StdioClientTransport — "spawning gateway"
 * aparece no nosso stderr quando LLM_GATEWAY_LOG_SPAWN=true.
 *
 * Esperado: 2× "spawning gateway" no stderr (1 por child Node process,
 * 0 por call dentro do mesmo child = singleton intra-process).
 *
 * Run:
 *   set -a && . ~/ascendimacy-sts/.env && set +a
 *   LLM_GATEWAY_LOG_SPAWN=true node orchestrator/scripts/smoke-e2e-via-gateway.mjs
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const motorRoot = join(__dirname, "../..");

function buildEnv() {
  const env = {};
  const keys = [
    "ANTHROPIC_API_KEY",
    "INFOMANIAK_API_KEY",
    "INFOMANIAK_BASE_URL",
    "LLM_PROVIDER",
    "PLANEJADOR_PROVIDER",
    "PLANEJADOR_MODEL",
    "DROTA_PROVIDER",
    "DROTA_MODEL",
    "MOTOR_DROTA_MODEL",
    "SIGNAL_EXTRACTOR_PROVIDER",
    "SIGNAL_EXTRACTOR_MODEL",
    "LLM_GATEWAY_LOG_SPAWN",
    "ASC_DEBUG_MODE",
    "ASC_DEBUG_RUN_ID",
  ];
  for (const k of keys) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  return env;
}

async function connectChild(name, serverPath) {
  const client = new Client({ name: `e2e->${name}`, version: "0.1.0" });
  const t = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: buildEnv(),
  });
  await client.connect(t);
  return client;
}

const t0 = Date.now();
console.error(`[smoke-e2e] motor#28d full stack via gateway (singleton validation)`);
console.error(`[smoke-e2e] LLM_GATEWAY_LOG_SPAWN=${process.env.LLM_GATEWAY_LOG_SPAWN ?? "(not set — singleton not validated)"}`);

let planejador, motorDrota;
try {
  console.error(`[smoke-e2e] spawning planejador + motor-drota...`);
  [planejador, motorDrota] = await Promise.all([
    connectChild("planejador", join(motorRoot, "planejador/dist/server.js")),
    connectChild("motor-drota", join(motorRoot, "motor-drota/dist/server.js")),
  ]);
  console.error(`[smoke-e2e] children connected (${Date.now() - t0}ms)`);

  // Call extract_signals 2x — should reuse same gateway in motor-drota's process
  for (const [i, msg] of [
    [1, "tô meio frustrado, nada está funcionando"],
    [2, "que dia bom hoje, gostei muito"],
  ]) {
    const ti = Date.now();
    const r = await motorDrota.callTool({
      name: "extract_signals",
      arguments: {
        userMessage: msg,
        personaName: "Test",
        personaAge: 12,
        trustLevel: 0.5,
        conversationHistoryTail: [],
      },
    });
    const j = JSON.parse(r.content?.[0]?.text ?? "{}");
    console.error(
      `[smoke-e2e] motor-drota.extract_signals call#${i} ✓ signals=[${j.signals?.join(",") ?? ""}] conf=${j.overall_confidence ?? "?"} latency=${Date.now() - ti}ms`,
    );
  }

  // Note: skip planejador.plan_turn — fixtures complexos demais pra smoke E2E.
  // Singleton em planejador process já validado por planejador/scripts/smoke-via-gateway.mjs.
  console.error(`[smoke-e2e] (planejador singleton já validado em planejador/scripts/smoke-via-gateway.mjs)`);

  console.error(`[smoke-e2e] ✓ total_ms=${Date.now() - t0}`);
  console.error(``);
  console.error(`[smoke-e2e] EXPECTED stderr count check:`);
  console.error(`[smoke-e2e]   "spawning gateway" deve aparecer 1× no stderr (motor-drota's child).`);
  console.error(`[smoke-e2e]   2 chamadas extract_signals do mesmo processo motor-drota → 1 gateway subprocess (singleton).`);
} finally {
  if (planejador) await planejador.close().catch(() => {});
  if (motorDrota) await motorDrota.close().catch(() => {});
}
