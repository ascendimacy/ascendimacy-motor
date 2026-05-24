/**
 * Orchestrator MCP server SKELETON — S-MX-06-07 (ops#1115, PR6b da opção Z).
 *
 * STATUS: documentação executável da inversão arquitetural pendente.
 * NÃO É USADO EM PRODUÇÃO. Não wire em cli.ts ainda.
 *
 * Hoje o orchestrator é CLI one-shot (`motor run --persona X --message Y`)
 * que spawna a tríade planejador/drota/execucao como clientes stdio e roda
 * um único turno. Esse arquivo expõe o shape do que ele PRECISARÁ se virar
 * daemon long-running com MCP server — alvo do qual o motor-channels
 * bridge (capability C-MX-06 PR6) depende pra capability futura
 * (provavelmente C-MX-07: orchestrator daemon).
 *
 * O que falta pra essa inversão sair do skeleton:
 *  1. orchestrator vira processo long-running em vez de CLI one-shot.
 *  2. Resolver mapping `from` (JID WhatsApp) → persona — hoje persona vem
 *     por --persona flag, não há lookup por canal.
 *  3. Manter conversa entre turnos (carta vira sessão, não turno único) —
 *     persistir conversationId → sessionId → SessionState rehydration.
 *  4. Conectar o pacote pedagógico carregado pelo bridge ao system prompt
 *     do motor-drota (route via planejador.contentPool? mixin novo?).
 *  5. Decidir transport: stdio (motor-channels spawn o orchestrator?), HTTP,
 *     ou shared lib.
 *
 * Esse arquivo dá a forma do `startCardSession` tool — o resto fica pra
 * capability própria. createInboundBridge em motor-channels já consome
 * essa interface (via `OrchestratorBridge`), então o skeleton aqui é
 * compatível.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const ORCHESTRATOR_MCP_NAME = "orchestrator";
export const ORCHESTRATOR_MCP_VERSION = "0.0.0-skeleton";

/**
 * Marker pra identificar respostas vindas do skeleton vs. impl real.
 * Quando capability futura wirar, esse prefixo desaparece da resposta.
 */
export const SKELETON_RESPONSE_PREFIX = "[orchestrator-skeleton]";

/**
 * Cria o MCP server skeleton do orchestrator. Tools registradas hoje:
 * - `startCardSession` — stub que retorna placeholder. Documenta a
 *   superfície que motor-channels bridge espera consumir.
 *
 * Não conecta transporte — caller decide. Não ative em cli.ts.
 */
export function createOrchestratorMcpServer(): McpServer {
  const server = new McpServer({
    name: ORCHESTRATOR_MCP_NAME,
    version: ORCHESTRATOR_MCP_VERSION,
  });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  server.registerTool(
    "startCardSession",
    {
      description:
        "[SKELETON] Inicia sessão carta-acionada. Retorna texto a enviar pelo canal. " +
        "Impl real fica pra capability futura — wiring com motor-drota + " +
        "persistência de conversationId pendente.",
      inputSchema: {
        cardId: z.string(),
        conversationId: z.string(),
        from: z.string(),
        // pkg passado como JSON serialized — schema completo vive em
        // motor-channels CardPackage. Skeleton aceita qualquer objeto.
        pkg: z.object({
          cardId: z.string(),
          raw: z.string(),
          sourcePath: z.string(),
        }),
      } as any,
    },
    async (input: {
      cardId: string;
      conversationId: string;
      from: string;
      pkg: { cardId: string; raw: string; sourcePath: string };
    }) => {
      const text =
        `${SKELETON_RESPONSE_PREFIX} sessão iniciada para cardId=${input.cardId}, ` +
        `conversationId=${input.conversationId}. wiring real pendente.`;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ text }) },
        ],
      };
    },
  );

  return server;
}
