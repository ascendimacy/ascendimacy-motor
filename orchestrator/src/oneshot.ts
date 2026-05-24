/**
 * Runtime de "one-shot" — S-OD-01 (C-MX-07 PR1).
 *
 * Extraído do cli.ts pra ser reusável: o que era inline (connect trio →
 * runTurn → disconnect) vira função importável. Permite o cli.ts ficar
 * thin wrapper E o daemon (futuro PR2) reusar o mesmo padrão pra
 * "single turn fora de sessão", se precisar.
 *
 * Comportamento preservado: spawn trio, executa 1 turn, desconecta.
 * Sem mudança de external behavior do `motor run`.
 */

import { connectAll, disconnectAll, type McpClients } from "./mcp-clients.js";
import { runTurn } from "./orchestrator.js";

export interface OneShotOptions {
  persona: string;
  message: string;
  sessionId: string;
  tracesDir: string;
  /** Permite injetar factory de clients pra testes (default = connectAll real). */
  clientsFactory?: () => Promise<McpClients>;
  /** Idem disconnect (default = disconnectAll real). */
  clientsDisposer?: (clients: McpClients) => Promise<void>;
}

export interface OneShotResult {
  finalResponse: string;
  tracePath: string;
}

export async function runOneShot(opts: OneShotOptions): Promise<OneShotResult> {
  const factory = opts.clientsFactory ?? connectAll;
  const dispose = opts.clientsDisposer ?? disconnectAll;

  const clients = await factory();
  try {
    return await runTurn(
      clients,
      opts.sessionId,
      opts.persona,
      opts.message,
      opts.tracesDir,
    );
  } finally {
    await dispose(clients);
  }
}
