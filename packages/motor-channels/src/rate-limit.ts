/**
 * Token bucket rate limiter — S-MX-06-08 (ops#1115 §"max N msgs/sec").
 *
 * Async `acquire()` resolve quando um token está disponível. Refill
 * contínuo no `Math.min(burst, ...)`. Sem dependências externas; usa
 * `Date.now()` + `setTimeout` — testável com `vi.useFakeTimers()`.
 */

export interface RateLimiter {
  /** Resolve quando há token disponível. Decrementa 1 token. */
  acquire(): Promise<void>;
}

export interface TokenBucketOptions {
  /** Refill rate em tokens por segundo. */
  tokensPerSec: number;
  /** Capacidade máxima do bucket (burst inicial). */
  burst: number;
}

export function createTokenBucket(opts: TokenBucketOptions): RateLimiter {
  if (opts.tokensPerSec <= 0) throw new Error("tokensPerSec must be > 0");
  if (opts.burst <= 0) throw new Error("burst must be > 0");

  let tokens = opts.burst;
  let lastRefill = Date.now();

  const refill = (): void => {
    const now = Date.now();
    const elapsedSec = (now - lastRefill) / 1000;
    if (elapsedSec > 0) {
      tokens = Math.min(opts.burst, tokens + elapsedSec * opts.tokensPerSec);
      lastRefill = now;
    }
  };

  return {
    async acquire(): Promise<void> {
      // Loop porque setTimeout pode acordar antes de termos token cheio
      // sob jitter de timer.
      for (;;) {
        refill();
        if (tokens >= 1) {
          tokens -= 1;
          return;
        }
        const deficitSec = (1 - tokens) / opts.tokensPerSec;
        const waitMs = Math.max(1, Math.ceil(deficitSec * 1000));
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
    },
  };
}
