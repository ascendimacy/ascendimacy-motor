/**
 * NDJSON logger — gateway-specific log file (motor#28a).
 *
 * Cada call ao gateway emite 1 linha em logs/llm-gateway/<run_id>.ndjson.
 * NÃO duplica events.ndjson do orchestrator — esse log é específico de
 * transporte LLM (latency, retry, fallback, bucket level).
 */

import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LlmProvider } from "@ascendimacy/shared";

export interface GatewayLogEntry {
  ts: string;
  request_id: string;
  run_id: string;
  step: string;
  provider: LlmProvider;
  model: string;
  tokens: { in: number; out: number; reasoning?: number };
  latency_ms: number;
  attempt_count: number;
  outcome: "ok" | "error" | "fallback_used";
  error_class?: string | null;
  was_fallback: boolean;
  primary_provider_attempted?: LlmProvider | null;
  bucket_level_at_start?: number;
  bucket_level_at_end?: number;
}

export interface GatewayLogger {
  log(entry: GatewayLogEntry): void;
}

/**
 * File-backed logger. Default path: logs/llm-gateway/<run_id>.ndjson
 * relative to the motor repo root (ASC_MOTOR_ROOT or process cwd).
 */
export function createFileLogger(runId: string, baseDir?: string): GatewayLogger {
  const root = baseDir
    ?? process.env["ASC_MOTOR_ROOT"]
    ?? process.cwd();
  const filePath = join(root, "logs", "llm-gateway", `${runId}.ndjson`);
  if (!existsSync(dirname(filePath))) {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  return {
    log: (entry: GatewayLogEntry) => {
      try {
        appendFileSync(filePath, JSON.stringify(entry) + "\n");
      } catch {
        // Logging failure must NOT crash the gateway.
      }
    },
  };
}

/** No-op logger — used in tests or when ASC_LLM_GATEWAY_LOG=disabled. */
export function createNoopLogger(): GatewayLogger {
  return { log: () => {} };
}

/** In-memory logger for tests. */
export function createMemoryLogger(): GatewayLogger & { entries: GatewayLogEntry[] } {
  const entries: GatewayLogEntry[] = [];
  return {
    entries,
    log: (entry) => {
      entries.push(entry);
    },
  };
}
