import { describe, it, expect, beforeEach } from "vitest";
import { TokenBucket } from "../src/token-bucket.js";
import { GatewayError } from "../src/types.js";

/**
 * Test harness: virtual clock + manual scheduler.
 *
 * `tick(ms)` advances the clock and runs scheduled callbacks whose
 * `runAt` <= current time, in order. This makes timing deterministic.
 */
function makeClock() {
  let now = 0;
  type Task = { id: number; runAt: number; cb: () => void };
  const queue: Task[] = [];
  let nextId = 0;
  return {
    now: () => now,
    schedule: (cb: () => void, ms: number) => {
      queue.push({ id: nextId++, runAt: now + ms, cb });
      queue.sort((a, b) => a.runAt - b.runAt || a.id - b.id);
    },
    tick: (ms: number) => {
      now += ms;
      while (queue.length && queue[0]!.runAt <= now) {
        const t = queue.shift()!;
        t.cb();
      }
    },
    pending: () => queue.length,
  };
}

describe("TokenBucket — capacity + acquire imediato", () => {
  it("acquire imediato quando bucket cheio", async () => {
    const clock = makeClock();
    const b = new TokenBucket({ rate: 5, capacity: 10, now: clock.now, schedule: clock.schedule });
    expect(b.currentLevel).toBe(10);
    await b.acquire();
    expect(b.currentLevel).toBeCloseTo(9, 1);
  });

  it("3 acquires consecutivos sem espera quando bucket comporta", async () => {
    const clock = makeClock();
    const b = new TokenBucket({ rate: 5, capacity: 10, now: clock.now, schedule: clock.schedule });
    await b.acquire();
    await b.acquire();
    await b.acquire();
    expect(b.currentLevel).toBeCloseTo(7, 1);
  });
});

describe("TokenBucket — refill rate", () => {
  it("refill linear: 5 req/s, depois de 200ms tem 1 token novo", () => {
    const clock = makeClock();
    const b = new TokenBucket({ rate: 5, capacity: 10, now: clock.now, schedule: clock.schedule });
    // Drena tudo
    for (let i = 0; i < 10; i++) b.acquire();
    expect(b.currentLevel).toBeCloseTo(0, 1);
    clock.tick(200);
    expect(b.currentLevel).toBeCloseTo(1, 1);
  });

  it("refill cap em capacity (não passa de 10)", () => {
    const clock = makeClock();
    const b = new TokenBucket({ rate: 5, capacity: 10, now: clock.now, schedule: clock.schedule });
    clock.tick(10_000); // 50 tokens "gerados" mas cap em 10
    expect(b.currentLevel).toBeCloseTo(10, 1);
  });
});

describe("TokenBucket — FIFO queue", () => {
  it("requests além da capacidade entram em fila e são atendidas em ordem", async () => {
    const clock = makeClock();
    const b = new TokenBucket({ rate: 10, capacity: 2, now: clock.now, schedule: clock.schedule });
    const order: number[] = [];

    // 5 acquires; primeiros 2 imediatos, próximos 3 enfileirados
    const p1 = b.acquire().then(() => order.push(1));
    const p2 = b.acquire().then(() => order.push(2));
    const p3 = b.acquire().then(() => order.push(3));
    const p4 = b.acquire().then(() => order.push(4));
    const p5 = b.acquire().then(() => order.push(5));

    // Yield to event loop pra processar p1+p2 imediatos
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([1, 2]);
    expect(b.queueDepth).toBe(3);

    // Tick 100ms — refilla 1 token; libera p3
    clock.tick(100);
    await p3;
    expect(order).toEqual([1, 2, 3]);

    // Tick mais 200ms — refilla 2 tokens; libera p4, p5
    clock.tick(200);
    await p4;
    await p5;
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("TokenBucket — budget cap (BUDGET_EXHAUSTED)", () => {
  it("acquire(timeoutMs) rejeita quando wait excede timeout", async () => {
    // bucket vazio, rate baixo → próxima vaga em 1000ms; timeout 100ms → abort
    const b = new TokenBucket({ rate: 1, capacity: 1 });
    await b.acquire(); // drena
    await expect(b.acquire(100)).rejects.toThrow(GatewayError);
    await expect(b.acquire(100)).rejects.toMatchObject({ code: "BUDGET_EXHAUSTED" });
  });

  it("acquire(timeoutMs) sucede quando wait fica dentro do budget", async () => {
    const b = new TokenBucket({ rate: 50, capacity: 1 });
    await b.acquire(); // drena
    await expect(b.acquire(500)).resolves.toBeUndefined();
  });
});
