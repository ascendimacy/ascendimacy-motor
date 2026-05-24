#!/usr/bin/env node
/**
 * Smoke manual do orchestrator daemon — C-MX-07 S-OD-14 (PR7).
 *
 * Inicia o daemon como subprocesso stdio, conecta um MCP client, dispatcha
 * tools básicos pra exercitar o pipeline completo. Útil pra:
 *  - Validar daemon roda sem deadlock por ~1min (memory leak smoke)
 *  - Confirmar startCardSession retorna text não-marker
 *  - Confirmar subscribe_turn_state emite 4 eventos por turn
 *
 * NÃO substitui smoke real contra LLM (precisa Anthropic/Infomaniak keys
 * ou OVMS qwen14b local). Por default usa USE_MOCK_LLM=true pra rodar
 * offline; sobrescreve setando USE_MOCK_LLM=false antes de invocar.
 *
 * USAGE:
 *   npm run build --workspace orchestrator
 *   USE_MOCK_LLM=true node orchestrator/scripts/daemon-smoke.mjs
 *
 *   # Real LLM local (qwen14b OVMS via host.docker.internal):
 *   LLM_PROVIDER=local LOCAL_LLM_BASE_URL=http://host.docker.internal:9000/v3 \
 *     LOCAL_LLM_MODEL=qwen14b USE_MOCK_LLM=false \
 *     node orchestrator/scripts/daemon-smoke.mjs
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const daemonEntry = resolve(__dirname, "../dist/daemon.js");

const log = (msg) => console.log(`[smoke] ${msg}`);

const parseToolResult = (result) => {
  const text = result?.content?.[0]?.text ?? "{}";
  return JSON.parse(text);
};

const main = async () => {
  log(`spawning daemon: ${daemonEntry}`);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [daemonEntry],
    env: { ...process.env },
  });
  const client = new Client(
    { name: "daemon-smoke", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  log("connected to daemon via stdio MCP");

  const tools = await client.listTools();
  log(`tools available: ${tools.tools.map((t) => t.name).join(", ")}`);

  log("calling daemon.status...");
  const status = parseToolResult(
    await client.callTool({ name: "daemon.status", arguments: {} }),
  );
  log(`status: ${JSON.stringify(status)}`);

  log("calling startCardSession (paula-mendes + tabuada-7 pkg)...");
  const startResult = parseToolResult(
    await client.callTool({
      name: "startCardSession",
      arguments: {
        cardId: "tabuada-7",
        conversationId: "smoke-conv-001",
        from: "smoke-from",
        pkg: {
          cardId: "tabuada-7",
          raw: "# Tabuada do 7\n\n7x1=7, 7x2=14, 7x3=21",
          sourcePath: "smoke-fixture",
        },
        personaId: "paula-mendes",
      },
    }),
  );
  log(`session=${startResult.sessionId}`);
  log(
    `materialized text (first 120 chars):\n  "${startResult.text?.slice(0, 120) ?? "(empty)"}..."`,
  );
  if (startResult.text?.includes("[pending-real-impl]")) {
    log(
      "⚠️  text contém [pending-real-impl] marker — runTurn pode não ter rodado",
    );
  }

  log("polling subscribe_turn_state...");
  const events = parseToolResult(
    await client.callTool({
      name: "subscribe_turn_state",
      arguments: { sessionId: startResult.sessionId },
    }),
  );
  log(
    `events: ${events.events?.map((e) => e.type).join(" → ") ?? "(none)"}`,
  );
  log(`totalEmitted: ${events.totalEmitted}`);

  log("calling endSession...");
  const endResult = parseToolResult(
    await client.callTool({
      name: "endSession",
      arguments: { sessionId: startResult.sessionId },
    }),
  );
  log(`endSession: ${JSON.stringify(endResult)}`);

  log("closing client + transport...");
  await client.close();
  log("✅ smoke complete");
};

main().catch((err) => {
  console.error("[smoke] ❌ failed:", err);
  process.exit(1);
});
