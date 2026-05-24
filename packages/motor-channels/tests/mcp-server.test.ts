import { describe, it, expect } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, MCP_SERVER_NAME } from "../src/mcp-server.js";
import { createMockChannel } from "../src/mock-channel.js";
import { createCardPackageLoader } from "../src/cards-loader.js";
import type {
  CardPackage,
  ConnectionStatus,
  SendResult,
} from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures/pacotes");

const setup = async (opts?: { withLoader?: boolean }) => {
  const channel = createMockChannel();
  const loader = opts?.withLoader
    ? createCardPackageLoader({ baseDir: FIXTURES_DIR })
    : undefined;
  const server = createMcpServer({ channel, loader });
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
  return { channel, loader, server, client };
};

const parseJson = <T>(result: {
  content: Array<{ type: string; text?: string }>;
}): T => {
  const block = result.content[0]!;
  expect(block.type).toBe("text");
  return JSON.parse(block.text!) as T;
};

describe("motor-channels MCP server — channel.status", () => {
  it("lists channel.status as an available tool", async () => {
    const { client, server } = await setup();
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "channel.status")).toBe(true);
    await client.close();
    await server.close();
  });

  it("returns mock disconnected state on a fresh channel", async () => {
    const { client, server } = await setup();
    const result = await client.callTool({
      name: "channel.status",
      arguments: {},
    });
    const status = parseJson<ConnectionStatus>(
      result as Parameters<typeof parseJson>[0],
    );
    expect(status).toEqual({ connected: false, queueDepth: 0 });
    await client.close();
    await server.close();
  });

  it("reflects state changes after channel.start()", async () => {
    const { channel, client, server } = await setup();
    await channel.start();
    const result = await client.callTool({
      name: "channel.status",
      arguments: {},
    });
    const status = parseJson<ConnectionStatus>(
      result as Parameters<typeof parseJson>[0],
    );
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

describe("motor-channels MCP server — channel.send", () => {
  it("lists channel.send as an available tool", async () => {
    const { client, server } = await setup();
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "channel.send")).toBe(true);
    await client.close();
    await server.close();
  });

  it("delivers the outbound to the underlying channel and returns messageId", async () => {
    const { channel, client, server } = await setup();
    const result = await client.callTool({
      name: "channel.send",
      arguments: { to: "5511111@s.whatsapp.net", text: "oi mundo" },
    });
    const sendResult = parseJson<SendResult>(
      result as Parameters<typeof parseJson>[0],
    );
    expect(sendResult.messageId).toBe("mock-msg-1");
    expect(channel.sentMessages).toEqual([
      { to: "5511111@s.whatsapp.net", text: "oi mundo" },
    ]);
    await client.close();
    await server.close();
  });
});

describe("motor-channels MCP server — cards.getPackage", () => {
  it("does NOT register cards.getPackage when loader is omitted", async () => {
    const { client, server } = await setup();
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "cards.getPackage")).toBe(false);
    await client.close();
    await server.close();
  });

  it("registers cards.getPackage when loader is provided", async () => {
    const { client, server } = await setup({ withLoader: true });
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "cards.getPackage")).toBe(true);
    await client.close();
    await server.close();
  });

  it("returns the package for an existing cardId", async () => {
    const { client, server } = await setup({ withLoader: true });
    const result = await client.callTool({
      name: "cards.getPackage",
      arguments: { cardId: "tabuada-7" },
    });
    const pkg = parseJson<CardPackage | null>(
      result as Parameters<typeof parseJson>[0],
    );
    expect(pkg).not.toBeNull();
    expect(pkg!.cardId).toBe("tabuada-7");
    expect(pkg!.raw).toContain("Tabuada do 7");
    await client.close();
    await server.close();
  });

  it("returns JSON null for missing/invalid cardId", async () => {
    const { client, server } = await setup({ withLoader: true });
    for (const cardId of ["does-not-exist", "UPPER", "../escape", ""]) {
      const result = await client.callTool({
        name: "cards.getPackage",
        arguments: { cardId },
      });
      const pkg = parseJson<CardPackage | null>(
        result as Parameters<typeof parseJson>[0],
      );
      expect(pkg).toBeNull();
    }
    await client.close();
    await server.close();
  });
});
