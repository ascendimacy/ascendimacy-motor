/**
 * Unit tests — repetition-inquiry (ops#1068).
 *
 * Cobre extractRepetitionCounts (window 20 turns ∧ 7d), extractProfileConfig,
 * countInquiriesInSession, turnsSinceLastInquiry, shouldAskRepetitionInquiry
 * (conjunção i-vii + brejo override absoluto).
 */

import { describe, it, expect } from "vitest";
import type { EventEntry } from "@ascendimacy/shared";
import {
  extractRepetitionCounts,
  extractProfileConfig,
  countInquiriesInSession,
  turnsSinceLastInquiry,
  shouldAskRepetitionInquiry,
  DEFAULT_INQUIRY_TURN_GATE,
  DEFAULT_INQUIRY_COOLDOWN_TURNS,
  DEFAULT_REPETITION_THRESHOLD,
} from "../src/strategist/repetition-inquiry.js";

function makeExecutedEvent(
  contentId: string,
  iso: string,
): EventEntry {
  return {
    timestamp: iso,
    type: "playbook_executed",
    data: { selectedContentId: contentId },
  };
}

function makeInquiryAskedEvent(iso: string): EventEntry {
  return {
    timestamp: iso,
    type: "repetition_inquiry_asked",
    data: {},
  };
}

describe("extractRepetitionCounts — window 20 turns ∧ 7 dias", () => {
  it("conta repetições simples dentro da window", () => {
    const log: EventEntry[] = [
      makeExecutedEvent("x", "2026-05-14T10:00:00.000Z"),
      makeExecutedEvent("y", "2026-05-14T10:01:00.000Z"),
      makeExecutedEvent("x", "2026-05-14T10:02:00.000Z"),
      makeExecutedEvent("x", "2026-05-14T10:03:00.000Z"),
    ];
    const counts = extractRepetitionCounts(log, { nowIso: "2026-05-14T10:05:00.000Z" });
    expect(counts.get("x")).toBe(3);
    expect(counts.get("y")).toBe(1);
  });

  it("ignora events fora da janela temporal de 7 dias", () => {
    const log: EventEntry[] = [
      makeExecutedEvent("old", "2026-01-01T00:00:00.000Z"),
      makeExecutedEvent("recent", "2026-05-14T09:00:00.000Z"),
    ];
    const counts = extractRepetitionCounts(log, { nowIso: "2026-05-14T10:00:00.000Z" });
    expect(counts.get("old")).toBeUndefined();
    expect(counts.get("recent")).toBe(1);
  });

  it("aplica bound de turns (window=20) — usa últimos 20 events só", () => {
    const log: EventEntry[] = [];
    // 25 events de "old" recentes em timestamp
    for (let i = 0; i < 25; i++) {
      log.push(makeExecutedEvent("old", `2026-05-14T09:${String(i).padStart(2, "0")}:00.000Z`));
    }
    log.push(makeExecutedEvent("new", "2026-05-14T09:30:00.000Z"));
    const counts = extractRepetitionCounts(log, { nowIso: "2026-05-14T10:00:00.000Z", windowTurns: 20 });
    // Últimos 20 = 19 "old" + 1 "new"
    expect(counts.get("old")).toBe(19);
    expect(counts.get("new")).toBe(1);
  });

  it("ignora events sem selectedContentId", () => {
    const log: EventEntry[] = [
      makeExecutedEvent("x", "2026-05-14T10:00:00.000Z"),
      { timestamp: "2026-05-14T10:01:00.000Z", type: "playbook_executed", data: {} },
      { timestamp: "2026-05-14T10:02:00.000Z", type: "playbook_executed", data: { selectedContentId: null } },
    ];
    const counts = extractRepetitionCounts(log, { nowIso: "2026-05-14T10:05:00.000Z" });
    expect(counts.get("x")).toBe(1);
    expect(counts.size).toBe(1);
  });

  it("ignora events de outros types", () => {
    const log: EventEntry[] = [
      makeExecutedEvent("x", "2026-05-14T10:00:00.000Z"),
      { timestamp: "2026-05-14T10:01:00.000Z", type: "transition_evaluated", data: { selectedContentId: "x" } },
    ];
    const counts = extractRepetitionCounts(log, { nowIso: "2026-05-14T10:05:00.000Z" });
    expect(counts.get("x")).toBe(1);
  });
});

