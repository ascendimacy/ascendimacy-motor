import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOrchestratorMcpServer } from "../src/mcp-server.js";
import {
  OrchestratorDaemon,
  type ApprovalDecision,
  type ApproveOrEditResult,
} from "../src/daemon.js";
import type { McpClients } from "../src/mcp-clients.js";

const mockClients = (): McpClients =>
  ({
    planejador: {} as never,
    motorDrota: {} as never,
    motorExecucao: {} as never,
  }) satisfies McpClients;

const setupDaemon = async () => {
  const daemon = new OrchestratorDaemon({
    clientsFactory: async () => mockClients(),
    clientsDisposer: async () => undefined,
    log: () => undefined,
  });
  await daemon.start();
  return daemon;
};

describe("Daemon — submitForApproval + approveOrEdit", () => {
  it("approveOrEdit em sessão sem approval pendente → gateWasActive=false", async () => {
    const daemon = await setupDaemon();
    expect(daemon.approveOrEdit("any", { approved: true })).toEqual({
      accepted: false,
      gateWasActive: false,
    });
    await daemon.stop();
  });

  it("submitForApproval resolve com decisão de approveOrEdit", async () => {
    const daemon = await setupDaemon();
    const pendingPromise = daemon.submitForApproval(
      "sess-1",
      "Texto proposto",
      { timeoutMs: 5000 },
    );
    // approve depois
    await new Promise<void>((r) => setTimeout(r, 10));
    const result = daemon.approveOrEdit("sess-1", {
      approved: true,
      editedText: "Texto editado",
      rationale: "Tom mais leve",
    });
    expect(result).toEqual({ accepted: true, gateWasActive: true });
    const decision = await pendingPromise;
    expect(decision).toEqual({
      approved: true,
      editedText: "Texto editado",
      rationale: "Tom mais leve",
    });
    await daemon.stop();
  });

  it("submitForApproval timeout resolve com defaultDecision (default approved=true)", async () => {
    const daemon = await setupDaemon();
    const decision = await daemon.submitForApproval(
      "sess-timeout",
      "Texto proposto",
      { timeoutMs: 30 },
    );
    expect(decision).toEqual({ approved: true });
    await daemon.stop();
  });

  it("submitForApproval timeout com defaultDecision custom", async () => {
    const daemon = await setupDaemon();
    const decision = await daemon.submitForApproval(
      "sess-paranoid",
      "Texto proposto",
      {
        timeoutMs: 30,
        defaultDecision: { approved: false, rationale: "no decision" },
      },
    );
    expect(decision).toEqual({ approved: false, rationale: "no decision" });
    await daemon.stop();
  });

  it("getPendingApproval retorna proposedText enquanto pendente, undefined depois", async () => {
    const daemon = await setupDaemon();
    const p = daemon.submitForApproval("sess-snap", "Hello", {
      timeoutMs: 5000,
    });
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(daemon.getPendingApproval("sess-snap")).toEqual({
      proposedText: "Hello",
    });
    daemon.approveOrEdit("sess-snap", { approved: true });
    await p;
    expect(daemon.getPendingApproval("sess-snap")).toBeUndefined();
    await daemon.stop();
  });

  it("submitForApproval sobrescreve approval pendente prévia (último win, antiga resolve com default)", async () => {
    const daemon = await setupDaemon();
    const first = daemon.submitForApproval("sess-rep", "Texto 1", {
      timeoutMs: 5000,
    });
    await new Promise<void>((r) => setTimeout(r, 10));
    const second = daemon.submitForApproval("sess-rep", "Texto 2", {
      timeoutMs: 5000,
    });
    // first resolve com default approved=true
    const firstDecision = await first;
    expect(firstDecision).toEqual({ approved: true });
    // Approve second
    daemon.approveOrEdit("sess-rep", { approved: false });
    const secondDecision = await second;
    expect(secondDecision).toEqual({ approved: false });
    await daemon.stop();
  });

  it("stop() resolve approvals pendentes com approved=false (conservador)", async () => {
    const daemon = await setupDaemon();
    const p = daemon.submitForApproval("sess-stop", "Hello", {
      timeoutMs: 5000,
    });
    await new Promise<void>((r) => setTimeout(r, 10));
    await daemon.stop();
    const decision = await p;
    expect(decision).toEqual({ approved: false });
  });
});

describe("MCP server — approve_or_edit + get_pending_approval E2E", () => {
  const setupE2E = async () => {
    const daemon = await setupDaemon();
    const server = createOrchestratorMcpServer({ daemon });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test", version: "0.0.0" },
      { capabilities: {} },
    );
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    return { daemon, server, client };
  };

  it("tools registradas: approve_or_edit + get_pending_approval", async () => {
    const { client, server, daemon } = await setupE2E();
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("approve_or_edit");
    expect(names).toContain("get_pending_approval");
    await client.close();
    await server.close();
    await daemon.stop();
  });

  it("approve_or_edit via MCP resolve approval pendente", async () => {
    const { client, server, daemon } = await setupE2E();
    const pending = daemon.submitForApproval("sess-mcp", "Hello", {
      timeoutMs: 5000,
    });
    await new Promise<void>((r) => setTimeout(r, 10));

    const result = await client.callTool({
      name: "approve_or_edit",
      arguments: {
        sessionId: "sess-mcp",
        decision: {
          approved: true,
          editedText: "Hola",
          rationale: "spanish demo",
        },
      },
    });
    const parsed = JSON.parse(
      (
        result as {
          content: Array<{ type: string; text?: string }>;
        }
      ).content[0]!.text!,
    ) as ApproveOrEditResult;
    expect(parsed).toEqual({ accepted: true, gateWasActive: true });

    const decision = (await pending) as ApprovalDecision;
    expect(decision.editedText).toBe("Hola");

    await client.close();
    await server.close();
    await daemon.stop();
  });

  it("get_pending_approval via MCP retorna snapshot ou null", async () => {
    const { client, server, daemon } = await setupE2E();
    // Sem approval pendente → null
    const before = await client.callTool({
      name: "get_pending_approval",
      arguments: { sessionId: "sess-gp" },
    });
    expect(
      JSON.parse(
        (
          before as {
            content: Array<{ type: string; text?: string }>;
          }
        ).content[0]!.text!,
      ),
    ).toBeNull();

    // Submit + check snapshot
    const p = daemon.submitForApproval("sess-gp", "Hello", {
      timeoutMs: 5000,
    });
    await new Promise<void>((r) => setTimeout(r, 10));
    const after = await client.callTool({
      name: "get_pending_approval",
      arguments: { sessionId: "sess-gp" },
    });
    expect(
      JSON.parse(
        (
          after as {
            content: Array<{ type: string; text?: string }>;
          }
        ).content[0]!.text!,
      ),
    ).toEqual({ proposedText: "Hello" });

    daemon.approveOrEdit("sess-gp", { approved: true });
    await p;
    await client.close();
    await server.close();
    await daemon.stop();
  });
});
