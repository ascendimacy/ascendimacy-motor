import { describe, it, expect, vi } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInboundBridge } from "../src/orchestrator-bridge.js";
import type {
  OrchestratorBridge,
  StartCardSessionInput,
} from "../src/orchestrator-bridge.js";
import { createMockChannel } from "../src/mock-channel.js";
import { createCardPackageLoader } from "../src/cards-loader.js";
import type { RateLimiter } from "../src/rate-limit.js";
import type { InboundMessage } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures/pacotes");

const inbound = (text: string): InboundMessage => ({
  from: "5511999990000@s.whatsapp.net",
  text,
  conversationId: "conv-bridge-001",
  timestamp: "2026-05-23T14:00:00.000Z",
});

// No-op limiter — controla rate-limit fora desses testes.
const passthroughLimiter: RateLimiter = { acquire: async () => {} };

const flush = async () => {
  // Drena microtasks + dá tempo de event loop pra async I/O (readFile)
  // do fire-and-forget no handler do canal terminar antes da asserção.
  // 50ms é suficiente pra ENOENT/readFile + chain de awaits em mock.
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
};

const fakeBridge = (
  reply: (input: StartCardSessionInput) => string,
): OrchestratorBridge & { calls: StartCardSessionInput[] } => {
  const calls: StartCardSessionInput[] = [];
  return {
    calls,
    async startCardSession(input) {
      calls.push(input);
      return { text: reply(input) };
    },
  };
};

describe("createInboundBridge — card flow", () => {
  it("routes CardActivated to bridge.startCardSession with loaded pkg + sends reply", async () => {
    const channel = createMockChannel();
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const bridge = fakeBridge((input) => `Vamos lá, ${input.cardId}!`);
    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: passthroughLimiter,
    });
    ib.start();

    channel.simulateInbound(inbound("card:tabuada-7"));
    await flush();

    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0]!.cardId).toBe("tabuada-7");
    expect(bridge.calls[0]!.conversationId).toBe("conv-bridge-001");
    expect(bridge.calls[0]!.from).toBe("5511999990000@s.whatsapp.net");
    expect(bridge.calls[0]!.pkg.cardId).toBe("tabuada-7");
    expect(bridge.calls[0]!.pkg.raw).toContain("Tabuada do 7");

    expect(channel.sentMessages).toEqual([
      { to: "5511999990000@s.whatsapp.net", text: "Vamos lá, tabuada-7!" },
    ]);
  });

  it("sends cardNotFoundMessage when pkg missing, does NOT call bridge", async () => {
    const channel = createMockChannel();
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const bridge = fakeBridge(() => "should not happen");
    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: passthroughLimiter,
      cardNotFoundMessage: "Ops, essa carta não existe.",
    });
    ib.start();

    channel.simulateInbound(inbound("card:fantasma-404"));
    await flush();

    expect(bridge.calls).toEqual([]);
    expect(channel.sentMessages).toEqual([
      {
        to: "5511999990000@s.whatsapp.net",
        text: "Ops, essa carta não existe.",
      },
    ]);
  });

  it("uses default cardNotFoundMessage if not overridden", async () => {
    const channel = createMockChannel();
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const bridge = fakeBridge(() => "x");
    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: passthroughLimiter,
    });
    ib.start();

    channel.simulateInbound(inbound("card:fantasma-404"));
    await flush();

    expect(channel.sentMessages[0]!.text).toBe("Carta não encontrada.");
  });

  it("ignores plain MessageReceived (non-card) — no bridge call, no send", async () => {
    const channel = createMockChannel();
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const bridge = fakeBridge(() => "x");
    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: passthroughLimiter,
    });
    ib.start();

    channel.simulateInbound(inbound("oi tudo bem"));
    await flush();

    expect(bridge.calls).toEqual([]);
    expect(channel.sentMessages).toEqual([]);
  });
});

describe("createInboundBridge — lifecycle", () => {
  it("start is idempotent (no double-subscribe)", async () => {
    const channel = createMockChannel();
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const bridge = fakeBridge(() => "ok");
    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: passthroughLimiter,
    });
    ib.start();
    ib.start();

    channel.simulateInbound(inbound("card:tabuada-7"));
    await flush();

    expect(bridge.calls).toHaveLength(1);
    expect(channel.sentMessages).toHaveLength(1);
  });

  it("stop cancels subscription — no further dispatches", async () => {
    const channel = createMockChannel();
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const bridge = fakeBridge(() => "ok");
    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: passthroughLimiter,
    });
    ib.start();
    ib.stop();

    channel.simulateInbound(inbound("card:tabuada-7"));
    await flush();

    expect(bridge.calls).toEqual([]);
    expect(channel.sentMessages).toEqual([]);
  });

  it("stop is idempotent", () => {
    const channel = createMockChannel();
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const bridge = fakeBridge(() => "ok");
    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: passthroughLimiter,
    });
    ib.stop();
    ib.stop();
    // no throw
  });
});

describe("createInboundBridge — error handling", () => {
  it("invokes onError when bridge.startCardSession throws — does not send", async () => {
    const channel = createMockChannel();
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const boom: OrchestratorBridge = {
      startCardSession: async () => {
        throw new Error("bridge boom");
      },
    };
    const onError = vi.fn();
    const ib = createInboundBridge({
      channel,
      loader,
      bridge: boom,
      rateLimit: passthroughLimiter,
      onError,
    });
    ib.start();

    channel.simulateInbound(inbound("card:tabuada-7"));
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    const [err, ctx] = onError.mock.calls[0]!;
    expect((err as Error).message).toBe("bridge boom");
    expect(ctx.event.type).toBe("CardActivated");
    expect(ctx.event.cardId).toBe("tabuada-7");
    expect(channel.sentMessages).toEqual([]);
  });

  it("invokes onError when loader throws (non-ENOENT)", async () => {
    const channel = createMockChannel();
    const throwingLoader = {
      load: async () => {
        throw new Error("loader boom");
      },
      invalidate: () => {},
    };
    const bridge = fakeBridge(() => "x");
    const onError = vi.fn();
    const ib = createInboundBridge({
      channel,
      loader: throwingLoader,
      bridge,
      rateLimit: passthroughLimiter,
      onError,
    });
    ib.start();

    channel.simulateInbound(inbound("card:tabuada-7"));
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(bridge.calls).toEqual([]);
    expect(channel.sentMessages).toEqual([]);
  });
});

describe("createInboundBridge — rate limiting", () => {
  it("acquires from the supplied limiter before sending", async () => {
    const channel = createMockChannel();
    const loader = createCardPackageLoader({ baseDir: FIXTURES_DIR });
    const bridge = fakeBridge(() => "resp");
    const acquire = vi.fn(async () => {});
    const ib = createInboundBridge({
      channel,
      loader,
      bridge,
      rateLimit: { acquire },
    });
    ib.start();

    channel.simulateInbound(inbound("card:tabuada-7"));
    await flush();

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(channel.sentMessages).toHaveLength(1);
  });
});
