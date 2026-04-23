import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { planTurn } from "./plan.js";
import type { PlanTurnInput } from "@ascendimacy/shared";

const server = new McpServer({
  name: "planejador",
  version: "0.1.0",
});

/* eslint-disable @typescript-eslint/no-explicit-any */
server.registerTool("plan_turn", {
  description: "Gera plano estratégico para o turno: recebe estado + mensagem, retorna candidateActions",
  inputSchema: {
    sessionId: z.string(),
    persona: z.object({ id: z.string(), name: z.string(), age: z.number(), profile: z.record(z.string(), z.unknown()) }),
    adquirente: z.object({ id: z.string(), name: z.string(), defaults: z.record(z.string(), z.unknown()) }),
    inventory: z.array(z.object({ id: z.string(), title: z.string(), category: z.string(), estimatedSacrifice: z.number(), estimatedConfidenceGain: z.number() })),
    state: z.object({ sessionId: z.string(), trustLevel: z.number(), budgetRemaining: z.number(), turn: z.number(), eventLog: z.array(z.unknown()) }),
    incomingMessage: z.string(),
  } as any,
}, async (input: PlanTurnInput) => {
  const output = await planTurn(input);
  return { content: [{ type: "text" as const, text: JSON.stringify(output) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
