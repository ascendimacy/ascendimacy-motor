import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import {
  createCardTelemetry,
  type CardTelemetry,
} from "../src/telemetry.js";
import type { CardActivatedEvent } from "../src/types.js";

const sha = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

const activation = (
  overrides: Partial<CardActivatedEvent> = {},
): CardActivatedEvent => ({
  type: "CardActivated",
  cardId: "tabuada-7",
  from: "5511999990000@s.whatsapp.net",
  conversationId: "conv-tele-001",
  timestamp: "2026-05-23T14:00:00.000Z",
  raw: "card:tabuada-7",
  ...overrides,
});

describe("createCardTelemetry — record + getRecent", () => {
  let telemetry: CardTelemetry;
  beforeEach(() => {
    telemetry = createCardTelemetry({
      dbPath: ":memory:",
      now: () => "2026-05-23T14:00:01.000Z",
    });
  });
  afterEach(() => {
    telemetry.close();
  });

  it("persists a CardActivatedEvent and returns autoincrement id", () => {
    const id = telemetry.record(activation());
    expect(id).toBe(1);
  });

  it("anonymizes `from` via SHA-256 (deterministic, no raw JID stored)", () => {
    telemetry.record(
      activation({ from: "5511999990000@s.whatsapp.net" }),
    );
    const recent = telemetry.getRecent(10);
    expect(recent[0]!.fromHash).toBe(
      sha("5511999990000@s.whatsapp.net"),
    );
    expect(recent[0]!.fromHash).not.toContain("@");
    expect(recent[0]!.fromHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns the full record shape on getRecent", () => {
    telemetry.record(activation());
    const recent = telemetry.getRecent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      id: 1,
      timestamp: "2026-05-23T14:00:00.000Z",
      cardId: "tabuada-7",
      fromHash: sha("5511999990000@s.whatsapp.net"),
      conversationId: "conv-tele-001",
      recordedAt: "2026-05-23T14:00:01.000Z",
    });
  });

  it("orders getRecent by recorded_at DESC then id DESC", () => {
    let now = 0;
    const tele = createCardTelemetry({
      dbPath: ":memory:",
      now: () => `2026-05-23T14:00:${String(now++).padStart(2, "0")}.000Z`,
    });
    tele.record(activation({ cardId: "card-a" }));
    tele.record(activation({ cardId: "card-b" }));
    tele.record(activation({ cardId: "card-c" }));
    const recent = tele.getRecent(10);
    expect(recent.map((r) => r.cardId)).toEqual(["card-c", "card-b", "card-a"]);
    tele.close();
  });

  it("respects limit param on getRecent", () => {
    for (let i = 0; i < 5; i++) {
      telemetry.record(activation({ cardId: `card-${i}` }));
    }
    expect(telemetry.getRecent(3)).toHaveLength(3);
    expect(telemetry.getRecent(100)).toHaveLength(5);
  });

  it("different `from` JIDs yield different fromHash; same JID yields same hash", () => {
    telemetry.record(activation({ from: "5511aaa@s.whatsapp.net" }));
    telemetry.record(activation({ from: "5511bbb@s.whatsapp.net" }));
    telemetry.record(activation({ from: "5511aaa@s.whatsapp.net" }));
    const recent = telemetry.getRecent(10);
    expect(recent[0]!.fromHash).toBe(recent[2]!.fromHash); // both 5511aaa
    expect(recent[1]!.fromHash).not.toBe(recent[0]!.fromHash);
  });
});

describe("createCardTelemetry — countByCardId", () => {
  it("counts activations per cardId", () => {
    const tele = createCardTelemetry({ dbPath: ":memory:" });
    tele.record(activation({ cardId: "card-x" }));
    tele.record(activation({ cardId: "card-x" }));
    tele.record(activation({ cardId: "card-y" }));
    expect(tele.countByCardId("card-x")).toBe(2);
    expect(tele.countByCardId("card-y")).toBe(1);
    expect(tele.countByCardId("nonexistent")).toBe(0);
    tele.close();
  });
});

describe("createCardTelemetry — close", () => {
  it("close() is idempotent", () => {
    const tele = createCardTelemetry({ dbPath: ":memory:" });
    tele.close();
    tele.close();
    // no throw
  });

  it("record after close throws", () => {
    const tele = createCardTelemetry({ dbPath: ":memory:" });
    tele.close();
    expect(() => tele.record(activation())).toThrow(/db já fechado/);
  });

  it("getRecent after close throws", () => {
    const tele = createCardTelemetry({ dbPath: ":memory:" });
    tele.close();
    expect(() => tele.getRecent(10)).toThrow(/db já fechado/);
  });
});

describe("createCardTelemetry — persistence smoke", () => {
  it("schema persists across instances (file-backed)", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "motor-channels-tele-"));
    const dbPath = join(dir, "telemetry.db");
    try {
      const t1 = createCardTelemetry({ dbPath });
      t1.record(activation({ cardId: "persist-1" }));
      t1.close();

      const t2 = createCardTelemetry({ dbPath });
      expect(t2.countByCardId("persist-1")).toBe(1);
      t2.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
