/**
 * Shared types for the LLM Gateway (motor#28).
 */

import type { LlmProvider } from "@ascendimacy/shared";

export interface ChatCompletionInput {
  step: string;
  provider?: LlmProvider;
  model?: string;
  systemPrompt: string;
  cacheableSystemPrefix?: string;
  userMessage: string;
  maxTokens?: number;
  enableThinking?: boolean;
  thinkingBudgetTokens?: number;
  run_id?: string;
}

export interface TokenUsage {
  in: number;
  out: number;
  reasoning: number;
  cacheCreation?: number;
  cacheRead?: number;
}

export interface ChatCompletionOutput {
  content: string;
  reasoning?: string;
  tokens: TokenUsage;
  provider: LlmProvider;
  model: string;
  latency_ms: number;
  attempt_count: number;
  was_fallback: boolean;
  primary_provider_attempted?: LlmProvider;
}

export interface ProviderCallResult {
  content: string;
  reasoning?: string;
  tokens: TokenUsage;
  model: string;
  latency_ms: number;
}

export interface ProviderClient {
  call(req: ChatCompletionInput, model: string): Promise<ProviderCallResult>;
}

export type GatewayErrorCode =
  | "BUDGET_EXHAUSTED"
  | "PROVIDER_DOWN"
  | "INVALID_REQUEST";

export class GatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}
