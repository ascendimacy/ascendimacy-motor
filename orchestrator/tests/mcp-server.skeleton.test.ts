import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createOrchestratorMcpServer,
  ORCHESTRATOR_MCP_NAME,
  SKELETON_RESPONSE_PREFIX,
} from "../src/mcp-server.js";

const setup = async () => {
  const server = createOrchestratorMcpServer();
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
  return { server, client };
};

const parseJson = <T>(result: {
  content: Array<{ type: string; text?: string }>;
}): T => JSON.parse(result.content[0]!.text!) as T;

describe("orchestrator MCP server skeleton", () => {
  it("identifies itself with ORCHESTRATOR_MCP_NAME", async () => {
    const { client, server } = await setup();
    expect(client.getServerVersion()?.name).toBe(ORCHESTRATOR_MCP_NAME);
    await client.close();
    await server.close();
  });

  it("registers startCardSession as a tool", async () => {
    const { client, server } = await setup();
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "startCardSession")).toBe(true);
    await client.close();
    await server.close();
  });

  it("startCardSession returns a placeholder text marked by SKELETON prefix", async () => {
    const { client, server } = await setup();
    const result = await client.callTool({
      name: "startCardSession",
      arguments: {
        cardId: "tabuada-7",
        conversationId: "conv-001",
        from: "5511999@s.whatsapp.net",
        pkg: {
          cardId: "tabuada-7",
          raw: "# pkg",
          sourcePath: "/fake/path",
        },
      },
    });
    const out = parseJson<{ text: string }>(
      result as Parameters<typeof parseJson>[0],
    );
    expect(out.text.startsWith(SKELETON_RESPONSE_PREFIX)).toBe(true);
    expect(out.text).toContain("cardId=tabuada-7");
    expect(out.text).toContain("conversationId=conv-001");
    expect(out.text).toContain("wiring real pendente");
    await client.close();
    await server.close();
  });
});
