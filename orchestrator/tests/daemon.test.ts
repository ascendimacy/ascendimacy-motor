import { describe, it, expect, vi } from "vitest";
import { OrchestratorDaemon, type SessionRuntime } from "../src/daemon.js";
import type { McpClients } from "../src/mcp-clients.js";
import type { SessionState } from "@ascendimacy/shared";

const fakeState = (overrides: Partial<SessionState> = {}): SessionState => ({
  sessionId: "stub",
  trustLevel: 0.3,
  budgetRemaining: 100,
  eventLog: [],
  turn: 0,
  ...overrides,
});

const mockMotorExecucaoWithState = (state: SessionState) =>
  ({
    callTool: vi.fn(async () => ({
      content: [{ type: "text", text: JSON.stringify(state) }],
    })),
  }) as never;

const mockClients = (): McpClients =>
  ({
    planejador: {} as never,
    motorDrota: {} as never,
    motorExecucao: mockMotorExecucaoWithState(fakeState()),
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

describe("OrchestratorDaemon — startSession + endSession (S-OD-04)", () => {
  it("startSession hidrata state via motorExecucao + registra runtime", async () => {
    const state = fakeState({ trustLevel: 0.7, turn: 5 });
    const daemon = new OrchestratorDaemon({
      clientsFactory: async () =>
        ({
          planejador: {} as never,
          motorDrota: {} as never,
          motorExecucao: mockMotorExecucaoWithState(state),
        }) satisfies McpClients,
      clientsDisposer: async () => undefined,
      log: () => undefined,
      now: () => "2026-05-24T13:00:00.000Z",
    });
    await daemon.start();
    const runtime = await daemon.startSession({
      personaId: "yuji",
      conversationId: "5511aaa@s.whatsapp.net",
    });
    expect(runtime.sessionId).toBe("yuji__5511aaa@s.whatsapp.net");
    expect(runtime.personaId).toBe("yuji");
    expect(runtime.conversationId).toBe("5511aaa@s.whatsapp.net");
    expect(runtime.startedAt).toBe("2026-05-24T13:00:00.000Z");
    expect(runtime.state?.trustLevel).toBe(0.7);
    expect(runtime.state?.turn).toBe(5);
    expect(daemon.status().sessionCount).toBe(1);
  });

  it("startSession com sessionId explícito usa direto (sem derivar)", async () => {
    const daemon = new OrchestratorDaemon({
      clientsFactory: async () => mockClients(),
      clientsDisposer: async () => undefined,
      log: () => undefined,
    });
    await daemon.start();
    const runtime = await daemon.startSession({
      personaId: "yuji",
      conversationId: "conv-x",
      sessionId: "custom-sess-id",
    });
    expect(runtime.sessionId).toBe("custom-sess-id");
  });

  it("startSession idempotente — mesma key retorna runtime existente", async () => {
    const daemon = new OrchestratorDaemon({
      clientsFactory: async () => mockClients(),
      clientsDisposer: async () => undefined,
      log: () => undefined,
    });
    await daemon.start();
    const a = await daemon.startSession({
      personaId: "yuji",
      conversationId: "conv-1",
    });
    const b = await daemon.startSession({
      personaId: "yuji",
      conversationId: "conv-1",
    });
    expect(a).toBe(b);
    expect(daemon.status().sessionCount).toBe(1);
  });

  it("startSession sem daemon iniciado → throws", async () => {
    const daemon = new OrchestratorDaemon({
      clientsFactory: async () => mockClients(),
      clientsDisposer: async () => undefined,
      log: () => undefined,
    });
    await expect(
      daemon.startSession({
        personaId: "yuji",
        conversationId: "conv-x",
      }),
    ).rejects.toThrow(/daemon não iniciado/);
  });

  it("endSession remove sessão existente → { closed: true }", async () => {
    const daemon = new OrchestratorDaemon({
      clientsFactory: async () => mockClients(),
      clientsDisposer: async () => undefined,
      log: () => undefined,
    });
    await daemon.start();
    const r = await daemon.startSession({
      personaId: "yuji",
      conversationId: "conv-end",
    });
    const result = await daemon.endSession(r.sessionId);
    expect(result).toEqual({ closed: true });
    expect(daemon.status().sessionCount).toBe(0);
  });

  it("endSession em sessionId ausente → { closed: false }, idempotente", async () => {
    const daemon = new OrchestratorDaemon({
      clientsFactory: async () => mockClients(),
      clientsDisposer: async () => undefined,
      log: () => undefined,
    });
    await daemon.start();
    expect(await daemon.endSession("nonexistent")).toEqual({ closed: false });
    expect(await daemon.endSession("nonexistent")).toEqual({ closed: false });
  });

  it("listSessions devolve snapshot das sessões ativas", async () => {
    const daemon = new OrchestratorDaemon({
      clientsFactory: async () => mockClients(),
      clientsDisposer: async () => undefined,
      log: () => undefined,
    });
    await daemon.start();
    await daemon.startSession({
      personaId: "yuji",
      conversationId: "conv-a",
    });
    await daemon.startSession({
      personaId: "kei",
      conversationId: "conv-b",
    });
    const list = daemon.listSessions();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.personaId).sort()).toEqual(["kei", "yuji"]);
  });
});

describe("OrchestratorDaemon — getClients (PR2 helper)", () => {
  it("getClients sem start lança erro", () => {
    const daemon = new OrchestratorDaemon({
      clientsFactory: async () => mockClients(),
      clientsDisposer: async () => undefined,
      log: () => undefined,
    });
    expect(() => daemon.getClients()).toThrow(/daemon não iniciado/);
  });

  it("getClients após start retorna trio", async () => {
    const daemon = new OrchestratorDaemon({
      clientsFactory: async () => mockClients(),
      clientsDisposer: async () => undefined,
      log: () => undefined,
    });
    await daemon.start();
    const c = daemon.getClients();
    expect(c.motorExecucao).toBeDefined();
  });
});
