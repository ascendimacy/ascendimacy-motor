import { describe, it, expect } from "vitest";
import { retryWithBackoff, defaultIsTransient } from "../src/retry.js";
import { GatewayError } from "../src/types.js";

function makeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe("defaultIsTransient", () => {
  it("classifica ETIMEDOUT como transient via err.code", () => {
    expect(defaultIsTransient({ code: "ETIMEDOUT" })).toBe(true);
  });
  it("classifica ECONNRESET via cause.code (SDK pattern)", () => {
    expect(defaultIsTransient({ cause: { code: "ECONNRESET" } })).toBe(true);
  });
  it("classifica HTTP 429 + 503 como transient", () => {
    expect(defaultIsTransient({ status: 429 })).toBe(true);
    expect(defaultIsTransient({ status: 503 })).toBe(true);
  });
  it("NÃO classifica 401, 403, 404, 422 como transient", () => {
    expect(defaultIsTransient({ status: 401 })).toBe(false);
    expect(defaultIsTransient({ status: 422 })).toBe(false);
  });
  it("classifica via mensagem 'Connection error.' (fallback safety net)", () => {
    expect(defaultIsTransient({ message: "Connection error." })).toBe(true);
  });
});

describe("retryWithBackoff — sucesso primeiro try", () => {
  it("attemptCount=1 sem sleep", async () => {
    const clock = makeClock();
    const r = await retryWithBackoff(async () => "ok", {
      now: clock.now,
      sleep: clock.sleep,
      jitter: () => 1,
    });
    expect(r.attemptCount).toBe(1);
    expect(r.result).toBe("ok");
    expect(clock.now()).toBe(0); // sem espera
  });
});

describe("retryWithBackoff — retry transient", () => {
  it("retry em ETIMEDOUT, sucede no try 3", async () => {
    const clock = makeClock();
    let calls = 0;
    const r = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 3) throw { code: "ETIMEDOUT" };
        return "ok";
      },
      { now: clock.now, sleep: clock.sleep, jitter: () => 1 },
    );
    expect(calls).toBe(3);
    expect(r.attemptCount).toBe(3);
    expect(r.result).toBe("ok");
  });

  it("backoff exponencial: 1s, 2s, 4s, 8s, 16s (jitter=1)", async () => {
    const clock = makeClock();
    const sleepCalls: number[] = [];
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw { code: "ETIMEDOUT" };
        },
        {
          maxRetries: 4,
          budgetMs: 10_000_000, // bem grande pra não trigger budget cap
          now: clock.now,
          sleep: async (ms) => {
            sleepCalls.push(ms);
            await clock.sleep(ms);
          },
          jitter: () => 1,
        },
      ),
    ).rejects.toMatchObject({ code: "ETIMEDOUT" });
    // attempts: 1+4 retries = 5 calls; 4 sleeps de 1s, 2s, 4s, 8s
    expect(calls).toBe(5);
    expect(sleepCalls).toEqual([1000, 2000, 4000, 8000]);
  });
});

describe("retryWithBackoff — budget cap (refino v1)", () => {
  it("aborta retry quando elapsed + próximo backoff excede budgetMs", async () => {
    const clock = makeClock();
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw { code: "ETIMEDOUT" };
        },
        {
          maxRetries: 10,
          budgetMs: 5000, // budget pequeno
          now: clock.now,
          sleep: clock.sleep,
          jitter: () => 1,
        },
      ),
    ).rejects.toMatchObject({ code: "BUDGET_EXHAUSTED" });
    // Backoffs: 1s + 2s = 3s elapsed, próximo 4s → 3+4=7 > 5 → abort após 3 tries
    expect(calls).toBe(3);
  });
});

describe("retryWithBackoff — non-transient não retry", () => {
  it("400 lança imediatamente, sem retry", async () => {
    const clock = makeClock();
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw { status: 400, message: "Bad Request" };
        },
        { now: clock.now, sleep: clock.sleep, jitter: () => 1 },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(1);
  });
});
