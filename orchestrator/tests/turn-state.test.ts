import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOrchestratorMcpServer } from "../src/mcp-server.js";
import {
  OrchestratorDaemon,
  type TurnEventsSnapshot,
} from "../src/daemon.js";
import type { McpClients } from "../src/mcp-clients.js";
import type { SessionState } from "@ascendimacy/shared";
import type { TurnStateEvent } from "../src/orchestrator.js";

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

const fullMockTrio = (
  opts: { drotaResponse?: string } = {},
): McpClients => {
  const drotaResponse = opts.drotaResponse ?? "Resposta mock";
  const planejador = {
    callTool: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            strategicRationale: "mock rationale",
            contentPool: [
              { item: sampleContentItem, score: 7, reasons: ["mock"] },
            ],
            contextHints: { foo: "bar" },
          }),
        },
      ],
    }),
  };
  const motorDrota = {
    callTool: async (params: { name: string }) => {
      if (params.name === "extract_signals") {
        return {
          content: [{ type: "text", text: JSON.stringify({ signals: [] }) }],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              selectedContent: {
                item: sampleContentItem,
                score: 7,
                reasons: [],
              },
              selectionRationale: "mock rationale drota",
              linguisticMaterialization: drotaResponse,
            }),
          },
        ],
      };
    },
  };
  const motorExecucao = {
    callTool: async (params: { name: string }) => {
      if (params.name === "get_state") {
        return {
          content: [{ type: "text", text: JSON.stringify(fakeState) }],
        };
      }
      if (params.name === "log_event") {
        return {
          content: [{ type: "text", text: JSON.stringify({ logged: true }) }],
        };
      }
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
    },
  };
  return {
    planejador: planejador as never,
    motorDrota: motorDrota as never,
    motorExecucao: motorExecucao as never,
  };
};

const setup = async () => {
  const tracesDir = mkdtempSync(join(tmpdir(), "orchestrator-turn-state-"));
  const daemon = new OrchestratorDaemon({
    clientsFactory: async () => fullMockTrio(),
    clientsDisposer: async () => undefined,
    log: () => undefined,
    now: () => "2026-05-24T13:00:00.000Z",
    tracesDir,
  });
  await daemon.start();
  return {
    daemon,
    cleanup: () => rmSync(tracesDir, { recursive: true, force: true }),
  };
};

