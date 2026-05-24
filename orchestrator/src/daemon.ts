#!/usr/bin/env node
/**
 * Orchestrator daemon — entry point pra modo long-running com MCP server.
 * S-OD-02 (C-MX-07 PR1).
 *
 * Spawna trio (planejador + drota + execucao) UMA VEZ no startup, mantém
 * conexões abertas até SIGINT/SIGTERM. Expõe MCP server via stdio.
 *
 * PR1 (este): SCAFFOLDING. Tools reais (startCardSession real impl,
 * subscribe_turn_state streaming, list_options, override_selection,
 * approve_or_edit) são entregues em PRs posteriores (S-OD-05..09).
 * mcp-server.ts continua skeleton aqui — daemon só wireia o stdio
 * transport + lifecycle.
 *
 * Logs vão pra stderr porque stdout é reservado pra JSON-RPC do MCP.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectAll, disconnectAll, type McpClients } from "./mcp-clients.js";
import { createOrchestratorMcpServer } from "./mcp-server.js";

/**
 * Estado por sessão. Map sessionId → SessionRuntime.
 * PR1: estrutura minimalista; PR2 (S-OD-04) popula turn state, hooks
 * pra subscribe_turn_state events, etc.
 */
export interface SessionRuntime {
  sessionId: string;
  personaId: string;
  conversationId: string;
  startedAt: string;
}

export interface OrchestratorDaemonOptions {
  /** Factory pra trio MCP clients (default connectAll real). Tests injetam mock. */
  clientsFactory?: () => Promise<McpClients>;
  /** Idem disconnect (default disconnectAll real). */
  clientsDisposer?: (clients: McpClients) => Promise<void>;
  /** Logger; default escreve em stderr. Tests injetam silent ou spy. */
  log?: (msg: string) => void;
}

export class OrchestratorDaemon {
  private clients: McpClients | null = null;
  private sessions = new Map<string, SessionRuntime>();
  private shuttingDown = false;
  private started = false;

  private readonly factory: () => Promise<McpClients>;
  private readonly dispose: (clients: McpClients) => Promise<void>;
  private readonly log: (msg: string) => void;

  constructor(opts: OrchestratorDaemonOptions = {}) {
    this.factory = opts.clientsFactory ?? connectAll;
    this.dispose = opts.clientsDisposer ?? disconnectAll;
    this.log =
      opts.log ?? ((msg: string) => process.stderr.write(`${msg}\n`));
  }

  /** Conecta o trio. Idempotente: chamadas subsequentes são no-op. */
  async start(): Promise<void> {
    if (this.started) return;
    this.clients = await this.factory();
    this.started = true;
    this.log("[orchestrator-daemon] trio connected");
  }

  /** Fecha sessions ativas + desconecta trio. Idempotente. */
  async stop(): Promise<void> {
    if (this.shuttingDown || !this.started) return;
    this.shuttingDown = true;
    this.log("[orchestrator-daemon] shutting down");
    this.sessions.clear();
    if (this.clients !== null) {
      await this.dispose(this.clients);
      this.clients = null;
    }
    this.started = false;
    this.shuttingDown = false;
  }

  /** Snapshot do estado pra debug/testes. */
  status(): { started: boolean; sessionCount: number } {
    return {
      started: this.started,
      sessionCount: this.sessions.size,
    };
  }

  /**
   * Adiciona uma sessão ao registry. PR1: scaffolding minimalista — não
   * conecta a clients ainda; PR2 (S-OD-04) liga state hydration + turn
   * pipeline + subscribe_turn_state events.
   */
  registerSession(runtime: SessionRuntime): void {
    if (this.sessions.has(runtime.sessionId)) {
      throw new Error(
        `OrchestratorDaemon.registerSession: sessionId duplicado ${runtime.sessionId}`,
      );
    }
    this.sessions.set(runtime.sessionId, runtime);
  }

  /** Remove sessão. Idempotente quando ausente. */
  unregisterSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): SessionRuntime | undefined {
    return this.sessions.get(sessionId);
  }
}

/**
 * Entry point: cria daemon, conecta MCP server stdio, instala signal
 * handlers. Mantido fora da class pra facilitar testes (testes
 * instanciam a class sem mexer em process.on).
 */
export async function bootDaemon(
  opts: OrchestratorDaemonOptions = {},
): Promise<{ daemon: OrchestratorDaemon }> {
  const daemon = new OrchestratorDaemon(opts);

  const server = createOrchestratorMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  (opts.log ?? ((m) => process.stderr.write(`${m}\n`)))(
    "[orchestrator-daemon] stdio MCP server ready",
  );

  await daemon.start();

  const onSignal = (sig: NodeJS.Signals): void => {
    void (async () => {
      (opts.log ?? ((m) => process.stderr.write(`${m}\n`)))(
        `[orchestrator-daemon] received ${sig}`,
      );
      await daemon.stop();
      await server.close();
      process.exit(0);
    })();
  };

  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  return { daemon };
}

// Top-level await entry. Não roda quando importado por testes (test files
// importam a class direto, não esse módulo como entry).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isMainEntry =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("daemon.js") ||
    process.argv[1].endsWith("daemon.ts"));

if (isMainEntry) {
  await bootDaemon();
}
