/**
 * Unit tests — executor repetition_inquiry consumer (ops#1068 v0.1 follow-up #2).
 *
 * Cobre:
 *  - Resolução de inquiry pendente PRÉ-execute (parse userMessage + log _answered/_skipped)
 *  - Logging _asked PÓS-execute quando contextHints.repetition_inquiry ativo
 *  - Logging _suppressed quando contextHints.repetition_inquiry_suppressed
 *  - Persistência de default_on_skip no _asked event pra parsing futuro
 *  - Edge: userMessage vazio com pending → no _answered/_skipped
 *  - Edge: inquiry pendente JÁ RESOLVIDA por _answered/_skipped → não re-resolve
 */

import { describe, it, expect, beforeEach } from "vitest";
import { executePlaybook } from "../src/executor.js";
import { getState, closeDb, logEvent } from "../src/state-manager.js";
import type { PlaybookInventory } from "../src/types.js";

const inv: PlaybookInventory = {
  version: "test",
  playbooks: [
    {
      id: "p.test",
      title: "test",
      category: "test",
      triggers: ["x"],
      content: "y",
      estimatedSacrifice: 1,
      estimatedConfidenceGain: 1,
    },
  ],
};

function freshSession(): string {
  return `inq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("executor — _asked logging post-execute", () => {
  beforeEach(() => closeDb());

  it("loga _asked quando contextHints.repetition_inquiry ativo", () => {
    const sessionId = freshSession();
    executePlaybook(
      {
        sessionId,
        playbookId: "p.test",
        output: "Quer (a), (b) ou (c)?",
        metadata: {
          contextHints: {
            repetition_inquiry: {
              candidate_ids: ["item-x"],
              threshold_used: 2,
              default_on_skip: "b",
            },
          },
        },
      },
      inv,
    );
    const state = getState(sessionId);
    const askedEvents = state.eventLog.filter((e) => e.type === "repetition_inquiry_asked");
    expect(askedEvents).toHaveLength(1);
    expect(askedEvents[0]!.data).toMatchObject({
      candidate_ids: ["item-x"],
      threshold_used: 2,
      default_on_skip: "b",
    });
  });

  it("NÃO loga _asked quando contextHints ausente", () => {
    const sessionId = freshSession();
    executePlaybook(
      { sessionId, playbookId: "p.test", output: "oi", metadata: {} },
      inv,
    );
    const state = getState(sessionId);
    expect(state.eventLog.filter((e) => e.type === "repetition_inquiry_asked")).toHaveLength(0);
  });

  it("NÃO loga _asked quando candidate_ids vazio", () => {
    const sessionId = freshSession();
    executePlaybook(
      {
        sessionId,
        playbookId: "p.test",
        output: "oi",
        metadata: {
          contextHints: {
            repetition_inquiry: { candidate_ids: [], default_on_skip: "b" },
          },
        },
      },
      inv,
    );
    const state = getState(sessionId);
    expect(state.eventLog.filter((e) => e.type === "repetition_inquiry_asked")).toHaveLength(0);
  });

  it("loga _suppressed quando contextHints.repetition_inquiry_suppressed", () => {
    const sessionId = freshSession();
    executePlaybook(
      {
        sessionId,
        playbookId: "p.test",
        output: "oi",
        metadata: {
          contextHints: { repetition_inquiry_suppressed: "cap_reached" },
        },
      },
      inv,
    );
    const state = getState(sessionId);
    const suppressed = state.eventLog.filter((e) => e.type === "repetition_inquiry_suppressed");
    expect(suppressed).toHaveLength(1);
    expect((suppressed[0]!.data as { reason?: string }).reason).toBe("cap_reached");
  });
});

describe("executor — pre-execute parse de userMessage com inquiry pendente", () => {
  beforeEach(() => closeDb());

  function setupAskedSession(defaultOnSkip: "a" | "b" | "c" = "b"): string {
    const sessionId = freshSession();
    // Garante o session existe + loga asked event mock
    getState(sessionId);
    logEvent(sessionId, {
      timestamp: "2026-05-14T10:00:00.000Z",
      type: "repetition_inquiry_asked",
      data: {
        candidate_ids: ["prev-item"],
        threshold_used: 2,
        default_on_skip: defaultOnSkip,
      },
    });
    return sessionId;
  }

  it("userMessage 'b' → loga _answered com choice=b", () => {
    const sessionId = setupAskedSession();
    executePlaybook(
      {
        sessionId,
        playbookId: "p.test",
        output: "resposta seguinte",
        metadata: { userMessage: "b" },
      },
      inv,
    );
    const state = getState(sessionId);
    const answered = state.eventLog.filter((e) => e.type === "repetition_inquiry_answered");
    expect(answered).toHaveLength(1);
    expect((answered[0]!.data as { choice?: string }).choice).toBe("b");
    expect((answered[0]!.data as { stage?: string }).stage).toBe("literal");
  });

  it("userMessage 'tanto faz' → _skipped com default_on_skip honrado", () => {
    const sessionId = setupAskedSession("a");
    executePlaybook(
      {
        sessionId,
        playbookId: "p.test",
        output: "resposta seguinte",
        metadata: { userMessage: "tanto faz" },
      },
      inv,
    );
    const state = getState(sessionId);
    const skipped = state.eventLog.filter((e) => e.type === "repetition_inquiry_skipped");
    expect(skipped).toHaveLength(1);
    expect((skipped[0]!.data as { choice?: string }).choice).toBe("a");
    expect((skipped[0]!.data as { defaulted_to?: string }).defaulted_to).toBe("a");
  });

  it("userMessage 'aquele do Gohan' → _answered com choice=a (natural language)", () => {
    const sessionId = setupAskedSession();
    executePlaybook(
      {
        sessionId,
        playbookId: "p.test",
        output: "ok!",
        metadata: { userMessage: "aquele do Gohan, por favor" },
      },
      inv,
    );
    const state = getState(sessionId);
    const answered = state.eventLog.filter((e) => e.type === "repetition_inquiry_answered");
    expect(answered).toHaveLength(1);
    expect((answered[0]!.data as { choice?: string }).choice).toBe("a");
  });

  it("userMessage vazio com pending → NÃO loga _answered nem _skipped", () => {
    const sessionId = setupAskedSession();
    executePlaybook(
      {
        sessionId,
        playbookId: "p.test",
        output: "ok",
        metadata: { userMessage: "" },
      },
      inv,
    );
    const state = getState(sessionId);
    expect(state.eventLog.filter((e) => e.type === "repetition_inquiry_answered")).toHaveLength(0);
    expect(state.eventLog.filter((e) => e.type === "repetition_inquiry_skipped")).toHaveLength(0);
  });

  it("sem pending (no _asked event) → não tenta parsear", () => {
    const sessionId = freshSession();
    executePlaybook(
      {
        sessionId,
        playbookId: "p.test",
        output: "ok",
        metadata: { userMessage: "qualquer coisa" },
      },
      inv,
    );
    const state = getState(sessionId);
    expect(state.eventLog.filter((e) => e.type === "repetition_inquiry_answered")).toHaveLength(0);
    expect(state.eventLog.filter((e) => e.type === "repetition_inquiry_skipped")).toHaveLength(0);
  });

  it("inquiry JÁ RESOLVIDA (_answered posterior) → não re-resolve", () => {
    const sessionId = setupAskedSession();
    // Loga _answered manualmente — resolve a pendência
    logEvent(sessionId, {
      timestamp: "2026-05-14T10:01:00.000Z",
      type: "repetition_inquiry_answered",
      data: { choice: "c", stage: "literal", confidence: 1 },
    });
    // Agora chama executor com userMessage — não deve criar segundo _answered
    executePlaybook(
      {
        sessionId,
        playbookId: "p.test",
        output: "ok",
        metadata: { userMessage: "b" },
      },
      inv,
    );
    const state = getState(sessionId);
    const answered = state.eventLog.filter((e) => e.type === "repetition_inquiry_answered");
    expect(answered).toHaveLength(1);
    expect((answered[0]!.data as { choice?: string }).choice).toBe("c"); // o original, não 'b'
  });
});

describe("executor — fluxo completo asked → answered → new asked", () => {
  beforeEach(() => closeDb());

  it("turn 1 asked → turn 2 answered + novo asked NÃO disparado (sem inquiry hint)", () => {
    const sessionId = freshSession();
    // Turn 1: ask
    executePlaybook(
      {
        sessionId,
        playbookId: "p.test",
        output: "Quer (a), (b), ou (c)?",
        metadata: {
          contextHints: {
            repetition_inquiry: {
              candidate_ids: ["x"],
              threshold_used: 2,
              default_on_skip: "b",
            },
          },
        },
      },
      inv,
    );
    // Turn 2: user responde "1" → choice a
    executePlaybook(
      {
        sessionId,
        playbookId: "p.test",
        output: "ok, vamos lá",
        metadata: { userMessage: "1" },
      },
      inv,
    );
    const state = getState(sessionId);
    const asked = state.eventLog.filter((e) => e.type === "repetition_inquiry_asked");
    const answered = state.eventLog.filter((e) => e.type === "repetition_inquiry_answered");
    expect(asked).toHaveLength(1);
    expect(answered).toHaveLength(1);
    expect((answered[0]!.data as { choice?: string }).choice).toBe("a");
  });
});