describe("Daemon — turn event buffer + subscribeTurnState", () => {
  it("emite os 4 eventos em ordem após runCardTurn", async () => {
    const { daemon, cleanup } = await setup();
    await daemon.runCardTurn({
      cardId: "tabuada-7",
      conversationId: "conv-events",
      from: "yuji",
      pkg: { cardId: "tabuada-7", raw: "# pkg", sourcePath: "/x" },
      personaId: "paula-mendes",
    });
    const snap = daemon.subscribeTurnState(
      "paula-mendes__conv-events",
      0,
    );
    expect(snap.events.map((e) => e.type)).toEqual([
      "planning_started",
      "selection_made",
      "materialization_ready",
      "playbook_executed",
    ]);
    expect(snap.totalEmitted).toBe(4);
    expect(snap.nextIndex).toBe(4);
    await daemon.stop();
    cleanup();
  });

  it("payload de planning_started inclui contentPoolIds + contextHints", async () => {
    const { daemon, cleanup } = await setup();
    await daemon.runCardTurn({
      cardId: "x",
      conversationId: "conv-p1",
      from: "yuji",
      pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
      personaId: "paula-mendes",
    });
    const snap = daemon.subscribeTurnState("paula-mendes__conv-p1", 0);
    const planning = snap.events.find(
      (e) => e.type === "planning_started",
    ) as Extract<TurnStateEvent, { type: "planning_started" }>;
    expect(planning.payload.contentPoolIds).toEqual(["mock-item-1"]);
    expect(planning.payload.contentPoolSize).toBe(1);
    expect(planning.payload.contextHints).toEqual({ foo: "bar" });
    expect(planning.payload.strategicRationale).toBe("mock rationale");
    await daemon.stop();
    cleanup();
  });

  it("payload de selection_made tem id + score + rationale", async () => {
    const { daemon, cleanup } = await setup();
    await daemon.runCardTurn({
      cardId: "x",
      conversationId: "conv-p2",
      from: "yuji",
      pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
      personaId: "paula-mendes",
    });
    const snap = daemon.subscribeTurnState("paula-mendes__conv-p2", 0);
    const sel = snap.events.find(
      (e) => e.type === "selection_made",
    ) as Extract<TurnStateEvent, { type: "selection_made" }>;
    expect(sel.payload.selectedContentId).toBe("mock-item-1");
    expect(sel.payload.selectedContentScore).toBe(7);
    expect(sel.payload.selectionRationale).toBe("mock rationale drota");
    await daemon.stop();
    cleanup();
  });

  it("materialization_ready carrega proposedText + flag instructionAdditionApplied", async () => {
    const { daemon, cleanup } = await setup();
    await daemon.runCardTurn({
      cardId: "x",
      conversationId: "conv-p3",
      from: "yuji",
      pkg: { cardId: "x", raw: "## pkg raw", sourcePath: "/x" },
      personaId: "paula-mendes",
    });
    const snap = daemon.subscribeTurnState("paula-mendes__conv-p3", 0);
    const mat = snap.events.find(
      (e) => e.type === "materialization_ready",
    ) as Extract<TurnStateEvent, { type: "materialization_ready" }>;
    expect(mat.payload.proposedText).toBe("Resposta mock");
    expect(mat.payload.instructionAdditionApplied).toBe(true);
  });

  it("sinceIndex retorna só eventos novos", async () => {
    const { daemon, cleanup } = await setup();
    await daemon.runCardTurn({
      cardId: "x",
      conversationId: "conv-since",
      from: "yuji",
      pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
      personaId: "paula-mendes",
    });
    const first = daemon.subscribeTurnState(
      "paula-mendes__conv-since",
      0,
    );
    expect(first.events).toHaveLength(4);
    const second = daemon.subscribeTurnState(
      "paula-mendes__conv-since",
      first.nextIndex,
    );
    expect(second.events).toHaveLength(0);
    expect(second.nextIndex).toBe(4);
    await daemon.stop();
    cleanup();
  });

  it("per-session isolation: events de uma sessão não vazam pra outra", async () => {
    const { daemon, cleanup } = await setup();
    await daemon.runCardTurn({
      cardId: "x",
      conversationId: "conv-a",
      from: "yuji",
      pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
      personaId: "paula-mendes",
    });
    // Sessão B nunca rodou
    const snapA = daemon.subscribeTurnState("paula-mendes__conv-a", 0);
    const snapB = daemon.subscribeTurnState("paula-mendes__conv-b", 0);
    expect(snapA.events).toHaveLength(4);
    expect(snapB.events).toHaveLength(0);
    expect(snapB.totalEmitted).toBe(0);
    await daemon.stop();
    cleanup();
  });

  it("sessionId sem events → snapshot vazio", async () => {
    const { daemon, cleanup } = await setup();
    const snap = daemon.subscribeTurnState("nonexistent", 0);
    expect(snap).toEqual({ events: [], nextIndex: 0, totalEmitted: 0 });
    await daemon.stop();
    cleanup();
  });

  it("stop() limpa buffer de eventos", async () => {
    const { daemon, cleanup } = await setup();
    await daemon.runCardTurn({
      cardId: "x",
      conversationId: "conv-clear",
      from: "yuji",
      pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
      personaId: "paula-mendes",
    });
    expect(
      daemon.subscribeTurnState("paula-mendes__conv-clear", 0).events,
    ).toHaveLength(4);
    await daemon.stop();
    // Após stop, buffer limpo
    expect(
      daemon.subscribeTurnState("paula-mendes__conv-clear", 0).events,
    ).toHaveLength(0);
    cleanup();
  });
});

describe("MCP server — subscribe_turn_state tool E2E", () => {
  it("tool retorna snapshot via InMemoryTransport", async () => {
    const { daemon, cleanup } = await setup();
    const server = createOrchestratorMcpServer({ daemon });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test", version: "0.0.0" },
      { capabilities: {} },
    );
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    await client.callTool({
      name: "startCardSession",
      arguments: {
        cardId: "tabuada-7",
        conversationId: "conv-mcp",
        from: "yuji",
        pkg: { cardId: "tabuada-7", raw: "# pkg", sourcePath: "/x" },
        personaId: "paula-mendes",
      },
    });

    const result = await client.callTool({
      name: "subscribe_turn_state",
      arguments: { sessionId: "paula-mendes__conv-mcp" },
    });
    const snap = JSON.parse(
      (
        result as {
          content: Array<{ type: string; text?: string }>;
        }
      ).content[0]!.text!,
    ) as TurnEventsSnapshot;
    expect(snap.events.map((e) => e.type)).toEqual([
      "planning_started",
      "selection_made",
      "materialization_ready",
      "playbook_executed",
    ]);
    expect(snap.nextIndex).toBe(4);

    await client.close();
    await server.close();
    await daemon.stop();
    cleanup();
  });

  it("sinceIndex via MCP tool funciona (polling pattern)", async () => {
    const { daemon, cleanup } = await setup();
    const server = createOrchestratorMcpServer({ daemon });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test", version: "0.0.0" },
      { capabilities: {} },
    );
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    await client.callTool({
      name: "startCardSession",
      arguments: {
        cardId: "x",
        conversationId: "conv-poll",
        from: "yuji",
        pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
        personaId: "paula-mendes",
      },
    });

    const second = await client.callTool({
      name: "subscribe_turn_state",
      arguments: { sessionId: "paula-mendes__conv-poll", sinceIndex: 4 },
    });
    const snap = JSON.parse(
      (
        second as {
          content: Array<{ type: string; text?: string }>;
        }
      ).content[0]!.text!,
    ) as TurnEventsSnapshot;
    expect(snap.events).toHaveLength(0);
    expect(snap.nextIndex).toBe(4);

    await client.close();
    await server.close();
    await daemon.stop();
    cleanup();
  });
});
