/**
 * Servidor MCP do motor-channels — S-MX-06-04 + 06 + 08 (ops#1115).
 *
 * `createMcpServer(opts)` devolve um `McpServer` configurado, sem
 * transporte. Caller decide stdio (cli prod), in-memory (testes E2E),
 * ou outro (HTTP futuro). Mantém o module testável sem subprocesso.
 *
 * Tools registradas:
 * - `channel.status` — snapshot { connected, lastSeen?, queueDepth }
 * - `channel.send`   — envio outbound, retorna { messageId }
 * - `cards.getPackage` — registrada apenas se `loader` for fornecido.
 *   Retorna o pacote pedagógico ou JSON `null` se ausente.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WhatsAppChannel } from "./channel.js";
import type { CardPackageLoader } from "./cards-loader.js";

export const MCP_SERVER_NAME = "motor-channels";
export const MCP_SERVER_VERSION = "0.1.0";

export interface CreateMcpServerOptions {
  channel: WhatsAppChannel;
  /** Opcional — quando passado, `cards.getPackage` fica registrada. */
  loader?: CardPackageLoader;
}

export function createMcpServer(opts: CreateMcpServerOptions): McpServer {
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
      const status = opts.channel.status();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(status) }],
      };
    },
  );

  /* eslint-disable @typescript-eslint/no-explicit-any */
  server.registerTool(
    "channel.send",
    {
      description:
        "Envia mensagem outbound pelo canal. Retorna { messageId } como JSON.",
      // cast `any` por divergência de versão zod entre workspaces (mesmo
      // pattern de planejador/server.ts).
      inputSchema: {
        to: z.string(),
        text: z.string(),
      } as any,
    },
    async ({ to, text }: { to: string; text: string }) => {
      const result = await opts.channel.send(to, text);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  if (opts.loader !== undefined) {
    const loader = opts.loader;
    server.registerTool(
      "cards.getPackage",
      {
        description:
          "Retorna o pacote pedagógico do `cardId` ou JSON `null` se ausente.",
        inputSchema: {
          cardId: z.string(),
        } as any,
      },
      async ({ cardId }: { cardId: string }) => {
        const pkg = await loader.load(cardId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(pkg) }],
        };
      },
    );
  }

  return server;
}