describe("extractProfileConfig — defensive parse de freeform profile", () => {
  it("retorna {} quando profile ausente/sem campo", () => {
    expect(extractProfileConfig(undefined)).toEqual({});
    expect(extractProfileConfig({})).toEqual({});
    expect(extractProfileConfig({ other: "field" })).toEqual({});
  });

  it("retorna {} quando repetition_inquiry não é object", () => {
    expect(extractProfileConfig({ repetition_inquiry: "string" })).toEqual({});
    expect(extractProfileConfig({ repetition_inquiry: 42 })).toEqual({});
    expect(extractProfileConfig({ repetition_inquiry: null })).toEqual({});
  });

  it("parseia enabled bool", () => {
    expect(extractProfileConfig({ repetition_inquiry: { enabled: false } })).toEqual({ enabled: false });
    expect(extractProfileConfig({ repetition_inquiry: { enabled: true } })).toEqual({ enabled: true });
  });

  it("parseia threshold_repetitions number", () => {
    expect(extractProfileConfig({ repetition_inquiry: { threshold_repetitions: 5 } }))
      .toEqual({ threshold_repetitions: 5 });
  });

  it("parseia default_on_skip apenas valores a/b/c", () => {
    expect(extractProfileConfig({ repetition_inquiry: { default_on_skip: "b" } }))
      .toEqual({ default_on_skip: "b" });
    expect(extractProfileConfig({ repetition_inquiry: { default_on_skip: "invalid" } }))
      .toEqual({});
  });

  it("ignora tipos errados sem crashar", () => {
    expect(extractProfileConfig({
      repetition_inquiry: {
        enabled: "yes",
        threshold_repetitions: "five",
        default_on_skip: 42,
      },
    })).toEqual({});
  });
});

describe("countInquiriesInSession + turnsSinceLastInquiry", () => {
  it("countInquiriesInSession conta repetition_inquiry_asked events", () => {
    const log: EventEntry[] = [
      makeExecutedEvent("x", "2026-05-14T10:00:00.000Z"),
      makeInquiryAskedEvent("2026-05-14T10:01:00.000Z"),
      makeExecutedEvent("y", "2026-05-14T10:02:00.000Z"),
      makeInquiryAskedEvent("2026-05-14T10:03:00.000Z"),
    ];
    expect(countInquiriesInSession(log)).toBe(2);
  });

  it("turnsSinceLastInquiry = Infinity quando nunca houve", () => {
    const log: EventEntry[] = [makeExecutedEvent("x", "2026-05-14T10:00:00.000Z")];
    expect(turnsSinceLastInquiry(log)).toBe(Number.POSITIVE_INFINITY);
  });

  it("turnsSinceLastInquiry conta playbook_executed após última asked", () => {
    const log: EventEntry[] = [
      makeExecutedEvent("a", "2026-05-14T10:00:00.000Z"),
      makeInquiryAskedEvent("2026-05-14T10:01:00.000Z"),
      makeExecutedEvent("b", "2026-05-14T10:02:00.000Z"),
      makeExecutedEvent("c", "2026-05-14T10:03:00.000Z"),
      makeExecutedEvent("d", "2026-05-14T10:04:00.000Z"),
    ];
    expect(turnsSinceLastInquiry(log)).toBe(3);
  });
});

// ─── shouldAskRepetitionInquiry — conjunção i-vii ────────────────────────

function baseDecisionInput(overrides: Partial<Parameters<typeof shouldAskRepetitionInquiry>[0]> = {}) {
  return {
    profileConfig: {},
    repetitionCounts: new Map([["x", 3]]),
    turn: 6,
    sessionMode: "solo" as const,
    brejoActive: false,
    inquiriesThisSession: 0,
    turnsSinceLastInquiry: Number.POSITIVE_INFINITY,
    eligiblePoolIds: ["x", "y"],
    ...overrides,
  };
}

