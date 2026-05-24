/**
 * Servidor MCP do motor-channels — S-MX-06-04 (ops#1115).
 *
 * `createMcpServer(channel)` devolve um `McpServer` configurado, sem
 * transporte. Caller decide stdio (cli prod), in-memory (testes E2E),
 * ou outro (HTTP futuro). Mantém o module testável sem subprocesso.
 *
 * Tools registradas neste PR:
 * - `channel.status` — health/status snapshot do canal subjacente.
 *
 * Próximos PRs adicionam mais tools (`channel.send`, `cards.getPackage`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WhatsAppChannel } from "./channel.js";

/** Nome/versão do server. Versão acompanha o package.json. Bump quando a
 *  superfície de tools muda de modo não-aditivo. */
export const MCP_SERVER_NAME = "motor-channels";
export const MCP_SERVER_VERSION = "0.1.0";

/** Cria um `McpServer` com as tools do motor-channels registradas
 *  contra o `channel` fornecido. Não conecta transporte — caller faz. */
export function createMcpServer(channel: WhatsAppChannel): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  server.registerTool(
    "channel.status",
    {
      description:
        "Snapshot do estado da conexão do canal. Retorna { connected, lastSeen?, queueDepth } como JSON.",
      inputSchema: {},
    },
    async () => {
      const status = channel.status();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(status) }],
      };
    },
  );

  return server;
}
