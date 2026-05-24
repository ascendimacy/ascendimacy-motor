/**
 * Integration test C-MX-07 — daemon + motor-channels + trio mocks.
 * S-OD-13 (PR7).
 *
 * Cobre o ciclo end-to-end em processo único (sem stdio): mensagem
 * `card:<id>` simulada no mock channel → createInboundBridge dispatcha
 * pro daemon → daemon roda turn com trio mockado → resposta materializada
 * volta via channel.send. Em semi-auto, approvalGate wireado ao daemon
 * resolve via approveOrEdit.
 *
 * NÃO testa stdio MCP transport (suficientemente coberto por
 * tests/mcp-server.test.ts via InMemoryTransport). Foco aqui é a
 * orquestração cross-workspace.
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  createInboundBridge,
  createMockChannel,
  createCardPackageLoader,
  type ApprovalGate,
  type OrchestratorBridge,
  type RateLimiter,
} from "@ascendimacy/motor-channels";
import { OrchestratorDaemon } from "../src/daemon.js";
import type { McpClients } from "../src/mcp-clients.js";
import type {
  ScoredContentItem,
  SessionState,
} from "@ascendimacy/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Reusa fixtures de pacote do motor-channels (não duplica)
const FIXTURES_DIR = resolve(
  __dirname,
  "../../packages/motor-channels/tests/fixtures/pacotes",
);

const fakeState: SessionState = {
  sessionId: "stub",
  trustLevel: 0.3,
  budgetRemaining: 100,
  eventLog: [],
  turn: 0,
};

const sampleItem: ScoredContentItem = {
  item: {
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
  },
  score: 7,
  reasons: ["mock"],
};

const buildTrio = (drotaResponse: string): McpClients => {
  const planejador = {
    callTool: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            strategicRationale: "mock",
            contentPool: [sampleItem],
            contextHints: {},
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
              selectedContent: sampleItem,
              selectionRationale: "mock",
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
          content: [
            { type: "text", text: JSON.stringify({ logged: true }) },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              newState: { ...fakeState, turn: 1 },
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

const setupIntegration = async (
  opts: { drotaResponse?: string; semiAutoTimeoutMs?: number } = {},
) => {
  const tracesDir = mkdtempSync(join(tmpdir(), "orchestrator-integration-"));
  const daemon = new OrchestratorDaemon({
    clientsFactory: async () =>
      buildTrio(opts.drotaResponse ?? "Resposta motor-drota"),
    clientsDisposer: async () => undefined,
    log: () => undefined,
    now: () => "2026-05-24T13:00:00.000Z",
    tracesDir,
  });
  await daemon.start();

  const channel = createMockChannel();
  const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
  const passthroughLimit: RateLimiter = { acquire: async () => {} };

  // Bridge backed por daemon.runCardTurn — produção wireia via MCP stdio;
  // aqui é in-process direct call.
  const bridge: OrchestratorBridge = {
    async startCardSession(input) {
      const result = await daemon.runCardTurn({
        cardId: input.cardId,
        conversationId: input.conversationId,
        from: input.from,
        pkg: input.pkg,
        personaId: "paula-mendes",
        semiAutoTimeoutMs: opts.semiAutoTimeoutMs ?? 0,
      });
      return { text: result.text };
    },
  };

  return {
    daemon,
    channel,
    loader,
    bridge,
    passthroughLimit,
    cleanup: () => rmSync(tracesDir, { recursive: true, force: true }),
  };
};

const flush = async () => {
  await new Promise<void>((r) => setTimeout(r, 50));
};

describe("Integration C-MX-07 — daemon + motor-channels (auto mode)", () => {
  it("inbound card:tabuada-7 → daemon runs turn → channel.send com resposta materializada", async () => {
    const { daemon, channel, loader, bridge, passthroughLimit, cleanup } =
      await setupIntegration({ drotaResponse: "Vamos lá Yuji!" });
    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: passthroughLimit,
    });
    ib.start();
    channel.simulateInbound({
      from: "5511aaa@s.whatsapp.net",
      text: "card:tabuada-7",
      conversationId: "5511aaa@s.whatsapp.net",
      timestamp: "2026-05-24T13:00:00.000Z",
    });
    await flush();
    expect(channel.sentMessages).toEqual([
      {
        to: "5511aaa@s.whatsapp.net",
        text: "Vamos lá Yuji!",
      },
    ]);
    expect(daemon.status().sessionCount).toBe(1);
    await daemon.stop();
    cleanup();
  });

  it("daemon turn_events buffer recebe os 4 eventos pós-turn (planning/selection/material/playbook)", async () => {
    const { daemon, channel, loader, bridge, passthroughLimit, cleanup } =
      await setupIntegration();
    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: passthroughLimit,
    });
    ib.start();
    channel.simulateInbound({
      from: "5511aaa@s.whatsapp.net",
      text: "card:tabuada-7",
      conversationId: "conv-events-integration",
      timestamp: "2026-05-24T13:00:00.000Z",
    });
    await flush();
    const snap = daemon.subscribeTurnState(
      "paula-mendes__conv-events-integration",
      0,
    );
    expect(snap.events.map((e) => e.type)).toEqual([
      "planning_started",
      "selection_made",
      "materialization_ready",
      "playbook_executed",
    ]);
    await daemon.stop();
    cleanup();
  });

  it("cardNotFoundMessage envia fallback sem disparar daemon", async () => {
    const { daemon, channel, loader, bridge, passthroughLimit, cleanup } =
      await setupIntegration();
    const bridgeSpy = vi.spyOn(bridge, "startCardSession");
    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: passthroughLimit,
    });
    ib.start();
    channel.simulateInbound({
      from: "5511aaa@s.whatsapp.net",
      text: "card:nao-existe-404",
      conversationId: "conv-404",
      timestamp: "2026-05-24T13:00:00.000Z",
    });
    await flush();
    expect(bridgeSpy).not.toHaveBeenCalled();
    expect(channel.sentMessages[0]!.text).toBe("Carta não encontrada.");
    expect(daemon.status().sessionCount).toBe(0);
    await daemon.stop();
    cleanup();
  });
});

describe("Integration C-MX-07 — semi-auto: approvalGate + override", () => {
  it("approvalGate aprovação edita → channel.send envia editado", async () => {
    const { daemon, channel, loader, bridge, passthroughLimit, cleanup } =
      await setupIntegration({ drotaResponse: "Texto motor-drota original" });

    // approvalGate.resolver amarra ao daemon: submete pra approval +
    // BFF simulado aprova depois.
    const approvalGate: ApprovalGate = {
      resolver: (input) =>
        daemon.submitForApproval(
          `paula-mendes__${input.conversationId}`,
          input.proposedText,
          { timeoutMs: 5000 },
        ),
    };

    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: passthroughLimit,
      approvalGate,
    });
    ib.start();

    channel.simulateInbound({
      from: "5511aaa@s.whatsapp.net",
      text: "card:tabuada-7",
      conversationId: "conv-edit",
      timestamp: "2026-05-24T13:00:00.000Z",
    });

    // Aguarda turn rodar + approvalGate registrar
    await new Promise<void>((r) => setTimeout(r, 60));
    expect(daemon.getPendingApproval("paula-mendes__conv-edit")).toEqual({
      proposedText: "Texto motor-drota original",
    });

    // Simula Jun editando + aprovando via daemon
    daemon.approveOrEdit("paula-mendes__conv-edit", {
      approved: true,
      editedText: "Texto editado pelo Jun",
      rationale: "Tom mais leve",
    });

    await flush();
    expect(channel.sentMessages[0]!.text).toBe("Texto editado pelo Jun");
    await daemon.stop();
    cleanup();
  });

  it("approvalGate rejeição → outbound NÃO enviado", async () => {
    const { daemon, channel, loader, bridge, passthroughLimit, cleanup } =
      await setupIntegration();

    const approvalGate: ApprovalGate = {
      resolver: (input) =>
        daemon.submitForApproval(
          `paula-mendes__${input.conversationId}`,
          input.proposedText,
          { timeoutMs: 5000 },
        ),
    };

    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: passthroughLimit,
      approvalGate,
    });
    ib.start();

    channel.simulateInbound({
      from: "5511aaa@s.whatsapp.net",
      text: "card:tabuada-7",
      conversationId: "conv-reject",
      timestamp: "2026-05-24T13:00:00.000Z",
    });

    await new Promise<void>((r) => setTimeout(r, 60));
    daemon.approveOrEdit("paula-mendes__conv-reject", {
      approved: false,
      rationale: "Tom errado",
    });

    await flush();
    expect(channel.sentMessages).toEqual([]);
    await daemon.stop();
    cleanup();
  });

  it("approvalGate timeout fail-safe envia original (defaultDecision approved=true)", async () => {
    const { daemon, channel, loader, bridge, passthroughLimit, cleanup } =
      await setupIntegration({ drotaResponse: "Texto auto" });

    const approvalGate: ApprovalGate = {
      resolver: (input) =>
        daemon.submitForApproval(
          `paula-mendes__${input.conversationId}`,
          input.proposedText,
          { timeoutMs: 50 },
        ),
    };

    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: passthroughLimit,
      approvalGate,
    });
    ib.start();
    channel.simulateInbound({
      from: "5511aaa@s.whatsapp.net",
      text: "card:tabuada-7",
      conversationId: "conv-timeout-approval",
      timestamp: "2026-05-24T13:00:00.000Z",
    });
    // 100ms > 50ms timeout, garante fail-safe disparar
    await new Promise<void>((r) => setTimeout(r, 120));
    expect(channel.sentMessages[0]!.text).toBe("Texto auto");
    await daemon.stop();
    cleanup();
  });
});
