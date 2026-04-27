/**
 * Server-mock tests — exercise the chat_completion tool via in-process MCP.
 *
 * Spec DoD: `run_id` propagates from input or generated via UUID.
 */

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGatewayServer } from "../src/server.js";
import { Router } from "../src/router.js";
import { TokenBucket } from "../src/token-bucket.js";
import { createMemoryLogger } from "../src/logger.js";
import type { ProviderClient, ChatCompletionInput } from "../src/types.js";

function stubOk(name: string): ProviderClient {
  return {
    async call(_req: ChatCompletionInput, model: string) {
      return {
        content: `${name}-content`,
        tokens: { in: 10, out: 5, reasoning: 0 },
        model,
        latency_ms: 1,
      };
    },
  };
}

async function makeTestServer() {
  const logger = createMemoryLogger();
  const router = new Router({
    providers: {
      anthropic: stubOk("anth"),
      infomaniak: stubOk("info"),
    },
    buckets: {
      anthropic: new TokenBucket({ rate: 100, capacity: 10 }),
      infomaniak: new TokenBucket({ rate: 100, capacity: 10 }),
    },
    logger,
  });
  const server = createGatewayServer({ router });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await client.connect(clientTransport);
  return { client, logger };
}

describe("Gateway MCP server", () => {
  it("registra tool chat_completion + retorna output JSON", async () => {
    const { client } = await makeTestServer();
    const result = await client.callTool({
      name: "chat_completion",
      arguments: {
        step: "drota",
        provider: "infomaniak",
        systemPrompt: "you are kind",
        userMessage: "olá",
        run_id: "session-abc",
      },
    });
    expect((result as { isError?: boolean }).isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.content).toBe("info-content");
    expect(parsed.provider).toBe("infomaniak");
    expect(parsed.was_fallback).toBe(false);
    expect(parsed.attempt_count).toBe(1);
  });

  it("run_id propaga do input pro logger NDJSON", async () => {
    const { client, logger } = await makeTestServer();
    await client.callTool({
      name: "chat_completion",
      arguments: {
        step: "drota",
        provider: "infomaniak",
        systemPrompt: "x",
        userMessage: "y",
        run_id: "test-run-from-input",
      },
    });
    expect(logger.entries.length).toBe(1);
    expect(logger.entries[0]!.run_id).toBe("test-run-from-input");
  });

  it("run_id gerado (UUID) quando omitido no input", async () => {
    const { client, logger } = await makeTestServer();
    await client.callTool({
      name: "chat_completion",
      arguments: {
        step: "drota",
        provider: "infomaniak",
        systemPrompt: "x",
        userMessage: "y",
      },
    });
    expect(logger.entries.length).toBe(1);
    expect(logger.entries[0]!.run_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("erro propaga via isError=true (não vaza JSON malformado)", async () => {
    const failing: ProviderClient = {
      async call() {
        throw new Error("boom");
      },
    };
    const router = new Router({
      providers: { anthropic: failing, infomaniak: failing },
      buckets: {
        anthropic: new TokenBucket({ rate: 100, capacity: 10 }),
        infomaniak: new TokenBucket({ rate: 100, capacity: 10 }),
      },
      primaryHardTimeoutMs: 50,
      totalBudgetMs: 100,
    });
    const server = createGatewayServer({ router });
    const [s, c] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await client.connect(c);

    const result = await client.callTool({
      name: "chat_completion",
      arguments: {
        step: "drota",
        provider: "infomaniak",
        systemPrompt: "x",
        userMessage: "y",
      },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.message).toBeDefined();
  });
});
