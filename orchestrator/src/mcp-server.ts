/**
 * Orchestrator MCP server — S-OD-03 (C-MX-07 PR2).
 *
 * Substitui o skeleton de PR6b por factory real conectada ao
 * OrchestratorDaemon. Tools registradas:
 *
 * - `startCardSession` — cria SessionRuntime via daemon.startSession
 *   (hidrata state). PR2: retorna text PLACEHOLDER ainda; PR3 (S-OD-05)
 *   liga runTurn real + materializa resposta com pkg pedagógico.
 * - `endSession` — encerra sessão por sessionId.
 * - `daemon.status` — snapshot { started, sessionCount } pra ops/debug.
 *
 * Tools futuras (PRs seguintes):
 * - `subscribe_turn_state` (S-OD-06) — streaming por turn.
 * - `list_options` (S-OD-07) — pool considerado pelo planejador.
 * - `override_selection` (S-OD-08) — Jun escolhe carta diferente.
 * - `approve_or_edit` (S-OD-09) — resolver pro approvalGate motor-channels.
 *
 * Não conecta transport — caller (daemon entry) decide stdio ou HTTP.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OrchestratorDaemon } from "./daemon.js";

export const ORCHESTRATOR_MCP_NAME = "orchestrator";
export const ORCHESTRATOR_MCP_VERSION = "0.1.0";

/**
 * Marker do skeleton anterior (carry-over de PR2). Não é mais retornado
 * em PR3 — daemon.runCardTurn devolve texto materializado real pelo
 * motor-drota. Mantido exportado pra back-compat de tests externos que
 * possam depender do símbolo até serem migrados.
 *
 * @deprecated PR3 (S-OD-05) — startCardSession agora retorna texto real.
 */
export const PENDING_REAL_IMPL_MARKER = "[pending-real-impl]";

export interface CreateOrchestratorMcpServerOptions {
  daemon: OrchestratorDaemon;
}

export function createOrchestratorMcpServer(
  opts: CreateOrchestratorMcpServerOptions,
): McpServer {
  const server = new McpServer({
    name: ORCHESTRATOR_MCP_NAME,
    version: ORCHESTRATOR_MCP_VERSION,
  });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  server.registerTool(
    "startCardSession",
    {
      description:
        "Inicia sessão carta-acionada + executa runTurn com pkg pedagógico " +
        "wirado em motor-drota system prompt (via instruction_addition). " +
        "Retorna { sessionId, text } onde text é a resposta materializada.",
      inputSchema: {
        cardId: z.string(),
        conversationId: z.string(),
        from: z.string(),
        // pkg passado por motor-channels bridge — schema completo é CardPackage.
        pkg: z.object({
          cardId: z.string(),
          raw: z.string(),
          sourcePath: z.string(),
        }),
        // personaId pode vir do BFF (resolução from→persona) ou default = from.
        personaId: z.string().optional(),
      } as any,
    },
    async (input: {
      cardId: string;
      conversationId: string;
      from: string;
      pkg: { cardId: string; raw: string; sourcePath: string };
      personaId?: string;
    }) => {
      const result = await opts.daemon.runCardTurn(input);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              sessionId: result.sessionId,
              text: result.text,
              tracePath: result.tracePath,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "endSession",
    {
      description:
        "Encerra sessão por sessionId. Retorna { closed: bool } — true se " +
        "sessão existia e foi removida; false se sessionId não está no registry.",
      inputSchema: {
        sessionId: z.string(),
      } as any,
    },
    async (input: { sessionId: string }) => {
      const result = await opts.daemon.endSession(input.sessionId);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result) },
        ],
      };
    },
  );

  server.registerTool(
    "daemon.status",
    {
      description:
        "Snapshot { started, sessionCount } do daemon. Pra observabilidade + ops.",
      inputSchema: {},
    },
    async () => {
      const status = opts.daemon.status();
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(status) },
        ],
      };
    },
  );

  server.registerTool(
    "subscribe_turn_state",
    {
      description:
        "Pull-based subscribe a TurnStateEvents da sessão. Retorna { events, " +
        "nextIndex, totalEmitted }. Caller (eBrota Console BFF) deve poll " +
        "periodicamente (~100-250ms) passando o último nextIndex como sinceIndex. " +
        "Buffer é capped (100 events/sessão); gap detectável via " +
        "received_first_index > sinceIndex.",
      inputSchema: {
        sessionId: z.string(),
        sinceIndex: z.number().int().nonnegative().optional(),
      } as any,
    },
    async (input: { sessionId: string; sinceIndex?: number }) => {
      const snapshot = opts.daemon.subscribeTurnState(
        input.sessionId,
        input.sinceIndex ?? 0,
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(snapshot) },
        ],
      };
    },
  );

  return server;
}
