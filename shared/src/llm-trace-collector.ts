/**
 * LLM trace collector — TV2-2 (spec ops#1136).
 *
 * Wrapper opcional sobre `callGateway` que captura `LlmCallTrace` por
 * chamada. Preserva 100% a função original — callers que não passam
 * collector seguem inalterados.
 *
 * Uso típico em handleSimplifiedPipeline (TV2-4):
 *
 *   const collector = createLlmTraceCollector();
 *   await callGatewayWithTracing(req, "assessor", collector);
 *   await callGatewayWithTracing(req, "materializer", collector);
 *   engineTrace.llm_calls = collector.drain();
 *
 * Privacy: redação opt-in via env `MOTOR_TRACE_REDACT_PII=true` —
 * substitui prompt + response por hashes (não literal). Default false
 * em dev/CI (Karpathy P2 — simplicidade primeiro).
 */

import { randomBytes, createHash } from "node:crypto";
import {
  callGateway,
  type GatewayChatCompletionInput,
  type GatewayChatCompletionOutput,
} from "./gateway-client.js";
import type {
  LlmCallTrace,
  LlmCallRole,
  TraceLlmProvider,
} from "./engine-trace-v2.js";
import type { LlmProvider } from "./llm-router.js";

export interface LlmTraceCollector {
  /** Anexa uma chamada. ID é gerado pelo wrapper se ausente. */
  push(call: LlmCallTrace): void;
  /** Retorna e limpa o buffer. */
  drain(): LlmCallTrace[];
  /** Peek sem consumir — pra inspect em tests. */
  peek(): readonly LlmCallTrace[];
  /** Quantos calls coletados. */
  size(): number;
}

export function createLlmTraceCollector(): LlmTraceCollector {
  const calls: LlmCallTrace[] = [];
  return {
    push: (call) => {
      calls.push(call);
    },
    drain: () => calls.splice(0),
    peek: () => calls,
    size: () => calls.length,
  };
}

/**
 * Mapeia provider do gateway pra trace. `openai-compat` (OVMS local)
 * vira `"local"`. Os 2 paid providers mantêm nome.
 */
export function mapGatewayProviderToTrace(p: LlmProvider): TraceLlmProvider {
  if (p === "anthropic") return "anthropic";
  if (p === "infomaniak") return "infomaniak";
  return "local"; // openai-compat → local
}

/**
 * Constrói representação textual do prompt enviado — concatena system +
 * user. Não inclui assistant prefill (pouco usado, gateway-side). Útil
 * pra debug em UI; provider real envia em formato message-array.
 */
export function buildPromptText(req: GatewayChatCompletionInput): string {
  const parts: string[] = [];
  if (req.cacheableSystemPrefix && req.cacheableSystemPrefix.length > 0) {
    parts.push(`[CACHEABLE PREFIX]\n${req.cacheableSystemPrefix}`);
  }
  if (req.systemPrompt && req.systemPrompt.length > 0) {
    parts.push(`[SYSTEM]\n${req.systemPrompt}`);
  }
  parts.push(`[USER]\n${req.userMessage}`);
  return parts.join("\n\n");
}

/**
 * Quando `MOTOR_TRACE_REDACT_PII=true`, substitui prompt/response por
 * hashes deterministicos. Mantém shape do schema válido + permite
 * comparar entre runs (mesmo hash = mesmo conteúdo).
 */
export function shouldRedactPii(): boolean {
  return process.env["MOTOR_TRACE_REDACT_PII"] === "true";
}

function redactText(text: string): string {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return `[REDACTED sha256:${hash} len=${text.length}]`;
}

function generateCallId(): string {
  return `llm-${randomBytes(8).toString("hex")}`;
}

/**
 * Wrapper sobre `callGateway` que coleta `LlmCallTrace`. Quando
 * `collector` é undefined, comporta-se EXATAMENTE como `callGateway`.
 *
 * Em sucesso: push de LlmCallTrace com prompt/response/tokens/ms.
 * Em erro: push de LlmCallTrace com `error` populado + re-throw.
 */
export async function callGatewayWithTracing(
  req: GatewayChatCompletionInput,
  role: LlmCallRole,
  collector?: LlmTraceCollector,
): Promise<GatewayChatCompletionOutput> {
  if (collector === undefined) {
    return callGateway(req);
  }

  const redact = shouldRedactPii();
  const promptText = buildPromptText(req);
  const startMs = Date.now();

  try {
    const result = await callGateway(req);
    const tokensIn = result.tokens?.in;
    const tokensOut = result.tokens?.out;
    const cacheRead = result.tokens?.cacheRead;
    collector.push({
      id: generateCallId(),
      role,
      provider: mapGatewayProviderToTrace(result.provider),
      model: result.model,
      prompt: redact ? redactText(promptText) : promptText,
      response: redact ? redactText(result.content) : result.content,
      duration_ms: result.latency_ms ?? Date.now() - startMs,
      ...(typeof tokensIn === "number" ? { input_tokens: tokensIn } : {}),
      ...(typeof tokensOut === "number" ? { output_tokens: tokensOut } : {}),
      ...(typeof cacheRead === "number" && cacheRead > 0
        ? { prompt_cache_hit: true }
        : {}),
      ...(redact ? { redacted: true } : {}),
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    collector.push({
      id: generateCallId(),
      role,
      provider: mapGatewayProviderToTrace(req.provider ?? "anthropic"),
      model: req.model ?? "unknown",
      prompt: redact ? redactText(promptText) : promptText,
      response: "",
      duration_ms: Date.now() - startMs,
      error: message,
      ...(redact ? { redacted: true } : {}),
    });
    throw err;
  }
}
