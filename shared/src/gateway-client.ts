/**
 * Gateway client — singleton MCP client for the LLM Gateway (motor#28b).
 *
 * Children (motor-drota, planejador, signal-extractor) chamam `callGateway()`
 * em vez de instanciar SDK Anthropic/OpenAI direto. Centraliza retry, fallback,
 * undici Agent IPv4-first, NDJSON logging.
 *
 * Modelo de transport: stdio. Cada child que importa shared/gateway-client
 * spawna seu próprio processo gateway via subprocess. **Trade-off**: token
 * bucket coordination não é cross-process (cada child tem seu bucket).
 * Mitigado em motor#28f (HTTP transport pre-prod) — pra STS pilot/Yuji,
 * per-process bucket é suficiente.
 *
 * Tipos inlined aqui pra evitar cycle com `@ascendimacy/llm-gateway`
 * (gateway depende de shared; shared não pode depender de gateway).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import {
  getProviderForStep,
  getModelForStep,
  type LlmProvider,
} from "./llm-router.js";
import { getLlmTimeoutMs } from "./llm-config.js";

// Tipos espelham llm-gateway/src/types.ts. Mantidos sincronizados manualmente.
export interface GatewayChatCompletionInput {
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

export interface GatewayTokenUsage {
  in: number;
  out: number;
  reasoning: number;
  cacheCreation?: number;
  cacheRead?: number;
}

export interface GatewayChatCompletionOutput {
  content: string;
  reasoning?: string;
  tokens: GatewayTokenUsage;
  provider: LlmProvider;
  model: string;
  latency_ms: number;
  attempt_count: number;
  was_fallback: boolean;
  primary_provider_attempted?: LlmProvider;
}

let _client: Client | null = null;
let _connecting: Promise<Client> | null = null;

const PROPAGATED_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "INFOMANIAK_API_KEY",
  "INFOMANIAK_BASE_URL",
  "LLM_PROVIDER",
  "PLANEJADOR_PROVIDER",
  "PLANEJADOR_MODEL",
  "MOTOR_DROTA_MODEL",
  "DROTA_PROVIDER",
  "DROTA_MODEL",
  "SIGNAL_EXTRACTOR_PROVIDER",
  "SIGNAL_EXTRACTOR_MODEL",
  "PERSONA_SIM_PROVIDER",
  "PERSONA_SIM_MODEL",
  "LLM_GATEWAY_RATE_INFOMANIAK",
  "LLM_GATEWAY_RATE_ANTHROPIC",
  "LLM_GATEWAY_PRIMARY_TIMEOUT_MS",
  "LLM_GATEWAY_BUDGET_MS",
  "LLM_GATEWAY_FALLBACK",
  "LLM_GATEWAY_IPV4_FIRST",
  "LLM_GATEWAY_LOG",
  "LLM_THINKING_BUDGET_TOKENS",
  "ASC_DEBUG_MODE",
  "ASC_DEBUG_RUN_ID",
  "ASC_DEBUG_DIR",
  "ASC_LLM_TIMEOUT_SECONDS",
  "ASC_LLM_MAX_RETRIES",
];

function buildGatewayEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of PROPAGATED_ENV_KEYS) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

function resolveGatewayServerPath(): string {
  // Caminho 1: MOTOR_LLM_GATEWAY_PATH explícito (override pra STS / desenvolvimento)
  const explicit = process.env["MOTOR_LLM_GATEWAY_PATH"];
  if (explicit) return explicit;

  // Caminho 2: resolve via npm workspace
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@ascendimacy/llm-gateway/package.json");
    return join(dirname(pkgPath), "dist/server.js");
  } catch {
    // Caminho 3: relativo ao motor root via env
    const motorPath = process.env["MOTOR_PATH"];
    if (motorPath) return join(motorPath, "llm-gateway/dist/server.js");
  }
  throw new Error(
    "gateway-client: cannot resolve llm-gateway path. Set MOTOR_LLM_GATEWAY_PATH or ensure @ascendimacy/llm-gateway is installed.",
  );
}

async function getClient(): Promise<Client> {
  if (_client) return _client;
  if (_connecting) return _connecting;
  _connecting = (async () => {
    const client = new Client({ name: "llm-gateway-client", version: "0.1.0" });
    const serverPath = resolveGatewayServerPath();
    if (process.env["LLM_GATEWAY_LOG_SPAWN"] === "true") {
      // motor#28d: stderr logging pra validar singleton (1 spawn por processo Node).
      // Default off — não polui stderr em produção.
      process.stderr.write(
        `[gateway-client] spawning gateway pid=${process.pid} t=${Date.now()}\n`,
      );
    }
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        env: buildGatewayEnv(),
      }),
    );
    _client = client;
    return client;
  })();
  try {
    return await _connecting;
  } finally {
    _connecting = null;
  }
}

/**
 * Bypass do llm-gateway pra `provider=openai-compat` — D-3-PROV (ops#1055).
 *
 * O gateway MCP só rotea anthropic/infomaniak (retry/fallback/bucket
 * coordenado). LLM local (llama.cpp SYCL, vLLM-XPU) não passa pelo
 * gateway — chamada direta via fetch ao `LLM_LOCAL_ENDPOINT`, sem
 * retry coordenado, sem fallback cross-provider. Caller usa o mesmo
 * `callGateway()` agnóstico; o switch é interno aqui.
 *
 * Endpoint default: `http://localhost:8080/v1/chat/completions`
 * Override via env `LLM_LOCAL_ENDPOINT`.
 *
 * Pricing: openai-compat = custo 0 USD (LLM local, sem custo de API);
 * `calculateCostUsd` em llm-config.ts já trata.
 */
