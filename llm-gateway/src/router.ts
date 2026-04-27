/**
 * Router — orchestrates provider selection, fallback, retry, bucket (motor#28a).
 *
 * Spec refino v1: hard timeout 30s no primary antes de fallback.
 * Esse 30s NÃO é per-attempt timeout (per-attempt fica com retry+SDK),
 * é um cap de tempo CUMULATIVO no provider primário antes de cair pro
 * secundário. Razão: 3 retries × 60s = 3min pra detectar primary down
 * é desperdício; 30s é suficiente.
 */

import { randomUUID } from "node:crypto";
import { getProviderForStep, getModelForStep, type LlmProvider } from "@ascendimacy/shared";
import {
  type ChatCompletionInput,
  type ChatCompletionOutput,
  type ProviderClient,
  GatewayError,
} from "./types.js";
import { TokenBucket } from "./token-bucket.js";
import { retryWithBackoff } from "./retry.js";
import { type GatewayLogger } from "./logger.js";
import { anthropicProvider } from "./providers/anthropic.js";
import { infomaniakProvider } from "./providers/infomaniak.js";

export interface RouterOptions {
  /** Map provider name → ProviderClient. Default: real SDK clients. */
  providers?: Partial<Record<LlmProvider, ProviderClient>>;
  /** Token buckets per provider. Default: TokenBucket (5 req/s, capacity 10). */
  buckets?: Partial<Record<LlmProvider, TokenBucket>>;
  /** Logger. Default: noop. */
  logger?: GatewayLogger;
  /** Hard timeout per provider before fallback (ms). Default: 30000. */
  primaryHardTimeoutMs?: number;
  /** Total budget per call (ms). Default: 90000. */
  totalBudgetMs?: number;
  /** Enable provider fallback on primary failure. Default: true. */
  fallbackEnabled?: boolean;
  /** Time after which a "degraded" primary is retried again (ms). Default: 60000. */
  degradedTtlMs?: number;
  /** Injectable now() — mainly for tests. */
  now?: () => number;
}

interface DegradedState {
  /** Map provider → ts when degraded was set; expires after degradedTtlMs. */
  marks: Map<LlmProvider, number>;
}

const FALLBACK_MAP: Record<LlmProvider, LlmProvider> = {
  anthropic: "infomaniak",
  infomaniak: "anthropic",
};

export class Router {
  private readonly providers: Record<LlmProvider, ProviderClient>;
  private readonly buckets: Record<LlmProvider, TokenBucket>;
  private readonly logger: GatewayLogger;
  private readonly primaryHardTimeoutMs: number;
  private readonly totalBudgetMs: number;
  private readonly fallbackEnabled: boolean;
  private readonly degradedTtlMs: number;
  private readonly now: () => number;
  private readonly degraded: DegradedState = { marks: new Map() };

