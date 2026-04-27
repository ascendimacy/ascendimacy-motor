/**
 * @ascendimacy/llm-gateway — public surface (motor#28a).
 */

export { Router, type RouterOptions } from "./router.js";
export { TokenBucket, type TokenBucketOptions } from "./token-bucket.js";
export { retryWithBackoff, defaultIsTransient, type RetryOptions } from "./retry.js";
export {
  createFileLogger,
  createNoopLogger,
  createMemoryLogger,
  type GatewayLogger,
  type GatewayLogEntry,
} from "./logger.js";
export { installAgent, type AgentOptions } from "./agent.js";
export {
  GatewayError,
  type ChatCompletionInput,
  type ChatCompletionOutput,
  type ProviderClient,
  type ProviderCallResult,
  type GatewayErrorCode,
} from "./types.js";
export { createGatewayServer } from "./server.js";
export {
  loadEventsFromDir,
  groupByRunId,
  computeReport,
  formatReportMarkdown,
  type GatewayLogEntry as GatewayLogEntryAggregate,
  type AggregateReport,
  type AggregateOptions,
  type TurnAgg,
} from "./aggregate.js";
