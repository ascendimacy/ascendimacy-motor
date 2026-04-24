import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  EMITTED_CARDS_DDL,
  saveEmittedCard,
  getEmittedCardsByChild,
  getEmittedCardsBySession,
  getEmittedCardsInRange,
  getNextSequence,
} from "../src/cards-repo.js";
import type { EmittedCard } from "@ascendimacy/shared";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(EMITTED_CARDS_DDL);
});

afterEach(() => {
  db.close();
});

function makeCard(overrides: Partial<EmittedCard> = {}): EmittedCard {
  return {
    card_id: "c1",
    child_id: "ryo",
    session_id: "s1",
    archetype_id: "arch_1",
    front: { image_url: "data:x", narrative: "n", archetype_id: "arch_1" },
    back: {
      template: "v1-default",
      gardner_channel_icon: "✍️",
      casel_dimension: "SA",
      cheat_code: "test · hoje · ✍️",
      serial_number: "#ryo-001",
      qr_payload: "https://ebrota.app/v/c1?sig=abc",
    },
    spec_snapshot: {
      archetype: { id: "arch_1", name: "x", narrative_template: "x", casel_dimension: "SA", gardner_channel: "linguistic", rarity: "common", is_scaffold: false },
      child_id: "ryo",
      session_id: "s1",
      context_word: "test",
      casel_dimension: "SA",
      gardner_channel: "linguistic",
      issued_at: "2026-04-24T10:00:00Z",
      achievement_summary: "x",
      sequence: 1,
    },
    signature: "sig",
    issued_at: "2026-04-24T10:00:00Z",
    approved_at: "2026-04-24T11:00:00Z",
    emitted_at: "2026-04-24T12:00:00Z",
    ...overrides,
  };
}

describe("cards-repo CRUD", () => {
  it("saveEmittedCard + getEmittedCardsByChild round-trip", () => {
    saveEmittedCard(db, makeCard());
    const cards = getEmittedCardsByChild(db, "ryo");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.card_id).toBe("c1");
  });

  it("saveEmittedCard é idempotente (same card_id sobrescreve)", () => {
    saveEmittedCard(db, makeCard({ card_id: "c1", emitted_at: "2026-04-24T12:00:00Z" }));
    saveEmittedCard(db, makeCard({ card_id: "c1", emitted_at: "2026-04-25T12:00:00Z" }));
    const cards = getEmittedCardsByChild(db, "ryo");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.emitted_at).toBe("2026-04-25T12:00:00Z");
  });

  it("getEmittedCardsBySession filtra por session", () => {
    saveEmittedCard(db, makeCard({ card_id: "c1", session_id: "s1" }));
    saveEmittedCard(db, makeCard({ card_id: "c2", session_id: "s2" }));
    expect(getEmittedCardsBySession(db, "s1")).toHaveLength(1);
    expect(getEmittedCardsBySession(db, "s2")).toHaveLength(1);
  });

  it("getEmittedCardsInRange inclui [from, to) — half-open", () => {
    saveEmittedCard(db, makeCard({ card_id: "c1", emitted_at: "2026-04-24T10:00:00Z" }));
    saveEmittedCard(db, makeCard({ card_id: "c2", emitted_at: "2026-04-24T12:00:00Z" }));
    saveEmittedCard(db, makeCard({ card_id: "c3", emitted_at: "2026-04-25T10:00:00Z" }));
    const r = getEmittedCardsInRange(db, "ryo", "2026-04-24T00:00:00Z", "2026-04-25T00:00:00Z");
    expect(r.map((c) => c.card_id).sort()).toEqual(["c1", "c2"]);
  });

  it("different children are isolated", () => {
    saveEmittedCard(db, makeCard({ card_id: "c1", child_id: "ryo" }));
    saveEmittedCard(db, makeCard({ card_id: "c2", child_id: "kei" }));
    expect(getEmittedCardsByChild(db, "ryo")).toHaveLength(1);
    expect(getEmittedCardsByChild(db, "kei")).toHaveLength(1);
  });

  it("getNextSequence conta cards existentes + 1", () => {
    expect(getNextSequence(db, "ryo")).toBe(1);
    saveEmittedCard(db, makeCard({ card_id: "c1", child_id: "ryo" }));
    expect(getNextSequence(db, "ryo")).toBe(2);
    saveEmittedCard(db, makeCard({ card_id: "c2", child_id: "ryo" }));
    expect(getNextSequence(db, "ryo")).toBe(3);
  });
});