  constructor(opts: RouterOptions = {}) {
    this.providers = {
      anthropic: opts.providers?.anthropic ?? anthropicProvider,
      infomaniak: opts.providers?.infomaniak ?? infomaniakProvider,
    };
    this.buckets = {
      anthropic: opts.buckets?.anthropic ?? new TokenBucket({ rate: parseRate("LLM_GATEWAY_RATE_ANTHROPIC", 50) }),
      infomaniak: opts.buckets?.infomaniak ?? new TokenBucket({ rate: parseRate("LLM_GATEWAY_RATE_INFOMANIAK", 5) }),
    };
    this.logger = opts.logger ?? { log: () => {} };
    this.primaryHardTimeoutMs = opts.primaryHardTimeoutMs ?? parseMs("LLM_GATEWAY_PRIMARY_TIMEOUT_MS", 30_000);
    this.totalBudgetMs = opts.totalBudgetMs ?? parseMs("LLM_GATEWAY_BUDGET_MS", 90_000);
    this.fallbackEnabled = opts.fallbackEnabled ?? (process.env["LLM_GATEWAY_FALLBACK"] !== "disabled");
    this.degradedTtlMs = opts.degradedTtlMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  async chatCompletion(req: ChatCompletionInput): Promise<ChatCompletionOutput> {
    const requestId = randomUUID();
    const runId = req.run_id ?? randomUUID();
    const t0 = this.now();

    const primary = req.provider ?? getProviderForStep(req.step);
    const fallback = FALLBACK_MAP[primary];
    const primaryDegraded = this.isDegraded(primary);

    // If primary is degraded and fallback enabled, skip primary entirely.
    const shouldUsePrimaryFirst = !primaryDegraded;

    let result: ChatCompletionOutput | null = null;
    let lastErr: unknown = null;

    if (shouldUsePrimaryFirst) {
      try {
        result = await this.callOnce({
          providerName: primary,
          req,
          requestId,
          runId,
          startTs: t0,
          budgetMs: this.primaryHardTimeoutMs,
          wasFallback: false,
        });
      } catch (err) {
        lastErr = err;
        if (this.fallbackEnabled) {
          this.markDegraded(primary);
        }
      }
    }

    if (!result && this.fallbackEnabled) {
      const elapsed = this.now() - t0;
      const remaining = Math.max(0, this.totalBudgetMs - elapsed);
      try {
        result = await this.callOnce({
          providerName: fallback,
          req,
          requestId,
          runId,
          startTs: t0,
          budgetMs: remaining,
          wasFallback: shouldUsePrimaryFirst, // se pulou primary, NÃO foi fallback "real"
          primaryAttempted: shouldUsePrimaryFirst ? primary : undefined,
        });
      } catch (err) {
        lastErr = err;
      }
    }

    if (!result) {
      const e = lastErr instanceof GatewayError
        ? lastErr
        : new GatewayError("PROVIDER_DOWN", `all providers failed for step=${req.step}`, lastErr);
      throw e;
    }
    return result;
  }

  private async callOnce(args: {
    providerName: LlmProvider;
    req: ChatCompletionInput;
    requestId: string;
    runId: string;
    startTs: number;
    budgetMs: number;
    wasFallback: boolean;
    primaryAttempted?: LlmProvider;
  }): Promise<ChatCompletionOutput> {
    const { providerName, req, requestId, runId, budgetMs, wasFallback, primaryAttempted } = args;
    const provider = this.providers[providerName];
    const bucket = this.buckets[providerName];
    const model = req.model ?? getModelForStep(req.step, providerName);

    const bucketLevelStart = bucket.currentLevel;
    // Acquire bucket token with budget cap
    await bucket.acquire(Math.min(budgetMs, 60_000));

    const callStartTs = this.now();
    let attemptCount = 0;
    let outcome: "ok" | "error" | "fallback_used" = "ok";
    let errorClass: string | null = null;

    try {
      const r = await retryWithBackoff(
        async () => provider.call(req, model),
        {
          maxRetries: 5,
          budgetMs,
          now: this.now,
        },
      );
      attemptCount = r.attemptCount;
      const latency_ms = this.now() - callStartTs;

      const out: ChatCompletionOutput = {
        content: r.result.content,
        reasoning: r.result.reasoning,
        tokens: r.result.tokens,
        provider: providerName,
        model: r.result.model,
        latency_ms,
        attempt_count: attemptCount,
        was_fallback: wasFallback,
        primary_provider_attempted: primaryAttempted,
      };

      this.logger.log({
        ts: new Date().toISOString(),
        request_id: requestId,
        run_id: runId,
        step: req.step,
        provider: providerName,
        model: r.result.model,
        tokens: { in: r.result.tokens.in, out: r.result.tokens.out, reasoning: r.result.tokens.reasoning },
        latency_ms,
        attempt_count: attemptCount,
        outcome: wasFallback ? "fallback_used" : "ok",
        error_class: null,
        was_fallback: wasFallback,
        primary_provider_attempted: primaryAttempted ?? null,
        bucket_level_at_start: Math.round(bucketLevelStart * 100) / 100,
        bucket_level_at_end: Math.round(bucket.currentLevel * 100) / 100,
      });

      return out;
    } catch (err) {
      outcome = "error";
      errorClass = (err as Error).name ?? "Error";
      const latency_ms = this.now() - callStartTs;
      this.logger.log({
        ts: new Date().toISOString(),
        request_id: requestId,
        run_id: runId,
        step: req.step,
        provider: providerName,
        model,
        tokens: { in: 0, out: 0, reasoning: 0 },
        latency_ms,
        attempt_count: attemptCount,
        outcome,
        error_class: errorClass,
        was_fallback: wasFallback,
        primary_provider_attempted: primaryAttempted ?? null,
        bucket_level_at_start: Math.round(bucketLevelStart * 100) / 100,
        bucket_level_at_end: Math.round(bucket.currentLevel * 100) / 100,
      });
      throw err;
    }
  }

  private isDegraded(provider: LlmProvider): boolean {
    const ts = this.degraded.marks.get(provider);
    if (ts === undefined) return false;
    if (this.now() - ts > this.degradedTtlMs) {
      this.degraded.marks.delete(provider);
      return false;
    }
    return true;
  }

  private markDegraded(provider: LlmProvider): void {
    this.degraded.marks.set(provider, this.now());
  }
}

function parseRate(envName: string, fallback: number): number {
  const v = process.env[envName];
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseMs(envName: string, fallback: number): number {
  const v = process.env[envName];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
