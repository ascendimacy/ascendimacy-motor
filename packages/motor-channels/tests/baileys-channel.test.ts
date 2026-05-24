import { describe, it, expect, vi } from "vitest";
import { DisconnectReason } from "@whiskeysockets/baileys";
import { createBaileysChannel } from "../src/baileys-channel.js";
import type {
  ConnectionChangedEvent,
  InboundMessage,
} from "../src/types.js";

type EventHandler = (...args: unknown[]) => unknown;

/**
 * Mock socket que replica a superfície de eventos do Baileys que o
 * wrapper consome (`creds.update`, `connection.update`, `messages.upsert`).
 * Testes injetam um socketFactory que devolve esse mock + helpers pra
 * disparar eventos manualmente.
 */
const makeMockSocket = () => {
  const handlers = new Map<string, Set<EventHandler>>();
  const sendMessage = vi.fn(async (_to: string, _content: unknown) => ({
    key: { id: "wamid.123" },
  }));
  const end = vi.fn(() => undefined);

  const on = (event: string, handler: EventHandler): void => {
    let set = handlers.get(event);
    if (set === undefined) {
      set = new Set();
      handlers.set(event, set);
    }
    set.add(handler);
  };

  const fire = (event: string, payload: unknown): void => {
    const set = handlers.get(event);
    if (set === undefined) return;
    for (const h of set) h(payload);
  };

  return {
    socket: {
      ev: { on },
      sendMessage,
      end,
    },
    fire,
    sendMessage,
    end,
  };
};

const makeMockAuthState = () => ({
  state: { creds: {}, keys: {} } as unknown,
  saveCreds: vi.fn(async () => undefined),
});

const baseOpts = (mock: ReturnType<typeof makeMockSocket>) => ({
  authDir: "/tmp/test-not-used",
  socketFactory: vi.fn(() => mock.socket) as never,
  authStateLoader: vi.fn(async () => makeMockAuthState()) as never,
  versionFetcher: vi.fn(async () => ({ version: [2, 3000, 0] as const })),
  reconnectDelayMs: 0,
});

