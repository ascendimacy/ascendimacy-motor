import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTokenBucket } from "../src/rate-limit.js";

describe("createTokenBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows burst tokens immediately", async () => {
    const limiter = createTokenBucket({ tokensPerSec: 1, burst: 3 });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    // first 3 returned without time advancing
  });

  it("blocks the next acquire after burst until refill", async () => {
    const limiter = createTokenBucket({ tokensPerSec: 1, burst: 2 });
    await limiter.acquire();
    await limiter.acquire();

    let resolved = false;
    const p = limiter.acquire().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    await p;
    expect(resolved).toBe(true);
  });

  it("refills at the configured rate", async () => {
    const limiter = createTokenBucket({ tokensPerSec: 5, burst: 1 });
    await limiter.acquire();

    const p1 = limiter.acquire();
    await vi.advanceTimersByTimeAsync(210);
    await p1;

    const p2 = limiter.acquire();
    await vi.advanceTimersByTimeAsync(210);
    await p2;
  });

  it("caps tokens at `burst` (no over-refill)", async () => {
    const limiter = createTokenBucket({ tokensPerSec: 1, burst: 2 });
    // Wait long enough to "earn" 10 tokens but burst caps at 2
    await vi.advanceTimersByTimeAsync(10_000);
    await limiter.acquire();
    await limiter.acquire();
    // Third should now block again (cap was 2)
    let resolved = false;
    const p = limiter.acquire().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    await p;
    expect(resolved).toBe(true);
  });

  it("throws on non-positive config", () => {
    expect(() =>
      createTokenBucket({ tokensPerSec: 0, burst: 1 }),
    ).toThrow();
    expect(() =>
      createTokenBucket({ tokensPerSec: 1, burst: 0 }),
    ).toThrow();
  });
});