describe("shouldAskRepetitionInquiry — happy path", () => {
  it("ask=true quando todas as condições i-vii valem", () => {
    const d = shouldAskRepetitionInquiry(baseDecisionInput());
    expect(d.ask).toBe(true);
    expect(d.candidateIds).toEqual(["x"]);
    expect(d.thresholdUsed).toBe(DEFAULT_REPETITION_THRESHOLD);
    expect(d.defaultOnSkip).toBe("b");
    expect(d.suppressedReason).toBeUndefined();
  });

  it("respeita threshold per-persona override", () => {
    const d = shouldAskRepetitionInquiry(baseDecisionInput({
      profileConfig: { threshold_repetitions: 5 },
      repetitionCounts: new Map([["x", 3]]),
    }));
    expect(d.ask).toBe(false);
    expect(d.suppressedReason).toBe("no_pool_options");
    expect(d.thresholdUsed).toBe(5);
  });

  it("propaga default_on_skip per-persona (Ryo)", () => {
    const d = shouldAskRepetitionInquiry(baseDecisionInput({
      profileConfig: { default_on_skip: "b" },
    }));
    expect(d.defaultOnSkip).toBe("b");
  });
});

describe("shouldAskRepetitionInquiry — suppressed reasons", () => {
  it("profile_disabled quando enabled=false (Saki)", () => {
    const d = shouldAskRepetitionInquiry(baseDecisionInput({
      profileConfig: { enabled: false },
    }));
    expect(d.ask).toBe(false);
    expect(d.suppressedReason).toBe("profile_disabled");
  });

  it("brejo_active sobrepõe TUDO (override absoluto)", () => {
    const d = shouldAskRepetitionInquiry(baseDecisionInput({
      brejoActive: true,
    }));
    expect(d.ask).toBe(false);
    expect(d.suppressedReason).toBe("brejo_active");
  });

  it("brejo_active vence até quando profile_disabled também valeria? Sim — checa primeiro disabled", () => {
    // profile_disabled checked FIRST (intent: respect explicit user config).
    const d = shouldAskRepetitionInquiry(baseDecisionInput({
      profileConfig: { enabled: false },
      brejoActive: true,
    }));
    expect(d.ask).toBe(false);
    expect(d.suppressedReason).toBe("profile_disabled");
  });

  it("joint_mode quando sessionMode=joint", () => {
    const d = shouldAskRepetitionInquiry(baseDecisionInput({
      sessionMode: "joint",
    }));
    expect(d.ask).toBe(false);
    expect(d.suppressedReason).toBe("joint_mode");
  });

  it("turn_too_early quando turn < gate (4)", () => {
    const d = shouldAskRepetitionInquiry(baseDecisionInput({
      turn: DEFAULT_INQUIRY_TURN_GATE - 1,
    }));
    expect(d.ask).toBe(false);
    expect(d.suppressedReason).toBe("turn_too_early");
  });

  it("cap_reached quando já houve 1 inquiry na sessão", () => {
    const d = shouldAskRepetitionInquiry(baseDecisionInput({
      inquiriesThisSession: 1,
    }));
    expect(d.ask).toBe(false);
    expect(d.suppressedReason).toBe("cap_reached");
  });

  it("cooldown quando turnsSinceLastInquiry < 8", () => {
    const d = shouldAskRepetitionInquiry(baseDecisionInput({
      inquiriesThisSession: 0, // cap NÃO atingido (cap=1)
      turnsSinceLastInquiry: DEFAULT_INQUIRY_COOLDOWN_TURNS - 1,
    }));
    // Como cap_reached é checked antes de cooldown e inquiries=0, devemos cair no cooldown
    // Mas cap=1 e inquiries=0 → passa cap. cooldown deve disparar.
    expect(d.ask).toBe(false);
    expect(d.suppressedReason).toBe("cooldown");
  });

  it("no_pool_options quando nenhum item count ≥ threshold elegível", () => {
    const d = shouldAskRepetitionInquiry(baseDecisionInput({
      repetitionCounts: new Map([["x", 1]]), // count abaixo do threshold (2)
    }));
    expect(d.ask).toBe(false);
    expect(d.suppressedReason).toBe("no_pool_options");
  });

  it("no_pool_options quando item ≥ threshold mas NÃO está no pool elegível (expirado)", () => {
    const d = shouldAskRepetitionInquiry(baseDecisionInput({
      repetitionCounts: new Map([["expired", 5]]),
      eligiblePoolIds: ["other"],
    }));
    expect(d.ask).toBe(false);
    expect(d.suppressedReason).toBe("no_pool_options");
  });
});
