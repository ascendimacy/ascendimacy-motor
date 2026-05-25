import { describe, it, expect, vi } from "vitest";
import { runOneShot } from "../src/oneshot.js";
import type { McpClients } from "../src/mcp-clients.js";

/**
 * runOneShot é thin wrapper sobre connectAll + runTurn + disconnectAll.
 * Testa principalmente o contrato de DI (factory/dispose injetáveis).
 * O `runTurn` real precisa de filesystem + LLM, então testamos com
 * mock clients que NÃO percorrem o pipeline completo — basta verificar
 * que factory e dispose são chamados corretamente.
 */

const mockClients = (): McpClients =>
  ({
    planejador: {} as never,
    motorDrota: {} as never,
    motorExecucao: {} as never,
  }) satisfies McpClients;

describe("runOneShot", () => {
  it("chama factory + dispose mesmo quando runTurn lança", async () => {
    const factory = vi.fn(async () => mockClients());
    const dispose = vi.fn(async () => undefined);

    // runTurn lança porque clients mock não têm callTool real.
    await expect(
      runOneShot({
        persona: "paula-mendes",
        message: "oi",
        sessionId: "test-1",
        tracesDir: "/tmp",
        clientsFactory: factory,
        clientsDisposer: dispose,
      }),
    ).rejects.toBeDefined();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("propaga erro do factory sem chamar dispose", async () => {
    const factory = vi.fn(async () => {
      throw new Error("factory boom");
    });
    const dispose = vi.fn(async () => undefined);

    await expect(
      runOneShot({
        persona: "paula-mendes",
        message: "oi",
        sessionId: "test-2",
        tracesDir: "/tmp",
        clientsFactory: factory,
        clientsDisposer: dispose,
      }),
    ).rejects.toThrow(/factory boom/);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
  });
});
