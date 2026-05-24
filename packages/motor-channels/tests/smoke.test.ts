import { describe, it, expect } from "vitest";
import type {
  InboundMessage,
  OutboundMessage,
  SendResult,
  ConnectionStatus,
  CardPackage,
  CardActivatedEvent,
  MessageReceivedEvent,
  ConnectionChangedEvent,
  ChannelEvent,
} from "../src/types.js";

describe("motor-channels types smoke", () => {
  it("constructs an InboundMessage", () => {
    const m: InboundMessage = {
      from: "5511999990000@s.whatsapp.net",
      text: "card:tabuada-7",
      conversationId: "conv-001",
      timestamp: "2026-05-23T12:00:00.000Z",
    };
    expect(m.text).toBe("card:tabuada-7");
  });

  it("constructs an OutboundMessage + SendResult", () => {
    const out: OutboundMessage = {
      to: "5511999990000@s.whatsapp.net",
      text: "olá",
    };
    const res: SendResult = { messageId: "msg-001" };
    expect(out.to).toMatch(/@s\.whatsapp\.net$/);
    expect(res.messageId).toBe("msg-001");
  });

  it("constructs a ConnectionStatus", () => {
    const s: ConnectionStatus = { connected: true, queueDepth: 0 };
    expect(s.connected).toBe(true);
  });

  it("constructs a CardPackage envelope", () => {
    const pkg: CardPackage = {
      cardId: "tabuada-7",
      raw: "# Pacote\n...",
      sourcePath: "docs/ebrota/baralho-kids/pacotes/tabuada-7.md",
    };
    expect(pkg.cardId).toBe("tabuada-7");
  });

  it("discriminates ChannelEvent variants by `type`", () => {
    const evs: ChannelEvent[] = [
      {
        type: "CardActivated",
        cardId: "tabuada-7",
        from: "5511999990000@s.whatsapp.net",
        conversationId: "conv-001",
        timestamp: "2026-05-23T12:00:00.000Z",
      } satisfies CardActivatedEvent,
      {
        type: "MessageReceived",
        from: "5511999990000@s.whatsapp.net",
        text: "oi",
        conversationId: "conv-001",
        timestamp: "2026-05-23T12:00:01.000Z",
      } satisfies MessageReceivedEvent,
      {
        type: "ConnectionChanged",
        connected: false,
        reason: "logged_out",
        timestamp: "2026-05-23T12:00:02.000Z",
      } satisfies ConnectionChangedEvent,
    ];
    const kinds = evs.map((e) => e.type);
    expect(kinds).toEqual([
      "CardActivated",
      "MessageReceived",
      "ConnectionChanged",
    ]);
  });
});
