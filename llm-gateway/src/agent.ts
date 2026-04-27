/**
 * Global undici Agent config (motor#28a).
 *
 * Mitiga o ETIMEDOUT cascading detectado em STS nagareyama-14d-v1:
 * - `connect.family: 4` força IPv4 (mitiga WSL2 IPv6 stale)
 * - `keepAliveTimeout` curto evita socket idle reaproveitado depois
 *   de servidor matar (caso comum em Infomaniak/Anthropic load balancers)
 *
 * Ambos SDKs (@anthropic-ai/sdk e openai) usam native fetch, que usa
 * undici em Node 18+. setGlobalDispatcher afeta os dois ao mesmo tempo.
 *
 * Idempotente — installAgent() pode ser chamado múltiplas vezes; só
 * configura na primeira call.
 */

import { Agent, setGlobalDispatcher } from "undici";

let installed = false;

export interface AgentOptions {
  /** Force IPv4 lookup (mitigates WSL2 IPv6). Default: true. */
  ipv4First?: boolean;
  /** Keep-alive timeout in ms (default 4000 — short to avoid stale reuse). */
  keepAliveTimeout?: number;
  /** Keep-alive max timeout in ms (default 600000 = 10min). */
  keepAliveMaxTimeout?: number;
  /** Connect timeout in ms (default 10000 = 10s). */
  connectTimeout?: number;
}

export function installAgent(opts: AgentOptions = {}): void {
  if (installed) return;
  installed = true;

  const ipv4First = opts.ipv4First ?? (process.env["LLM_GATEWAY_IPV4_FIRST"] !== "false");
  const keepAliveTimeout = opts.keepAliveTimeout ?? 4000;
  const keepAliveMaxTimeout = opts.keepAliveMaxTimeout ?? 600_000;
  const connectTimeout = opts.connectTimeout ?? 10_000;

  const agentOpts: ConstructorParameters<typeof Agent>[0] = {
    keepAliveTimeout,
    keepAliveMaxTimeout,
    connect: {
      timeout: connectTimeout,
      ...(ipv4First ? { family: 4 } : {}),
    },
  };

  setGlobalDispatcher(new Agent(agentOpts));
}

/** For tests — reset the installed flag so re-install can happen. */
export function _resetForTests(): void {
  installed = false;
}
