#!/usr/bin/env node
/**
 * LLM Gateway MCP server (motor#28a).
 *
 * Expõe 1 tool: `chat_completion`.
 * Children (motor-drota, planejador, signal-extractor) chamam essa tool
 * em vez de instanciar SDK direto. Centraliza retry, fallback, token bucket,
 * logging e undici Agent config.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Router } from "./router.js";
import { installAgent } from "./agent.js";
import { createFileLogger, createNoopLogger, type GatewayLogger } from "./logger.js";

// Install global undici Agent ASAP (before any SDK call could fire).
installAgent();

const ChatCompletionInputSchema = {
  step: z.string(),
  provider: z.enum(["anthropic", "infomaniak"]).optional(),
  model: z.string().optional(),
  systemPrompt: z.string(),
  cacheableSystemPrefix: z.string().optional(),
  userMessage: z.string(),
  maxTokens: z.number().int().positive().optional(),
  enableThinking: z.boolean().optional(),
  thinkingBudgetTokens: z.number().int().positive().optional(),
  run_id: z.string().optional(),
};

function makeLogger(): GatewayLogger {
  if (process.env["ASC_LLM_GATEWAY_LOG"] === "disabled") return createNoopLogger();
  // Use ASC_DEBUG_RUN_ID if propagated, else a stable per-process id.
  const runId = process.env["ASC_DEBUG_RUN_ID"] ?? `gw-${Date.now()}`;
  return createFileLogger(runId);
}

export function createGatewayServer(injected?: { router?: Router }): McpServer {
  const server = new McpServer({
    name: "llm-gateway",
    version: "0.1.0",
  });

  const router = injected?.router ?? new Router({ logger: makeLogger() });

  (server as unknown as {
    registerTool: (
      name: string,
      meta: { description: string; inputSchema: unknown },
      handler: (args: unknown) => Promise<unknown>,
    ) => void;
  }).registerTool(
    "chat_completion",
    {
      description: "Chat completion with retry, token bucket, provider fallback, and observability",
      inputSchema: ChatCompletionInputSchema as unknown,
    },
    async (args: unknown) => {
      try {
        const out = await router.chatCompletion(args as Parameters<Router["chatCompletion"]>[0]);
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
        };
      } catch (err) {
        const e = err as { name?: string; code?: string; message?: string };
        const errorPayload = {
          error: {
            name: e.name ?? "Error",
            code: e.code ?? "UNKNOWN",
            message: e.message ?? String(err),
          },
        };
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(errorPayload) }],
        };
      }
    },
  );

  return server;
}

// Auto-start when invoked as main entry.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const server = createGatewayServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
