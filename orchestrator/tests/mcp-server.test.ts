import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createOrchestratorMcpServer,
  ORCHESTRATOR_MCP_NAME,
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

const sampleContentItem = {
  id: "mock-item-1",
  type: "curiosity_hook",
  domain: "linguistics",
  casel_target: ["SA"],
  age_range: [0, 99],
  surprise: 7,
  verified: true,
  base_score: 7,
  fact: "",
  bridge: "",
  quest: "",
  sacrifice_type: "reflect",
};

/**
 * Mock completo do trio cobrindo todas as tools que runTurn invoca:
 *  - motorExecucao: get_state, log_event, execute_playbook
 *  - motorDrota: extract_signals, evaluate_and_select
 *  - planejador: plan_turn
 */
const fullMockTrio = (
  overrides: {
    drotaResponse?: string;
    captureDrotaCalls?: (calls: unknown[]) => void;
  } = {},
): McpClients => {
  const drotaResponse =
    overrides.drotaResponse ?? "Resposta materializada pelo motor-drota mock";
  const drotaCalls: unknown[] = [];

  const planejador = {
    callTool: vi.fn(async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            strategicRationale: "mock rationale",
            contentPool: [
              { item: sampleContentItem, score: 7, reasons: ["mock"] },
            ],
            contextHints: {},
            instruction_addition: "",
          }),
        },
      ],
    })),
  };

  const motorDrota = {
    callTool: vi.fn(
      async (params: { name: string; arguments?: Record<string, unknown> }) => {
        if (params.name === "extract_signals") {
          return {
            content: [
              { type: "text", text: JSON.stringify({ signals: [] }) },
            ],
          };
        }
        if (params.name === "evaluate_and_select") {
          drotaCalls.push(params.arguments);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  selectedContent: {
                    item: sampleContentItem,
                    score: 7,
                    reasons: ["mock"],
                  },
                  selectionRationale: "mock",
                  linguisticMaterialization: drotaResponse,
                }),
              },
            ],
          };
        }
        throw new Error(`unexpected motorDrota tool: ${params.name}`);
      },
    ),
  };

  const motorExecucao = {
    callTool: vi.fn(
      async (params: { name: string; arguments?: Record<string, unknown> }) => {
        if (params.name === "get_state") {
          return {
            content: [{ type: "text", text: JSON.stringify(fakeState) }],
          };
        }
        if (params.name === "log_event") {
          return {
            content: [
              { type: "text", text: JSON.stringify({ logged: true }) },
            ],
          };
        }
        if (params.name === "execute_playbook") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  newState: { ...fakeState, turn: fakeState.turn + 1 },
                  eventLogged: {
                    timestamp: new Date().toISOString(),
                    type: "playbook_executed",
                    playbookId: "default",
                    data: {},
                  },
                }),
              },
            ],
          };
        }
        throw new Error(`unexpected motorExecucao tool: ${params.name}`);
      },
    ),
  };

  if (overrides.captureDrotaCalls) {
    overrides.captureDrotaCalls(drotaCalls);
  }

  return {
    planejador: planejador as never,
    motorDrota: motorDrota as never,
    motorExecucao: motorExecucao as never,
  };
};

const setupWithFullMock = async (
  opts: {
    drotaResponse?: string;
    captureDrotaCalls?: (calls: unknown[]) => void;
  } = {},
) => {
  const tracesDir = mkdtempSync(join(tmpdir(), "orchestrator-mcp-test-"));
  const daemon = new OrchestratorDaemon({
    clientsFactory: async () => fullMockTrio(opts),
    clientsDisposer: async () => undefined,
    log: () => undefined,
    now: () => "2026-05-24T12:00:00.000Z",
    tracesDir,
  });
  await daemon.start();

  const server = createOrchestratorMcpServer({ daemon });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: {} },
  );
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return {
    daemon,
    server,
    client,
    tracesDir,
    cleanup: () => rmSync(tracesDir, { recursive: true, force: true }),
  };
};

const parseJson = <T>(result: {
  content: Array<{ type: string; text?: string }>;
}): T => JSON.parse(result.content[0]!.text!) as T;

