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
import type { LlmProvider } from "./llm-router.js";

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
 * Chama o gateway. Lazy-spawn no primeiro call; reusa o mesmo processo
 * gateway pro resto da vida do processo caller.
 */
export async function callGateway(
  req: GatewayChatCompletionInput,
): Promise<GatewayChatCompletionOutput> {
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