describe("createBaileysChannel — start lifecycle", () => {
  it("loads auth state, creates socket, registers handlers on start()", async () => {
    const mock = makeMockSocket();
    const opts = baseOpts(mock);
    const ch = createBaileysChannel(opts);
    await ch.start();
    expect(opts.authStateLoader).toHaveBeenCalledWith("/tmp/test-not-used");
    expect(opts.socketFactory).toHaveBeenCalledTimes(1);
  });

  it("emits ConnectionChanged{connected:true} on connection.update open", async () => {
    const mock = makeMockSocket();
    const ch = createBaileysChannel(baseOpts(mock));
    const handler = vi.fn();
    ch.onConnectionChange(handler);
    await ch.start();
    mock.fire("connection.update", { connection: "open" });
    expect(handler).toHaveBeenCalledTimes(1);
    const [ev] = handler.mock.calls[0]!;
    expect((ev as ConnectionChangedEvent).connected).toBe(true);
    expect(ch.status().connected).toBe(true);
  });

  it("emits ConnectionChanged{connected:false, reason:loggedOut} on logout", async () => {
    const mock = makeMockSocket();
    const ch = createBaileysChannel(baseOpts(mock));
    const handler = vi.fn();
    ch.onConnectionChange(handler);
    await ch.start();
    mock.fire("connection.update", { connection: "open" });
    handler.mockClear();
    mock.fire("connection.update", {
      connection: "close",
      lastDisconnect: {
        error: { output: { statusCode: DisconnectReason.loggedOut } },
      },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    const [ev] = handler.mock.calls[0]!;
    expect((ev as ConnectionChangedEvent).connected).toBe(false);
    expect((ev as ConnectionChangedEvent).reason).toBe("loggedOut");
  });
});

describe("createBaileysChannel — QR + messages", () => {
  it("emits qr handler on connection.update with qr string", async () => {
    const mock = makeMockSocket();
    const ch = createBaileysChannel(baseOpts(mock));
    const qrHandler = vi.fn();
    ch.onQrCode(qrHandler);
    await ch.start();
    mock.fire("connection.update", { qr: "2@some-qr-string..." });
    expect(qrHandler).toHaveBeenCalledWith("2@some-qr-string...");
  });

  it("parses inbound text from messages.upsert (conversation field)", async () => {
    const mock = makeMockSocket();
    const ch = createBaileysChannel(baseOpts(mock));
    const msgHandler = vi.fn();
    ch.onMessage(msgHandler);
    await ch.start();
    mock.fire("messages.upsert", {
      messages: [
        {
          key: { remoteJid: "5511@s.whatsapp.net", fromMe: false },
          message: { conversation: "card:tabuada-7" },
          messageTimestamp: 1748000000,
        },
      ],
    });
    expect(msgHandler).toHaveBeenCalledTimes(1);
    const [m] = msgHandler.mock.calls[0]!;
    const inbound = m as InboundMessage;
    expect(inbound.from).toBe("5511@s.whatsapp.net");
    expect(inbound.text).toBe("card:tabuada-7");
    expect(inbound.conversationId).toBe("5511@s.whatsapp.net");
    expect(inbound.timestamp).toBe(
      new Date(1748000000 * 1000).toISOString(),
    );
  });

  it("parses inbound text from extendedTextMessage (long form)", async () => {
    const mock = makeMockSocket();
    const ch = createBaileysChannel(baseOpts(mock));
    const msgHandler = vi.fn();
    ch.onMessage(msgHandler);
    await ch.start();
    mock.fire("messages.upsert", {
      messages: [
        {
          key: { remoteJid: "5511@s.whatsapp.net", fromMe: false },
          message: {
            extendedTextMessage: { text: "uma mensagem longa qualquer" },
          },
          messageTimestamp: 1748000000,
        },
      ],
    });
    expect(msgHandler).toHaveBeenCalledTimes(1);
    expect((msgHandler.mock.calls[0]![0] as InboundMessage).text).toBe(
      "uma mensagem longa qualquer",
    );
  });

  it("ignores fromMe (own echo) and unparseable messages", async () => {
    const mock = makeMockSocket();
    const ch = createBaileysChannel(baseOpts(mock));
    const msgHandler = vi.fn();
    ch.onMessage(msgHandler);
    await ch.start();
    mock.fire("messages.upsert", {
      messages: [
        {
          key: { remoteJid: "5511@s.whatsapp.net", fromMe: true },
          message: { conversation: "echo" },
          messageTimestamp: 1748000000,
        },
        {
          key: { remoteJid: "5511@s.whatsapp.net", fromMe: false },
          message: null,
          messageTimestamp: 1748000000,
        },
        {
          key: { remoteJid: null, fromMe: false },
          message: { conversation: "sem from" },
          messageTimestamp: 1748000000,
        },
      ],
    });
    expect(msgHandler).not.toHaveBeenCalled();
  });
});

describe("createBaileysChannel — send", () => {
  it("calls sock.sendMessage with text content and returns messageId", async () => {
    const mock = makeMockSocket();
    const ch = createBaileysChannel(baseOpts(mock));
    await ch.start();
    const result = await ch.send("5511@s.whatsapp.net", "olá");
    expect(mock.sendMessage).toHaveBeenCalledWith(
      "5511@s.whatsapp.net",
      { text: "olá" },
    );
    expect(result.messageId).toBe("wamid.123");
  });

  it("throws if send is called before start", async () => {
    const mock = makeMockSocket();
    const ch = createBaileysChannel(baseOpts(mock));
    await expect(ch.send("5511@s.whatsapp.net", "olá")).rejects.toThrow(
      /canal não iniciado/,
    );
  });
});

describe("createBaileysChannel — reconnect", () => {
  it("recreates socket after non-logout close", async () => {
    const mock = makeMockSocket();
    const opts = baseOpts(mock);
    const ch = createBaileysChannel(opts);
    await ch.start();
    expect(opts.socketFactory).toHaveBeenCalledTimes(1);
    mock.fire("connection.update", {
      connection: "close",
      lastDisconnect: {
        error: { output: { statusCode: 500 } },
      },
    });
    // reconnectDelayMs=0 mas ainda passa pelo setTimeout — yield
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(opts.socketFactory).toHaveBeenCalledTimes(2);
  });

  it("does NOT reconnect after loggedOut close", async () => {
    const mock = makeMockSocket();
    const opts = baseOpts(mock);
    const ch = createBaileysChannel(opts);
    await ch.start();
    mock.fire("connection.update", {
      connection: "close",
      lastDisconnect: {
        error: { output: { statusCode: DisconnectReason.loggedOut } },
      },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(opts.socketFactory).toHaveBeenCalledTimes(1);
  });

  it("stop() prevents reconnect on subsequent close", async () => {
    const mock = makeMockSocket();
    const opts = baseOpts(mock);
    const ch = createBaileysChannel(opts);
    await ch.start();
    await ch.stop();
    mock.fire("connection.update", {
      connection: "close",
      lastDisconnect: { error: { output: { statusCode: 500 } } },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(opts.socketFactory).toHaveBeenCalledTimes(1);
  });
});

describe("createBaileysChannel — status", () => {
  it("starts disconnected; status() is synchronous snapshot", () => {
    const mock = makeMockSocket();
    const ch = createBaileysChannel(baseOpts(mock));
    expect(ch.status()).toEqual({ connected: false, queueDepth: 0 });
  });
});
