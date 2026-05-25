import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createOrchestratorMcpServer,
  ORCHESTRATOR_MCP_NAME,
  PENDING_REAL_IMPL_MARKER,
} from "../src/mcp-server.js";
import { OrchestratorDaemon } from "../src/daemon.js";
import type { McpClients } from "../src/mcp-clients.js";
import type { SessionState } from "@ascendimacy/shared";

const fakeState: SessionState = {
  sessionId: "stub",
  trustLevel: 0.3,
  budgetRemaining: 100,
  eventLog: [],
  turn: 0,
};

const mockMotorExecucao = () =>
  ({
    callTool: vi.fn(async ({ name }: { name: string }) => {
      if (name === "get_state") {
        return {
          content: [{ type: "text", text: JSON.stringify(fakeState) }],
        };
      }
      throw new Error(`unexpected tool: ${name}`);
    }),
  }) as never;

const mockClients = (): McpClients => ({
  planejador: {} as never,
  motorDrota: {} as never,
  motorExecucao: mockMotorExecucao(),
});

const setup = async () => {
  const daemon = new OrchestratorDaemon({
    clientsFactory: async () => mockClients(),
    clientsDisposer: async () => undefined,
    log: () => undefined,
    now: () => "2026-05-24T12:00:00.000Z",
  });
  await daemon.start();

  const server = createOrchestratorMcpServer({ daemon });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: {} },
  );
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { daemon, server, client };
};

const parseJson = <T>(result: {
  content: Array<{ type: string; text?: string }>;
}): T => JSON.parse(result.content[0]!.text!) as T;

describe("orchestrator MCP server — identity + tools list", () => {
  it("identifies as ORCHESTRATOR_MCP_NAME", async () => {
    const { client, server, daemon } = await setup();
    expect(client.getServerVersion()?.name).toBe(ORCHESTRATOR_MCP_NAME);
    await client.close();
    await server.close();
    await daemon.stop();
  });

  it("registra startCardSession + endSession + daemon.status", async () => {
    const { client, server, daemon } = await setup();
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("startCardSession");
    expect(names).toContain("endSession");
    expect(names).toContain("daemon.status");
    await client.close();
    await server.close();
    await daemon.stop();
  });
});

describe("orchestrator MCP server — startCardSession", () => {
  it("cria sessão via daemon + retorna placeholder text com marker", async () => {
    const { client, server, daemon } = await setup();
    const result = await client.callTool({
      name: "startCardSession",
      arguments: {
        cardId: "tabuada-7",
        conversationId: "5511aaa@s.whatsapp.net",
        from: "yuji",
        pkg: {
          cardId: "tabuada-7",
          raw: "# pkg",
          sourcePath: "/fake/path",
        },
        personaId: "yuji",
      },
    });
    const out = parseJson<{ sessionId: string; text: string }>(
      result as Parameters<typeof parseJson>[0],
    );
    expect(out.sessionId).toBe("yuji__5511aaa@s.whatsapp.net");
    expect(out.text.startsWith(PENDING_REAL_IMPL_MARKER)).toBe(true);
    expect(out.text).toContain("cardId=tabuada-7");
    expect(daemon.status().sessionCount).toBe(1);
    expect(daemon.getSession(out.sessionId)?.state?.trustLevel).toBe(
      fakeState.trustLevel,
    );
    await client.close();
    await server.close();
    await daemon.stop();
  });

  it("personaId default = from quando ausente", async () => {
    const { client, server, daemon } = await setup();
    const result = await client.callTool({
      name: "startCardSession",
      arguments: {
        cardId: "tabuada-7",
        conversationId: "conv-001",
        from: "default-persona",
        pkg: { cardId: "tabuada-7", raw: "x", sourcePath: "/x" },
      },
    });
    const out = parseJson<{ sessionId: string; text: string }>(
      result as Parameters<typeof parseJson>[0],
    );
    expect(out.sessionId).toBe("default-persona__conv-001");
    await client.close();
    await server.close();
    await daemon.stop();
  });

  it("startCardSession na MESMA conversationId reabre sessão existente (idempotente)", async () => {
    const { client, server, daemon } = await setup();
    const args = {
      cardId: "tabuada-7",
      conversationId: "conv-idem",
      from: "yuji",
      pkg: { cardId: "tabuada-7", raw: "x", sourcePath: "/x" },
      personaId: "yuji",
    };
    await client.callTool({ name: "startCardSession", arguments: args });
    await client.callTool({ name: "startCardSession", arguments: args });
    expect(daemon.status().sessionCount).toBe(1);
    await client.close();
    await server.close();
    await daemon.stop();
  });
});

describe("orchestrator MCP server — endSession", () => {
  it("encerra sessão existente → { closed: true }", async () => {
    const { client, server, daemon } = await setup();
    await client.callTool({
      name: "startCardSession",
      arguments: {
        cardId: "x",
        conversationId: "conv-end",
        from: "yuji",
        pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
        personaId: "yuji",
      },
    });
    const result = await client.callTool({
      name: "endSession",
      arguments: { sessionId: "yuji__conv-end" },
    });
    expect(
      parseJson<{ closed: boolean }>(
        result as Parameters<typeof parseJson>[0],
      ).closed,
    ).toBe(true);
    expect(daemon.status().sessionCount).toBe(0);
    await client.close();
    await server.close();
    await daemon.stop();
  });

  it("endSession em sessionId inexistente → { closed: false }", async () => {
    const { client, server, daemon } = await setup();
    const result = await client.callTool({
      name: "endSession",
      arguments: { sessionId: "does-not-exist" },
    });
    expect(
      parseJson<{ closed: boolean }>(
        result as Parameters<typeof parseJson>[0],
      ).closed,
    ).toBe(false);
    await client.close();
    await server.close();
    await daemon.stop();
  });
});

describe("orchestrator MCP server — daemon.status", () => {
  it("reflete sessionCount em tempo real", async () => {
    const { client, server, daemon } = await setup();
    const before = parseJson<{ started: boolean; sessionCount: number }>(
      (await client.callTool({
        name: "daemon.status",
        arguments: {},
      })) as Parameters<typeof parseJson>[0],
    );
    expect(before).toEqual({ started: true, sessionCount: 0 });

    await client.callTool({
      name: "startCardSession",
      arguments: {
        cardId: "x",
        conversationId: "conv-status",
        from: "y",
        pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
        personaId: "y",
      },
    });

    const after = parseJson<{ started: boolean; sessionCount: number }>(
      (await client.callTool({
        name: "daemon.status",
        arguments: {},
      })) as Parameters<typeof parseJson>[0],
    );
    expect(after).toEqual({ started: true, sessionCount: 1 });
    await client.close();
    await server.close();
    await daemon.stop();
  });
});