describe("orchestrator MCP server — identity + tools list", () => {
  it("identifies as ORCHESTRATOR_MCP_NAME", async () => {
    const { client, server, daemon, cleanup } = await setupWithFullMock();
    expect(client.getServerVersion()?.name).toBe(ORCHESTRATOR_MCP_NAME);
    await client.close();
    await server.close();
    await daemon.stop();
    cleanup();
  });

  it("registra startCardSession + endSession + daemon.status", async () => {
    const { client, server, daemon, cleanup } = await setupWithFullMock();
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("startCardSession");
    expect(names).toContain("endSession");
    expect(names).toContain("daemon.status");
    await client.close();
    await server.close();
    await daemon.stop();
    cleanup();
  });
});

describe("orchestrator MCP server — startCardSession (PR3 runTurn real)", () => {
  it("retorna texto materializado real do motor-drota (sem marker)", async () => {
    const { client, server, daemon, cleanup } = await setupWithFullMock({
      drotaResponse: "Vamos lá Yuji, vamos descobrir frutas vermelhas?",
    });
    const result = await client.callTool({
      name: "startCardSession",
      arguments: {
        cardId: "frutas-vermelhas",
        conversationId: "5511aaa@s.whatsapp.net",
        from: "yuji",
        pkg: {
          cardId: "frutas-vermelhas",
          raw: "# Frutas vermelhas\n\nMorango, framboesa, amora.",
          sourcePath: "/fake/path",
        },
        personaId: "paula-mendes",
      },
    });
    const out = parseJson<{
      sessionId: string;
      text: string;
      tracePath: string;
    }>(result as Parameters<typeof parseJson>[0]);
    expect(out.sessionId).toBe("paula-mendes__5511aaa@s.whatsapp.net");
    expect(out.text).toBe("Vamos lá Yuji, vamos descobrir frutas vermelhas?");
    expect(out.text).not.toContain("[pending-real-impl]");
    expect(out.tracePath).toContain("trace.json");
    expect(daemon.status().sessionCount).toBe(1);
    await client.close();
    await server.close();
    await daemon.stop();
    cleanup();
  });

  it("pkg.raw flui pro motor-drota via instruction_addition", async () => {
    let capturedCalls: unknown[] = [];
    const { client, server, daemon, cleanup } = await setupWithFullMock({
      captureDrotaCalls: (calls) => {
        capturedCalls = calls;
      },
    });
    await client.callTool({
      name: "startCardSession",
      arguments: {
        cardId: "tabuada-7",
        conversationId: "conv-instr",
        from: "yuji",
        pkg: {
          cardId: "tabuada-7",
          raw: "# Pacote tabuada do 7\n\n7x1=7, 7x2=14, 7x3=21",
          sourcePath: "/fake/path",
        },
        personaId: "paula-mendes",
      },
    });
    expect(capturedCalls).toHaveLength(1);
    const drotaArgs = capturedCalls[0] as {
      instruction_addition: string;
    };
    expect(drotaArgs.instruction_addition).toContain(
      "## Conteúdo da carta-acionada",
    );
    expect(drotaArgs.instruction_addition).toContain("cardId: tabuada-7");
    expect(drotaArgs.instruction_addition).toContain("7x1=7, 7x2=14, 7x3=21");
    await client.close();
    await server.close();
    await daemon.stop();
    cleanup();
  });
});

describe("orchestrator MCP server — endSession", () => {
  it("encerra sessão existente → { closed: true }", async () => {
    const { client, server, daemon, cleanup } = await setupWithFullMock();
    await client.callTool({
      name: "startCardSession",
      arguments: {
        cardId: "x",
        conversationId: "conv-end",
        from: "yuji",
        pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
        personaId: "paula-mendes",
      },
    });
    const result = await client.callTool({
      name: "endSession",
      arguments: { sessionId: "paula-mendes__conv-end" },
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
    cleanup();
  });

  it("endSession em sessionId inexistente → { closed: false }", async () => {
    const { client, server, daemon, cleanup } = await setupWithFullMock();
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
    cleanup();
  });
});

describe("orchestrator MCP server — daemon.status", () => {
  it("reflete sessionCount em tempo real", async () => {
    const { client, server, daemon, cleanup } = await setupWithFullMock();
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
        from: "yuji",
        pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
        personaId: "paula-mendes",
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
    cleanup();
  });
});
