import { describe, it, expect, vi } from "vitest";
import { createMockChannel } from "../src/mock-channel.js";
import type {
  ConnectionChangedEvent,
  InboundMessage,
} from "../src/types.js";

const sampleInbound: InboundMessage = {
  from: "5511999990000@s.whatsapp.net",
  text: "card:tabuada-7",
  conversationId: "conv-mock-001",
  timestamp: "2026-05-23T13:00:00.000Z",
};

describe("createMockChannel — lifecycle", () => {
  it("starts disconnected", () => {
    const ch = createMockChannel();
    expect(ch.status().connected).toBe(false);
    expect(ch.status().queueDepth).toBe(0);
  });

  it("start() flips connected + emits ConnectionChanged", async () => {
    const ch = createMockChannel();
    const handler = vi.fn();
    ch.onConnectionChange(handler);
    await ch.start();
    expect(ch.status().connected).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    const [ev] = handler.mock.calls[0]!;
    expect((ev as ConnectionChangedEvent).connected).toBe(true);
  });

  it("stop() flips connected back + emits ConnectionChanged", async () => {
    const ch = createMockChannel();
    await ch.start();
    const handler = vi.fn();
    ch.onConnectionChange(handler);
    await ch.stop();
    expect(ch.status().connected).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    const [ev] = handler.mock.calls[0]!;
    expect((ev as ConnectionChangedEvent).connected).toBe(false);
    expect((ev as ConnectionChangedEvent).reason).toBe("stopped");
  });
});

describe("createMockChannel — send", () => {
  it("records sent messages with monotonic ids", async () => {
    const ch = createMockChannel();
    const a = await ch.send("5511111@s.whatsapp.net", "oi");
    const b = await ch.send("5512222@s.whatsapp.net", "tchau");
    expect(a.messageId).toBe("mock-msg-1");
    expect(b.messageId).toBe("mock-msg-2");
    expect(ch.sentMessages).toEqual([
      { to: "5511111@s.whatsapp.net", text: "oi" },
      { to: "5512222@s.whatsapp.net", text: "tchau" },
    ]);
  });

  it("resetSentMessages clears history", async () => {
    const ch = createMockChannel();
    await ch.send("5511111@s.whatsapp.net", "oi");
    ch.resetSentMessages();
    expect(ch.sentMessages).toEqual([]);
  });
});

describe("createMockChannel — onMessage", () => {
  it("invokes handler on simulateInbound", () => {
    const ch = createMockChannel();
    const handler = vi.fn();
    ch.onMessage(handler);
    ch.simulateInbound(sampleInbound);
    expect(handler).toHaveBeenCalledWith(sampleInbound);
  });

  it("supports multiple handlers; each receives the message", () => {
    const ch = createMockChannel();
    const a = vi.fn();
    const b = vi.fn();
    ch.onMessage(a);
    ch.onMessage(b);
    ch.simulateInbound(sampleInbound);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops further calls but leaves others active", () => {
    const ch = createMockChannel();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = ch.onMessage(a);
    ch.onMessage(b);
    ch.simulateInbound(sampleInbound);
    unsubA();
    ch.simulateInbound(sampleInbound);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe is idempotent", () => {
    const ch = createMockChannel();
    const handler = vi.fn();
    const unsub = ch.onMessage(handler);
    unsub();
    unsub();
    ch.simulateInbound(sampleInbound);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("createMockChannel — onConnectionChange & onQrCode", () => {
  it("simulateConnectionChange updates status + fires handlers", () => {
    const ch = createMockChannel();
    const handler = vi.fn();
    ch.onConnectionChange(handler);
    ch.simulateConnectionChange({
      type: "ConnectionChanged",
      connected: true,
      timestamp: "2026-05-23T13:00:00.000Z",
    });
    expect(ch.status().connected).toBe(true);
    expect(ch.status().lastSeen).toBe("2026-05-23T13:00:00.000Z");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("simulateQrCode fires only QR handlers (not message/conn)", () => {
    const ch = createMockChannel();
    const qr = vi.fn();
    const msg = vi.fn();
    const conn = vi.fn();
    ch.onQrCode(qr);
    ch.onMessage(msg);
    ch.onConnectionChange(conn);
    ch.simulateQrCode("2@abc...");
    expect(qr).toHaveBeenCalledWith("2@abc...");
    expect(msg).not.toHaveBeenCalled();
    expect(conn).not.toHaveBeenCalled();
  });

  it("QR handler unsubscribe works", () => {
    const ch = createMockChannel();
    const qr = vi.fn();
    const unsub = ch.onQrCode(qr);
    unsub();
    ch.simulateQrCode("2@abc...");
    expect(qr).not.toHaveBeenCalled();
  });
});
