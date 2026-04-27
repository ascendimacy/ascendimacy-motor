/**
 * Retry — exponential backoff with jitter and total budget cap (motor#28a).
 *
 * Spec refino v1: retry NÃO pode ultrapassar `total_attempts_budget_ms`
 * (default 90s). Se próximo backoff + tempo decorrido excederiam o budget,
 * retry abandona e o caller (router) decide entre fallback ou erro.
 */

import { GatewayError } from "./types.js";

export interface RetryOptions {
  /** Max retries (default 5). */
  maxRetries?: number;
  /** Total time budget in ms (default 90000). */
  budgetMs?: number;
  /** Per-attempt timeout in ms (default 60000). */
  perAttemptTimeoutMs?: number;
  /** Function classifying errors as transient (retryable). */
  isTransient?: (err: unknown) => boolean;
  /** Injectable now() (for tests). */
  now?: () => number;
  /** Injectable sleep (for tests). Default: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter (for tests). Default: random 0.5..1.5. */
  jitter?: () => number;
}

export interface RetryResult<T> {
  result: T;
  attemptCount: number;
}

const TRANSIENT_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

const TRANSIENT_HTTP_STATUS = new Set([408, 429, 502, 503, 504]);

/**
 * Default classifier — recognizes ETIMEDOUT family + transient HTTP statuses.
 */
export function defaultIsTransient(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; status?: number; cause?: { code?: string } };
  if (e.code && TRANSIENT_ERROR_CODES.has(e.code)) return true;
  if (e.cause?.code && TRANSIENT_ERROR_CODES.has(e.cause.code)) return true;
  if (e.status && TRANSIENT_HTTP_STATUS.has(e.status)) return true;
  // OpenAI/Anthropic SDK throws "Connection error." for APIConnectionError —
  // detected via cause.code above. Message-based fallback as safety net.
  const msg = (err as Error).message ?? "";
  if (msg === "Connection error." || msg.includes("ETIMEDOUT")) return true;
  return false;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<RetryResult<T>> {
  const maxRetries = opts.maxRetries ?? 5;
  const budgetMs = opts.budgetMs ?? 90_000;
  const isTransient = opts.isTransient ?? defaultIsTransient;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const jitter = opts.jitter ?? (() => 0.5 + Math.random());

  const t0 = now();
  let attempt = 0;
  let lastErr: unknown;

  // attempts = 1 (initial) + maxRetries
  while (attempt <= maxRetries) {
    attempt += 1;
    try {
      const result = await fn();
      return { result, attemptCount: attempt };
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) throw err;
      if (attempt > maxRetries) break;
      // Compute backoff: min(60s, 1s * 2^(attempt-1)) * jitter(0.5..1.5)
      const baseMs = Math.min(60_000, 1000 * Math.pow(2, attempt - 1));
      const waitMs = Math.floor(baseMs * jitter());
      const elapsed = now() - t0;
      // Budget check: if waiting + 1 more attempt would push past budget, abandon.
      if (elapsed + waitMs >= budgetMs) {
        throw new GatewayError(
          "BUDGET_EXHAUSTED",
          `retry budget ${budgetMs}ms exhausted after ${attempt} attempt(s) (elapsed=${elapsed}ms, next backoff=${waitMs}ms)`,
          err,
        );
      }
      await sleep(waitMs);
    }
  }
  throw lastErr ?? new Error("retry: unreachable");
}
