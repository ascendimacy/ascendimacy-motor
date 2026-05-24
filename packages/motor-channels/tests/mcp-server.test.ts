import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, MCP_SERVER_NAME } from "../src/mcp-server.js";
import { createMockChannel } from "../src/mock-channel.js";
import type { ConnectionStatus } from "../src/types.js";

const setup = async () => {
  const channel = createMockChannel();
  const server = createMcpServer(channel);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: {} },
  );
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { channel, server, client };
};

const parseStatus = (result: {
  content: Array<{ type: string; text?: string }>;
}): ConnectionStatus => {
  const block = result.content[0]!;
  expect(block.type).toBe("text");
  return JSON.parse(block.text!) as ConnectionStatus;
};

describe("motor-channels MCP server", () => {
  it("lists channel.status as an available tool", async () => {
    const { client, server } = await setup();
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "channel.status")).toBe(true);
    await client.close();
    await server.close();
  });

  it("channel.status returns mock disconnected state on a fresh channel", async () => {
    const { client, server } = await setup();
    const result = await client.callTool({
      name: "channel.status",
      arguments: {},
    });
    const status = parseStatus(result as Parameters<typeof parseStatus>[0]);
    expect(status).toEqual({ connected: false, queueDepth: 0 });
    await client.close();
    await server.close();
  });

  it("channel.status reflects state changes after channel.start()", async () => {
    const { channel, client, server } = await setup();
    await channel.start();
    const result = await client.callTool({
      name: "channel.status",
      arguments: {},
    });
    const status = parseStatus(result as Parameters<typeof parseStatus>[0]);
    expect(status.connected).toBe(true);
    expect(typeof status.lastSeen).toBe("string");
    expect(status.queueDepth).toBe(0);
    await client.close();
    await server.close();
  });

  it("server identifies itself with MCP_SERVER_NAME", async () => {
    const { client, server } = await setup();
    const info = client.getServerVersion();
    expect(info?.name).toBe(MCP_SERVER_NAME);
    await client.close();
    await server.close();
  });
});
