/**
 * Token bucket — per-provider rate limiter with FIFO queue (motor#28a).
 *
 * Bucket has fixed capacity and refills at constant rate (tokens/sec).
 * `acquire()` consumes 1 token; if bucket empty, caller waits in FIFO
 * queue. `acquire(timeoutMs)` rejects with BUDGET_EXHAUSTED if wait
 * would exceed timeout.
 *
 * Testable as pure logic — uses an injectable `now` clock.
 */

import { GatewayError } from "./types.js";

export interface TokenBucketOptions {
  /** Tokens/sec refill rate. Default: 5. */
  rate?: number;
  /** Max tokens stored. Default: 10. */
  capacity?: number;
  /** Injectable now() for tests. Default: Date.now. */
  now?: () => number;
  /** Injectable scheduler for tests. Default: setTimeout. */
  schedule?: (cb: () => void, ms: number) => void;
}

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

export class TokenBucket {
  private readonly rate: number;
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly schedule: (cb: () => void, ms: number) => void;
  private level: number;
  private lastRefillTs: number;
  private queue: Waiter[] = [];
  private drainScheduled = false;

  constructor(opts: TokenBucketOptions = {}) {
    this.rate = opts.rate ?? 5;
    this.capacity = opts.capacity ?? 10;
    this.now = opts.now ?? Date.now;
    this.schedule = opts.schedule ?? ((cb, ms) => setTimeout(cb, ms).unref?.());
    this.level = this.capacity;
    this.lastRefillTs = this.now();
  }

  /**
   * Acquire 1 token. If bucket empty, waits FIFO. If `timeoutMs` given and
   * the wait would exceed it, rejects with BUDGET_EXHAUSTED.
   */
  async acquire(timeoutMs?: number): Promise<void> {
    this.refill();
    if (this.level >= 1 && this.queue.length === 0) {
      this.level -= 1;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        enqueuedAt: this.now(),
      };
      if (timeoutMs !== undefined) {
        waiter.timeoutHandle = setTimeout(() => {
          const idx = this.queue.indexOf(waiter);
          if (idx >= 0) this.queue.splice(idx, 1);
          reject(
            new GatewayError(
              "BUDGET_EXHAUSTED",
              `token bucket wait exceeded ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
        waiter.timeoutHandle.unref?.();
      }
      this.queue.push(waiter);
      this.scheduleDrain();
    });
  }

  /** Current bucket level (for tests + observability). */
  get currentLevel(): number {
    this.refill();
    return this.level;
  }

  /** Queue depth (for tests + observability). */
  get queueDepth(): number {
    return this.queue.length;
  }

  private refill(): void {
    const now = this.now();
    const elapsed = now - this.lastRefillTs;
    if (elapsed <= 0) return;
    const tokens = (elapsed / 1000) * this.rate;
    this.level = Math.min(this.capacity, this.level + tokens);
    this.lastRefillTs = now;
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    // Time until 1 full token available, given current level.
    const deficit = Math.max(0, 1 - this.level);
    const waitMs = Math.ceil((deficit / this.rate) * 1000);
    this.schedule(() => this.drain(), Math.max(1, waitMs));
  }

  private drain(): void {
    this.drainScheduled = false;
    this.refill();
    while (this.level >= 1 && this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      this.level -= 1;
      if (waiter.timeoutHandle) clearTimeout(waiter.timeoutHandle);
      waiter.resolve();
    }
    if (this.queue.length > 0) this.scheduleDrain();
  }
}