interface OpenAiChatChoice {
  /**
   * `message.content` é o canal principal. `reasoning_content` é usado por
   * llama.cpp quando o chat template injeta thinking mode (Qwen3 instruct
   * pode cair nesse caminho mesmo não sendo variante reasoning — D-3-PROV
   * follow-up ops#1055). Defesa: se `content` vier vazio mas houver
   * `reasoning_content`, usamos esse como fallback antes de propagar "".
   */
  message?: { content?: string; reasoning_content?: string };
  finish_reason?: string;
}
interface OpenAiChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}
interface OpenAiChatResponse {
  choices?: OpenAiChatChoice[];
  usage?: OpenAiChatUsage;
  model?: string;
}

async function callLocalChatCompletion(
  req: GatewayChatCompletionInput,
): Promise<GatewayChatCompletionOutput> {
  const endpoint =
    process.env["LLM_LOCAL_ENDPOINT"] ??
    "http://localhost:8080/v1/chat/completions";
  const model =
    req.model && req.model.length > 0
      ? req.model
      : getModelForStep(req.step, "openai-compat");
  // cacheableSystemPrefix é prepended pra preservar caching automático
  // do llama.cpp (prefixos consistentes >1024 tokens cacheiam server-side).
  const systemContent =
    (req.cacheableSystemPrefix ?? "") + req.systemPrompt;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: req.userMessage },
    ],
  };
  if (req.maxTokens !== undefined) body["max_tokens"] = req.maxTokens;
  const timeoutMs = getLlmTimeoutMs(req.step);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `gateway error: HTTP_${res.status} — ${text.slice(0, 200)}`,
      );
    }
    const parsed = (await res.json()) as OpenAiChatResponse;
    const choice = parsed.choices?.[0];
    if (choice === undefined) {
      throw new Error("gateway error: EMPTY_RESPONSE — no choices in response");
    }
    const usage = parsed.usage ?? {};
    // D-3-PROV ops#1055 follow-up: defesa contra empty content.
    // Bug reproduzido em smoke STS Qwen3-30B 2026-05-24 (kei turn 2 G2 fail):
    // materializer recebeu content="" e propagou pra botMessage vazia.
    // Defesa em camadas:
    //  1. Se content vazio mas reasoning_content presente → usa reasoning
    //     (caso edge: chat template thinking=1 detectado em modelo instruct).
    //  2. Se finish_reason ≠ "stop" OU content final vazio → log warning
    //     com fingerprint pra debug (não muda comportamento, dá visibilidade).
    const rawContent = choice.message?.content ?? "";
    const reasoningContent = choice.message?.reasoning_content ?? "";
    const content =
      rawContent.length > 0
        ? rawContent
        : reasoningContent.length > 0
          ? reasoningContent
          : "";
    if (content.length === 0 || (choice.finish_reason && choice.finish_reason !== "stop")) {
      console.warn(
        `[gateway-client] openai-compat suspicious response: ` +
          `finish_reason=${choice.finish_reason ?? "?"} ` +
          `content_len=${rawContent.length} ` +
          `reasoning_len=${reasoningContent.length} ` +
          `step=${req.step} ` +
          `completion_tokens=${usage.completion_tokens ?? 0}`,
      );
    }
    return {
      content,
      tokens: {
        in: usage.prompt_tokens ?? 0,
        out: usage.completion_tokens ?? 0,
        reasoning: 0,
        cacheRead: usage.prompt_tokens_details?.cached_tokens ?? 0,
        cacheCreation: 0,
      },
      provider: "openai-compat",
      model: parsed.model ?? model,
      latency_ms: Date.now() - t0,
      attempt_count: 1,
      was_fallback: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Chama o gateway. Lazy-spawn no primeiro call; reusa o mesmo processo
 * gateway pro resto da vida do processo caller.
 *
 * D-3-PROV (ops#1055): se provider efetivo é `openai-compat`, faz bypass
 * do gateway MCP e chama direto via fetch (LLM local não tem retry/
 * fallback coordenado — overhead do MCP+bucket é desnecessário).
 */
export async function callGateway(
  req: GatewayChatCompletionInput,
): Promise<GatewayChatCompletionOutput> {
  const effectiveProvider = req.provider ?? getProviderForStep(req.step);
  if (effectiveProvider === "openai-compat") {
    return callLocalChatCompletion(req);
  }
  const client = await getClient();
  const result = await client.callTool({
    name: "chat_completion",
    arguments: req as unknown as Record<string, unknown>,
  });
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  const text = r.content?.find((c) => c.type === "text")?.text ?? "";
  if (r.isError) {
    let parsed: { error?: { message?: string; code?: string } };
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    throw new Error(
      `gateway error: ${parsed.error?.code ?? "UNKNOWN"} — ${parsed.error?.message ?? text.slice(0, 200)}`,
    );
  }
  return JSON.parse(text) as GatewayChatCompletionOutput;
}

/** Para fechar o gateway (útil em testes ou shutdown). */
export async function closeGateway(): Promise<void> {
  if (_client) {
    try {
      await _client.close();
    } catch {
      /* swallow — best effort */
    }
    _client = null;
  }
}

/** Para tests — injeta um Client mock. */
export function _setClientForTests(client: Client | null): void {
  _client = client;
  _connecting = null;
}
