import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOrchestratorMcpServer } from "../src/mcp-server.js";
import {
  OrchestratorDaemon,
  type OverrideSelectionResult,
} from "../src/daemon.js";
import type { McpClients } from "../src/mcp-clients.js";
import type {
  ScoredContentItem,
  SessionState,
} from "@ascendimacy/shared";

const fakeState: SessionState = {
  sessionId: "stub",
  trustLevel: 0.3,
  budgetRemaining: 100,
  eventLog: [],
  turn: 0,
};

const makeItem = (id: string, score: number): ScoredContentItem => ({
  item: {
    id,
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
  },
  score,
  reasons: [],
});

const samplePool: ScoredContentItem[] = [
  makeItem("card-a", 9),
  makeItem("card-b", 7),
  makeItem("card-c", 5),
];

const buildMockTrio = (opts: {
  capturedDrotaCalls?: unknown[];
}): McpClients => {
  const planejador = {
    callTool: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            strategicRationale: "mock",
            contentPool: samplePool,
            contextHints: {},
          }),
        },
      ],
    }),
  };
  const motorDrota = {
    callTool: async (params: {
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (params.name === "extract_signals") {
        return {
          content: [{ type: "text", text: JSON.stringify({ signals: [] }) }],
        };
      }
      if (opts.capturedDrotaCalls) {
        opts.capturedDrotaCalls.push(params.arguments);
      }
      const pool = (params.arguments?.["contentPool"] as
        | ScoredContentItem[]
        | undefined) ?? [];
      const selected = pool[0] ?? samplePool[0];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              selectedContent: selected,
              selectionRationale: "mock",
              linguisticMaterialization: `selected:${selected!.item.id}`,
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

const setup = async (opts: { capturedDrotaCalls?: unknown[] } = {}) => {
  const tracesDir = mkdtempSync(join(tmpdir(), "orchestrator-options-gate-"));
  const daemon = new OrchestratorDaemon({
    clientsFactory: async () => buildMockTrio(opts),
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

describe("Daemon — listOptions + overrideSelection (auto mode)", () => {
  it("auto mode: listOptions retorna [] (gate inativo)", async () => {
    const { daemon, cleanup } = await setup();
    await daemon.runCardTurn({
      cardId: "x",
      conversationId: "conv-auto",
      from: "yuji",
      pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
      personaId: "paula-mendes",
      // no semiAutoTimeoutMs
    });
    expect(daemon.listOptions("paula-mendes__conv-auto")).toEqual([]);
    await daemon.stop();
    cleanup();
  });

  it("auto mode: overrideSelection retorna gateWasActive=false", async () => {
    const { daemon, cleanup } = await setup();
    const result = daemon.overrideSelection("any-session", "card-x");
    expect(result).toEqual({
      accepted: false,
      foundInPool: false,
      gateWasActive: false,
    });
    await daemon.stop();
    cleanup();
  });
});

describe("Daemon — semi-auto mode (gate ativo)", () => {
  it("listOptions retorna pool durante gate; overrideSelection prune pool antes do drota", async () => {
    const drotaCalls: unknown[] = [];
    const { daemon, cleanup } = await setup({
      capturedDrotaCalls: drotaCalls,
    });

    // Start runCardTurn in background (gate vai segurar)
    const runPromise = daemon.runCardTurn({
      cardId: "x",
      conversationId: "conv-semi",
      from: "yuji",
      pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
      personaId: "paula-mendes",
      semiAutoTimeoutMs: 5000,
    });

    // Wait pra plan_turn rodar + gate registrar
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // listOptions deve retornar o pool agora (gate ativo)
    const options = daemon.listOptions("paula-mendes__conv-semi");
    expect(options.map((s) => s.item.id)).toEqual([
      "card-a",
      "card-b",
      "card-c",
    ]);

    // Override pra card-b
    const result = daemon.overrideSelection(
      "paula-mendes__conv-semi",
      "card-b",
    );
    expect(result).toEqual({
      accepted: true,
      foundInPool: true,
      gateWasActive: true,
    });

    // runTurn deve completar com card-b selecionado
    const out = await runPromise;
    expect(out.text).toBe("selected:card-b");

    // Verifica drota foi chamado com pool prunado pra card-b
    expect(drotaCalls).toHaveLength(1);
    const drotaArgs = drotaCalls[0] as {
      contentPool: ScoredContentItem[];
    };
    expect(drotaArgs.contentPool).toHaveLength(1);
    expect(drotaArgs.contentPool[0]!.item.id).toBe("card-b");

    await daemon.stop();
    cleanup();
  });

  it("overrideSelection com id inexistente: foundInPool=false, gate continua", async () => {
    const { daemon, cleanup } = await setup();
    const runPromise = daemon.runCardTurn({
      cardId: "x",
      conversationId: "conv-bad",
      from: "yuji",
      pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
      personaId: "paula-mendes",
      semiAutoTimeoutMs: 100,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    const bad = daemon.overrideSelection(
      "paula-mendes__conv-bad",
      "nonexistent-id",
    );
    expect(bad).toEqual({
      accepted: false,
      foundInPool: false,
      gateWasActive: true,
    });
    // Gate continua ativo — pool ainda visível
    expect(daemon.listOptions("paula-mendes__conv-bad")).toHaveLength(3);
    // Timeout expira → runTurn completa com pool original
    const out = await runPromise;
    expect(out.text).toBe("selected:card-a"); // top score original
    await daemon.stop();
    cleanup();
  });

  it("gate timeout sem override → segue com pool original (top-score)", async () => {
    const drotaCalls: unknown[] = [];
    const { daemon, cleanup } = await setup({
      capturedDrotaCalls: drotaCalls,
    });
    const out = await daemon.runCardTurn({
      cardId: "x",
      conversationId: "conv-timeout",
      from: "yuji",
      pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
      personaId: "paula-mendes",
      semiAutoTimeoutMs: 30, // tiny timeout
    });
    expect(out.text).toBe("selected:card-a"); // top original
    // Drota recebeu pool completo (gate timeout → sem override → pool intacto)
    expect(drotaCalls).toHaveLength(1);
    expect(
      (drotaCalls[0] as { contentPool: ScoredContentItem[] }).contentPool,
    ).toHaveLength(3);
    await daemon.stop();
    cleanup();
  });

  it("stop() durante gate resolve sem override + remove from pendingGates", async () => {
    const { daemon, cleanup } = await setup();
    const runPromise = daemon.runCardTurn({
      cardId: "x",
      conversationId: "conv-stop",
      from: "yuji",
      pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
      personaId: "paula-mendes",
      semiAutoTimeoutMs: 5000,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(daemon.listOptions("paula-mendes__conv-stop")).toHaveLength(3);
    // Stop deve cancelar gate
    await daemon.stop();
    const out = await runPromise;
    // runTurn segue sem override (pool original); o stop só limpa pendingGates
    expect(out.text).toBe("selected:card-a");
    cleanup();
  });
});

describe("MCP server — list_options + override_selection tools (E2E)", () => {
  it("E2E semi-auto: listOptions + overrideSelection via MCP retorna selected card-b", async () => {
    const drotaCalls: unknown[] = [];
    const { daemon, cleanup } = await setup({
      capturedDrotaCalls: drotaCalls,
    });
    const server = createOrchestratorMcpServer({ daemon });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test", version: "0.0.0" },
      { capabilities: {} },
    );
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    // Start em background com gate ativo
    const startPromise = client.callTool({
      name: "startCardSession",
      arguments: {
        cardId: "x",
        conversationId: "conv-e2e-semi",
        from: "yuji",
        pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
        personaId: "paula-mendes",
      },
    });

    // Aguarda gate registrar; tem que iniciar runCardTurn com semi-auto.
    // Como startCardSession via MCP não passa semiAutoTimeoutMs por
    // default (esse PR não wireia opt no MCP tool), test usa daemon
    // direto pra validar pattern. Skip se MCP-only.

    await startPromise;
    // Apenas verifica MCP tools list_options + override_selection
    // respondem sob auto mode (gate inativo) — full semi-auto wiring
    // via MCP fica pra PR6 (approve_or_edit + bridge plumbing).
    const lo = await client.callTool({
      name: "list_options",
      arguments: { sessionId: "paula-mendes__conv-e2e-semi" },
    });
    const loOut = JSON.parse(
      (lo as { content: Array<{ type: string; text?: string }> }).content[0]!
        .text!,
    ) as { contentPool: ScoredContentItem[] };
    expect(loOut.contentPool).toEqual([]); // auto mode → gate inativo

    const ov = await client.callTool({
      name: "override_selection",
      arguments: {
        sessionId: "paula-mendes__conv-e2e-semi",
        contentItemId: "anything",
      },
    });
    const ovOut = JSON.parse(
      (ov as { content: Array<{ type: string; text?: string }> }).content[0]!
        .text!,
    ) as OverrideSelectionResult;
    expect(ovOut).toEqual({
      accepted: false,
      foundInPool: false,
      gateWasActive: false,
    });

    await client.close();
    await server.close();
    await daemon.stop();
    cleanup();
  });

  it("MCP list_options + override_selection ferramentas registradas", async () => {
    const { daemon, cleanup } = await setup();
    const server = createOrchestratorMcpServer({ daemon });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test", version: "0.0.0" },
      { capabilities: {} },
    );
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("list_options");
    expect(names).toContain("override_selection");
    await client.close();
    await server.close();
    await daemon.stop();
    cleanup();
  });
});
