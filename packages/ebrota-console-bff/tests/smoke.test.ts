import { describe, it, expect } from "vitest";
import type {
  BffStatus,
  ConsoleMode,
  SessionSummary,
  ApprovalDecisionPayload,
} from "../src/types.js";

describe("ebrota-console-bff types smoke", () => {
  it("constructs a BffStatus", () => {
    const status: BffStatus = {
      mode: "auto",
      daemonConnected: true,
      channelConnected: true,
      sessionCount: 0,
      startedAt: "2026-05-24T13:00:00.000Z",
    };
    expect(status.daemonConnected).toBe(true);
  });

  it("ConsoleMode aceita só auto ou semi-auto", () => {
    const a: ConsoleMode = "auto";
    const b: ConsoleMode = "semi-auto";
    expect(a).toBe("auto");
    expect(b).toBe("semi-auto");
  });

  it("constructs a SessionSummary", () => {
    const s: SessionSummary = {
      sessionId: "paula-mendes__conv-001",
      personaId: "paula-mendes",
      conversationId: "conv-001",
      kind: "real",
      startedAt: "2026-05-24T13:00:00.000Z",
      turnCount: 5,
      hasOverrides: false,
    };
    expect(s.kind).toBe("real");
  });

  it("constructs ApprovalDecisionPayload — approved + editedText", () => {
    const d: ApprovalDecisionPayload = {
      approved: true,
      editedText: "Texto editado",
      rationale: "tom mais leve",
    };
    expect(d.approved).toBe(true);
    expect(d.editedText).toBeDefined();
  });

  it("ApprovalDecisionPayload — rejection sem editedText", () => {
    const d: ApprovalDecisionPayload = {
      approved: false,
      rationale: "tom errado",
    };
    expect(d.approved).toBe(false);
    expect(d.editedText).toBeUndefined();
  });
});
