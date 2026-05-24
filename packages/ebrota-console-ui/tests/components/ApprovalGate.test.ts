import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import ApprovalGate from "../../src/components/ApprovalGate.svelte";
import {
  consoleMode,
  currentSessionId,
  currentTurnSnapshot,
  globalError,
  pendingApproval,
} from "../../src/lib/stores.js";
import type { ApiClient } from "../../src/lib/api.js";

const buildApi = (
  overrides: Partial<ApiClient> = {},
): ApiClient =>
  ({
    getStatus: vi.fn(),
    getMode: vi.fn(),
    setMode: vi.fn(),
    startCardSession: vi.fn(),
    listOptions: vi.fn(),
    overrideSelection: vi.fn(),
    listDecisions: vi.fn(),
    getPendingApproval: vi.fn(async () => null),
    approveOrEdit: vi.fn(async () => ({
      accepted: true,
      gateWasActive: true,
    })),
    endSession: vi.fn(),
    turnStateSseUrl: () => "/api/sse",
    ...overrides,
  }) as never;

beforeEach(() => {
  consoleMode.set("auto");
  currentSessionId.set(null);
  currentTurnSnapshot.set(null);
  globalError.set(null);
  pendingApproval.set(null);
});

// Helpers compartilhados pelos describes.
const apiKeepPending = (extras: Partial<ApiClient> = {}): ApiClient =>
  buildApi({
    getPendingApproval: vi.fn(async () => ({
      proposedText: "Texto original",
    })),
    ...extras,
  });

// Disable polling em tests pra evitar interferência com state setado manualmente
const NO_POLLING = 999_999;

describe("ApprovalGate.svelte — visibility", () => {
  it("não renderiza em auto mode mesmo com pending", () => {
    consoleMode.set("auto");
    pendingApproval.set({ proposedText: "x" });
    render(ApprovalGate, {
      api: apiKeepPending(),
      pollIntervalMs: NO_POLLING,
    });
    expect(screen.queryByTestId("approval-gate")).toBeNull();
  });

  it("não renderiza em semi-auto sem pending", () => {
    consoleMode.set("semi-auto");
    pendingApproval.set(null);
    render(ApprovalGate, {
      api: apiKeepPending(),
      pollIntervalMs: NO_POLLING,
    });
    expect(screen.queryByTestId("approval-gate")).toBeNull();
  });

  it("renderiza em semi-auto com pending", () => {
    consoleMode.set("semi-auto");
    pendingApproval.set({ proposedText: "Texto proposto" });
    render(ApprovalGate, {
      api: apiKeepPending(),
      pollIntervalMs: NO_POLLING,
    });
    expect(screen.getByTestId("approval-gate")).toBeDefined();
    expect(screen.getByText("Texto proposto")).toBeDefined();
  });
});

