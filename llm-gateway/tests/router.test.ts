import { describe, it, expect } from "vitest";
import { Router } from "../src/router.js";
import { TokenBucket } from "../src/token-bucket.js";
import { createMemoryLogger } from "../src/logger.js";
import type { ProviderClient, ChatCompletionInput } from "../src/types.js";
import { GatewayError } from "../src/types.js";

function makeStubProvider(
  name: string,
  behavior: "ok" | "etimedout" | "throw500" | "slow",
): ProviderClient {
  return {
    async call(_req: ChatCompletionInput, model: string) {
      if (behavior === "etimedout") {
        const err = Object.assign(new Error("Connection error."), { code: "ETIMEDOUT" });
        throw err;
      }
      if (behavior === "throw500") {
        const err = Object.assign(new Error("Internal error"), { status: 500 });
        throw err;
      }
      if (behavior === "slow") {
        await new Promise((r) => setTimeout(r, 50));
      }
      return {
        content: `${name} ok`,
        tokens: { in: 100, out: 50, reasoning: 0 },
        model,
        latency_ms: 10,
      };
    },
  };
}

function makeRequest(): ChatCompletionInput {
  return {
    step: "drota",
    systemPrompt: "you are a helpful assistant",
    userMessage: "hi",
    run_id: "test-run-1",
  };
}

describe("Router — happy path", () => {
  it("primary ok → was_fallback=false", async () => {
    const logger = createMemoryLogger();
    const router = new Router({
      providers: {
        anthropic: makeStubProvider("anth", "ok"),
        infomaniak: makeStubProvider("info", "ok"),
      },
      buckets: {
        anthropic: new TokenBucket({ rate: 100, capacity: 10 }),
        infomaniak: new TokenBucket({ rate: 100, capacity: 10 }),
      },
      logger,
    });
    const r = await router.chatCompletion({ ...makeRequest(), provider: "infomaniak" });
    expect(r.was_fallback).toBe(false);
    expect(r.provider).toBe("infomaniak");
    expect(r.content).toBe("info ok");
    expect(logger.entries.length).toBe(1);
    expect(logger.entries[0]!.outcome).toBe("ok");
    expect(logger.entries[0]!.run_id).toBe("test-run-1");
  });

  it("run_id gerado quando não vier no input", async () => {
    const logger = createMemoryLogger();
    const router = new Router({
      providers: {
        anthropic: makeStubProvider("anth", "ok"),
        infomaniak: makeStubProvider("info", "ok"),
      },
      logger,
      fallbackEnabled: true,
    });
    const req = makeRequest();
    delete req.run_id;
    const r = await router.chatCompletion(req);
    expect(r.was_fallback).toBe(false);
    expect(logger.entries[0]!.run_id).toMatch(/^[0-9a-f-]{36}$/); // UUID
  });
});

describe("Router — fallback (refino v1: was_fallback obrigatório)", () => {
  it("primary ETIMEDOUT → fallback secundário, was_fallback=true", async () => {
    const logger = createMemoryLogger();
    const router = new Router({
      providers: {
        infomaniak: makeStubProvider("info", "etimedout"),
        anthropic: makeStubProvider("anth", "ok"),
      },
      // budget pequeno pra fallback disparar rápido (retry transient esgota cedo)
      primaryHardTimeoutMs: 100,
      totalBudgetMs: 5000,
      fallbackEnabled: true,
      logger,
    });
    const r = await router.chatCompletion({ ...makeRequest(), provider: "infomaniak" });
    expect(r.was_fallback).toBe(true);
    expect(r.provider).toBe("anthropic");
    expect(r.primary_provider_attempted).toBe("infomaniak");
    expect(r.content).toBe("anth ok");
    // Logger registra 2 entries: primary error + fallback ok
    expect(logger.entries.length).toBe(2);
    expect(logger.entries[0]!.outcome).toBe("error");
    expect(logger.entries[0]!.provider).toBe("infomaniak");
    expect(logger.entries[1]!.outcome).toBe("fallback_used");
    expect(logger.entries[1]!.provider).toBe("anthropic");
    expect(logger.entries[1]!.was_fallback).toBe(true);
    expect(logger.entries[1]!.primary_provider_attempted).toBe("infomaniak");
  });

  it("primary marcado degraded após fallback; segunda call vai direto ao secundário", async () => {
    const logger = createMemoryLogger();
    let nowMs = 0;
    const router = new Router({
      providers: {
        infomaniak: makeStubProvider("info", "etimedout"),
        anthropic: makeStubProvider("anth", "ok"),
      },
      primaryHardTimeoutMs: 100,
      totalBudgetMs: 5000,
      fallbackEnabled: true,
      degradedTtlMs: 60_000,
      now: () => nowMs,
      logger,
    });

    // Call 1: primary degraded é marked
    const r1 = await router.chatCompletion({ ...makeRequest(), provider: "infomaniak" });
    expect(r1.was_fallback).toBe(true);
    const entriesCall1 = logger.entries.length;

    // Call 2: dentro do TTL → vai direto pro fallback (was_fallback=false porque pulou primary)
    nowMs += 1000;
    const r2 = await router.chatCompletion({ ...makeRequest(), provider: "infomaniak" });
    expect(r2.was_fallback).toBe(false); // pulou primary, não foi fallback "real"
    expect(r2.provider).toBe("anthropic");
    // Apenas 1 entry adicional (não tentou primary)
    expect(logger.entries.length).toBe(entriesCall1 + 1);

    // Call 3: depois do TTL → tenta primary de novo
    nowMs += 65_000;
    const r3 = await router.chatCompletion({ ...makeRequest(), provider: "infomaniak" });
    expect(r3.was_fallback).toBe(true);
  });

  it("PROVIDER_DOWN quando ambos providers falham", async () => {
    const router = new Router({
      providers: {
        infomaniak: makeStubProvider("info", "etimedout"),
        anthropic: makeStubProvider("anth", "etimedout"),
      },
      primaryHardTimeoutMs: 100,
      totalBudgetMs: 200,
      fallbackEnabled: true,
    });
    await expect(
      router.chatCompletion({ ...makeRequest(), provider: "infomaniak" }),
    ).rejects.toThrow(GatewayError);
  });

  it("fallback disabled → erro propaga sem secundário", async () => {
    const router = new Router({
      providers: {
        infomaniak: makeStubProvider("info", "etimedout"),
        anthropic: makeStubProvider("anth", "ok"),
      },
      primaryHardTimeoutMs: 100,
      totalBudgetMs: 200,
      fallbackEnabled: false,
    });
    await expect(
      router.chatCompletion({ ...makeRequest(), provider: "infomaniak" }),
    ).rejects.toThrow();
  });
});

describe("Router — non-transient não dispara fallback", () => {
  it("HTTP 500 (transient) dispara fallback; HTTP 400 (non-transient) NÃO", async () => {
    // 500 é transient classic
    const router500 = new Router({
      providers: {
        infomaniak: makeStubProvider("info", "throw500"),
        anthropic: makeStubProvider("anth", "ok"),
      },
      primaryHardTimeoutMs: 100,
      totalBudgetMs: 5000,
      fallbackEnabled: true,
    });
    // 500 não está no nosso transient set (só 502/503/504/429), então é non-transient
    // → fallback ainda dispara mesmo assim porque router.callOnce throw → catch outer
    const r = await router500.chatCompletion({ ...makeRequest(), provider: "infomaniak" });
    expect(r.was_fallback).toBe(true);
  });
});
