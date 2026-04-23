#!/usr/bin/env node
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectAll, disconnectAll } from "./mcp-clients.js";
import { runTurn } from "./orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tracesDir = join(__dirname, "../../traces");

function parseArgs(): { persona: string; message: string; sessionId: string } {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const subcommand = args[0];
  if (subcommand !== "run") {
    console.error("Usage: motor run --persona <id> --message <text> [--session <id>]");
    process.exit(1);
  }

  const persona = get("--persona") ?? "paula-mendes";
  const message = get("--message") ?? "oi";
  const sessionId = get("--session") ?? `session-${Date.now()}`;

  return { persona, message, sessionId };
}

const { persona, message, sessionId } = parseArgs();

console.log(`[motor] Iniciando turno — persona: ${persona}, sessão: ${sessionId}`);
console.log(`[motor] Mensagem: "${message}"`);

const clients = await connectAll();

try {
  const { finalResponse, tracePath } = await runTurn(clients, sessionId, persona, message, tracesDir);
  console.log(`\n[motor] Resposta:\n${finalResponse}`);
  console.log(`\n[motor] Trace salvo em: ${tracePath}`);
} finally {
  await disconnectAll(clients);
}