describe("ApprovalGate.svelte — actions", () => {
  beforeEach(() => {
    consoleMode.set("semi-auto");
    currentSessionId.set("sess-1");
    pendingApproval.set({ proposedText: "Texto original" });
  });

  it("Aprovar dispara approveOrEdit com approved=true", async () => {
    const approveOrEdit = vi.fn(async () => ({
      accepted: true,
      gateWasActive: true,
    }));
    render(ApprovalGate, {
      api: apiKeepPending({ approveOrEdit }),
      pollIntervalMs: NO_POLLING,
    });
    await fireEvent.click(screen.getByTestId("approve-button"));
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(approveOrEdit).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({
        approved: true,
        originalText: "Texto original",
      }),
    );
    expect(get(pendingApproval)).toBeNull();
  });

  it("Rejeitar dispara approveOrEdit com approved=false", async () => {
    const approveOrEdit = vi.fn(async () => ({
      accepted: true,
      gateWasActive: true,
    }));
    render(ApprovalGate, {
      api: apiKeepPending({ approveOrEdit }),
      pollIntervalMs: NO_POLLING,
    });
    await fireEvent.click(screen.getByTestId("reject-button"));
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(approveOrEdit).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ approved: false }),
    );
  });

  it("Editar revela textarea + botão 'Enviar editado'", async () => {
    render(ApprovalGate, {
      api: apiKeepPending(),
      pollIntervalMs: NO_POLLING,
    });
    await fireEvent.click(screen.getByTestId("edit-button"));
    await tick();
    await waitFor(() => {
      expect(screen.getByTestId("edit-textarea")).toBeDefined();
    });
    expect(screen.getByTestId("approve-edited-button")).toBeDefined();
  });

  it("Enviar editado passa editedText pro approveOrEdit", async () => {
    const approveOrEdit = vi.fn(async () => ({
      accepted: true,
      gateWasActive: true,
    }));
    render(ApprovalGate, {
      api: apiKeepPending({ approveOrEdit }),
      pollIntervalMs: NO_POLLING,
    });
    await fireEvent.click(screen.getByTestId("edit-button"));
    await tick();
    const textarea = (await waitFor(() =>
      screen.getByTestId("edit-textarea"),
    )) as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: "Texto editado" } });
    await tick();
    await fireEvent.click(screen.getByTestId("approve-edited-button"));
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(approveOrEdit).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({
        approved: true,
        editedText: "Texto editado",
      }),
    );
  });

  it("rationale incluído quando preenchido", async () => {
    const approveOrEdit = vi.fn(async () => ({
      accepted: true,
      gateWasActive: true,
    }));
    render(ApprovalGate, {
      api: apiKeepPending({ approveOrEdit }),
      pollIntervalMs: NO_POLLING,
    });
    const input = screen.getByTestId("rationale-input") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "tom mais leve" } });
    await tick();
    await fireEvent.click(screen.getByTestId("approve-button"));
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(approveOrEdit).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ rationale: "tom mais leve" }),
    );
  });

  it("turn incluído quando snapshot disponível", async () => {
    currentTurnSnapshot.set({
      sessionId: "sess-1",
      turn: 5,
      lastPhase: "materialization_ready",
      lastTimestamp: "t",
    });
    const approveOrEdit = vi.fn(async () => ({
      accepted: true,
      gateWasActive: true,
    }));
    render(ApprovalGate, {
      api: apiKeepPending({ approveOrEdit }),
      pollIntervalMs: NO_POLLING,
    });
    await fireEvent.click(screen.getByTestId("approve-button"));
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(approveOrEdit).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ turn: 5 }),
    );
  });

  it("Cancelar edição volta pro view sem textarea", async () => {
    render(ApprovalGate, {
      api: apiKeepPending(),
      pollIntervalMs: NO_POLLING,
    });
    await fireEvent.click(screen.getByTestId("edit-button"));
    await tick();
    await waitFor(() =>
      expect(screen.getByTestId("edit-textarea")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("cancel-edit-button"));
    await tick();
    await waitFor(() =>
      expect(screen.queryByTestId("edit-textarea")).toBeNull(),
    );
    expect(screen.getByTestId("proposed-text")).toBeDefined();
  });

  it("globalError populado quando approveOrEdit lança", async () => {
    const approveOrEdit = vi.fn(async () => {
      throw new Error("BFF down");
    });
    render(ApprovalGate, {
      api: apiKeepPending({ approveOrEdit }),
      pollIntervalMs: NO_POLLING,
    });
    await fireEvent.click(screen.getByTestId("approve-button"));
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(get(globalError)).toContain("BFF down");
  });
});

describe("ApprovalGate.svelte — polling fetchPending", () => {
  it("polling popula pendingApproval store", async () => {
    consoleMode.set("semi-auto");
    currentSessionId.set("sess-1");
    const getPendingApproval = vi.fn(async () => ({
      proposedText: "from polling",
    }));
    render(ApprovalGate, { api: buildApi({ getPendingApproval }), pollIntervalMs: 50 });
    // Aguarda fetch inicial + render
    await new Promise<void>((r) => setTimeout(r, 100));
    expect(get(pendingApproval)).toEqual({ proposedText: "from polling" });
    expect(getPendingApproval).toHaveBeenCalledWith("sess-1");
  });
});
