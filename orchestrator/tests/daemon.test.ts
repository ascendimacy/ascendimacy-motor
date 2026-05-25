import { describe, it, expect, vi } from "vitest";
import { OrchestratorDaemon, type SessionRuntime } from "../src/daemon.js";
import type { McpClients } from "../src/mcp-clients.js";

const mockClients = (): McpClients =>
  ({
    planejador: {} as never,
    motorDrota: {} as never,
    motorExecucao: {} as never,
  }) satisfies McpClients;

const baseOpts = () => {
  const factory = vi.fn(async () => mockClients());
  const dispose = vi.fn(async () => undefined);
  const log = vi.fn();
  return { factory, dispose, log };
};

const sampleSession = (overrides?: Partial<SessionRuntime>): SessionRuntime => ({
  sessionId: "sess-001",
  personaId: "yuji-realista-v1",
  conversationId: "5511999@s.whatsapp.net",
  startedAt: "2026-05-24T12:00:00.000Z",
  ...overrides,
});

describe("OrchestratorDaemon — lifecycle", () => {
  it("start() connects clients via factory", async () => {
    const { factory, dispose, log } = baseOpts();
    const daemon = new OrchestratorDaemon({
      clientsFactory: factory,
      clientsDisposer: dispose,
      log,
    });
    await daemon.start();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(daemon.status().started).toBe(true);
    expect(log).toHaveBeenCalledWith("[orchestrator-daemon] trio connected");
  });

  it("start() is idempotent", async () => {
    const { factory, dispose } = baseOpts();
    const daemon = new OrchestratorDaemon({
      clientsFactory: factory,
      clientsDisposer: dispose,
      log: () => undefined,
    });
    await daemon.start();
    await daemon.start();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("stop() disposes clients", async () => {
    const { factory, dispose } = baseOpts();
    const daemon = new OrchestratorDaemon({
      clientsFactory: factory,
      clientsDisposer: dispose,
      log: () => undefined,
    });
    await daemon.start();
    await daemon.stop();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(daemon.status().started).toBe(false);
  });

  it("stop() is idempotent (sem start, com start+stop+stop)", async () => {
    const { factory, dispose } = baseOpts();
    const daemon = new OrchestratorDaemon({
      clientsFactory: factory,
      clientsDisposer: dispose,
      log: () => undefined,
    });
    await daemon.stop();
    expect(dispose).not.toHaveBeenCalled();
    await daemon.start();
    await daemon.stop();
    await daemon.stop();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe("OrchestratorDaemon — session registry (PR1 scaffolding)", () => {
  it("registers + retrieves a session", async () => {
    const daemon = new OrchestratorDaemon({
      clientsFactory: async () => mockClients(),
      clientsDisposer: async () => undefined,
      log: () => undefined,
    });
    await daemon.start();
    const s = sampleSession();
    daemon.registerSession(s);
    expect(daemon.getSession("sess-001")).toBe(s);
    expect(daemon.status().sessionCount).toBe(1);
  });

  it("rejects duplicate sessionId", async () => {
    const daemon = new OrchestratorDaemon({
      clientsFactory: async () => mockClients(),
      clientsDisposer: async () => undefined,
      log: () => undefined,
    });
    await daemon.start();
    daemon.registerSession(sampleSession());
    expect(() => daemon.registerSession(sampleSession())).toThrow(
      /sessionId duplicado/,
    );
  });

  it("unregisterSession removes from registry; idempotent quando ausente", async () => {
    const daemon = new OrchestratorDaemon({
      clientsFactory: async () => mockClients(),
      clientsDisposer: async () => undefined,
      log: () => undefined,
    });
    await daemon.start();
    daemon.registerSession(sampleSession());
    daemon.unregisterSession("sess-001");
    expect(daemon.getSession("sess-001")).toBeUndefined();
    daemon.unregisterSession("nonexistent");
    daemon.unregisterSession("sess-001");
  });

  it("stop() clears session registry", async () => {
    const daemon = new OrchestratorDaemon({
      clientsFactory: async () => mockClients(),
      clientsDisposer: async () => undefined,
      log: () => undefined,
    });
    await daemon.start();
    daemon.registerSession(sampleSession({ sessionId: "a" }));
    daemon.registerSession(sampleSession({ sessionId: "b" }));
    expect(daemon.status().sessionCount).toBe(2);
    await daemon.stop();
    expect(daemon.status().sessionCount).toBe(0);
  });
});
