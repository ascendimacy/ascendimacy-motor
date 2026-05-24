import { describe, it, expect } from "vitest";
import { routeInbound, CARD_ACTIVATION_REGEX } from "../src/router.js";
import type {
  CardActivatedEvent,
  InboundMessage,
  MessageReceivedEvent,
} from "../src/types.js";

const baseMsg = (text: string): InboundMessage => ({
  from: "5511999990000@s.whatsapp.net",
  text,
  conversationId: "conv-router-001",
  timestamp: "2026-05-23T12:00:00.000Z",
});

const assertActivated = (
  events: ReturnType<typeof routeInbound>,
  expectedCardId: string,
) => {
  expect(events).toHaveLength(2);
  const [card, received] = events;
  expect(card.type).toBe("CardActivated");
  const c = card as CardActivatedEvent;
  expect(c.cardId).toBe(expectedCardId);
  expect(c.from).toBe(baseMsg("").from);
  expect(c.conversationId).toBe(baseMsg("").conversationId);
  expect(c.raw).toBe(`card:${expectedCardId}`);
  expect(received.type).toBe("MessageReceived");
};

const assertOnlyReceived = (events: ReturnType<typeof routeInbound>) => {
  expect(events).toHaveLength(1);
  const [received] = events;
  expect(received.type).toBe("MessageReceived");
};

describe("CARD_ACTIVATION_REGEX", () => {
  it("matches simple alphanumeric+dash cardIds", () => {
    expect(CARD_ACTIVATION_REGEX.test("card:tabuada-7")).toBe(true);
    expect(CARD_ACTIVATION_REGEX.test("card:abc-123-xyz")).toBe(true);
    expect(CARD_ACTIVATION_REGEX.test("card:a")).toBe(true);
  });

  it("rejects uppercase prefix", () => {
    expect(CARD_ACTIVATION_REGEX.test("Card:tabuada")).toBe(false);
    expect(CARD_ACTIVATION_REGEX.test("CARD:tabuada")).toBe(false);
  });

  it("rejects uppercase in cardId", () => {
    expect(CARD_ACTIVATION_REGEX.test("card:Tabuada")).toBe(false);
    expect(CARD_ACTIVATION_REGEX.test("card:UPPER")).toBe(false);
  });

  it("rejects leading/trailing whitespace", () => {
    expect(CARD_ACTIVATION_REGEX.test(" card:x")).toBe(false);
    expect(CARD_ACTIVATION_REGEX.test("card:x ")).toBe(false);
    expect(CARD_ACTIVATION_REGEX.test("\tcard:x")).toBe(false);
  });

  it("rejects empty cardId", () => {
    expect(CARD_ACTIVATION_REGEX.test("card:")).toBe(false);
  });

  it("rejects underscore + other special chars", () => {
    expect(CARD_ACTIVATION_REGEX.test("card:x_y")).toBe(false);
    expect(CARD_ACTIVATION_REGEX.test("card:x.y")).toBe(false);
    expect(CARD_ACTIVATION_REGEX.test("card:x y")).toBe(false);
    expect(CARD_ACTIVATION_REGEX.test("card:x/y")).toBe(false);
  });

  it("rejects multi-line (no /m flag, $ matches end-of-string only)", () => {
    expect(CARD_ACTIVATION_REGEX.test("card:tabuada-7\nfoo")).toBe(false);
    expect(CARD_ACTIVATION_REGEX.test("foo\ncard:tabuada-7")).toBe(false);
  });

  it("rejects trailing chars after valid cardId", () => {
    expect(CARD_ACTIVATION_REGEX.test("card:tabuada-7!")).toBe(false);
    expect(CARD_ACTIVATION_REGEX.test("card:tabuada-7?id=1")).toBe(false);
  });
});

describe("routeInbound", () => {
  it("emits CardActivated + MessageReceived on valid card", () => {
    const events = routeInbound(baseMsg("card:tabuada-7"));
    assertActivated(events, "tabuada-7");
  });

  it("preserves raw text in CardActivated", () => {
    const events = routeInbound(baseMsg("card:abc-123"));
    const [card] = events;
    const c = card as CardActivatedEvent;
    expect(c.raw).toBe("card:abc-123");
  });

  it("preserves InboundMessage fields in events", () => {
    const msg = baseMsg("card:tabuada-7");
    const events = routeInbound(msg);
    for (const e of events) {
      expect(e).toMatchObject({
        from: msg.from,
        conversationId: msg.conversationId,
        timestamp: msg.timestamp,
      });
    }
  });

  it("emits only MessageReceived on common text", () => {
    const events = routeInbound(baseMsg("oi tudo bem"));
    assertOnlyReceived(events);
    const m = events[0] as MessageReceivedEvent;
    expect(m.text).toBe("oi tudo bem");
  });

  it("emits only MessageReceived on near-miss patterns", () => {
    assertOnlyReceived(routeInbound(baseMsg("Card:tabuada")));
    assertOnlyReceived(routeInbound(baseMsg(" card:x")));
    assertOnlyReceived(routeInbound(baseMsg("card:")));
    assertOnlyReceived(routeInbound(baseMsg("card:UPPER")));
    assertOnlyReceived(routeInbound(baseMsg("card:x_y")));
    assertOnlyReceived(routeInbound(baseMsg("card:tabuada-7\nfoo")));
  });

  it("emits only MessageReceived on empty text", () => {
    assertOnlyReceived(routeInbound(baseMsg("")));
  });
});
