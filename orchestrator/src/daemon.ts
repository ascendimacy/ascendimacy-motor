#!/usr/bin/env node
/**
 * Orchestrator daemon — entry point pra modo long-running com MCP server.
 * S-OD-02 (PR1) + S-OD-04 session lifecycle (PR2).
 *
 * Spawna trio (planejador + drota + execucao) UMA VEZ no startup, mantém
 * conexões abertas até SIGINT/SIGTERM. Expõe MCP server via stdio.
 *
 * PR2 (este): startSession/endSession com state hydration via motorExecucao
 * get_state. Tools MCP real (startCardSession execução, subscribe_turn_state,
 * list_options, override_selection, approve_or_edit) entram em PRs seguintes
 * (S-OD-05..09).
 *
 * Logs vão pra stderr porque stdout é reservado pra JSON-RPC do MCP.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { SessionState } from "@ascendimacy/shared";
import { connectAll, disconnectAll, type McpClients } from "./mcp-clients.js";
import { createOrchestratorMcpServer } from "./mcp-server.js";
import {
  runTurn,
  type CardContext,
  type TurnStateEvent,
} from "./orchestrator.js";

/** Buffer cap por sessão. Evita memory leak em daemon long-running.
 *  100 events × 4 phases por turn = ~25 turns retidos no buffer. */
const TURN_EVENT_BUFFER_CAP = 100;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TRACES_DIR = join(__dirname, "../../traces");

/**
 * Estado por sessão. Map sessionId → SessionRuntime. state hidratado
 * via motorExecucao.get_state em startSession (S-OD-04). Turn state +
 * hooks pra subscribe_turn_state events entram em PRs seguintes.
 */
export interface SessionRuntime {
  sessionId: string;
  personaId: string;
  conversationId: string;
  startedAt: string;
  /** Hidratado em startSession via motorExecucao get_state. Undefined
   *  durante registerSession (scaffolding); populado pelo lifecycle real. */
  state?: SessionState;
}

export interface OrchestratorDaemonOptions {
  /** Factory pra trio MCP clients (default connectAll real). Tests injetam mock. */
  clientsFactory?: () => Promise<McpClients>;
  /** Idem disconnect (default disconnectAll real). */
  clientsDisposer?: (clients: McpClients) => Promise<void>;
  /** Logger; default escreve em stderr. Tests injetam silent ou spy. */
  log?: (msg: string) => void;
  /** Clock injetável pra startedAt determinístico em testes. */
  now?: () => string;
  /** Diretório onde traces dos turns são gravados. Default mantém o
   *  mesmo path do CLI legacy (`~/ascendimacy-motor/traces/`). */
  tracesDir?: string;
}

export interface RunCardTurnInput {
  cardId: string;
  conversationId: string;
  from: string;
  pkg: { cardId: string; raw: string; sourcePath: string };
  /** Opcional. Default = `from`. PR3 não faz lookup from→persona; resolução
   *  fica pro caller (eBrota Console BFF) ou capability futura. */
  personaId?: string;
}

export interface RunCardTurnOutput {
  sessionId: string;
  text: string;
  tracePath: string;
}

export interface TurnEventsSnapshot {
  /** Events disponíveis a partir de sinceIndex (inclusive). */
  events: TurnStateEvent[];
  /** Próximo index pra usar como sinceIndex na próxima chamada. */
  nextIndex: number;
  /** Total de eventos já gerados pra essa sessão (incluindo evictados pelo cap). */
  totalEmitted: number;
}

interface ToolCallResult {
  content: Array<{ type: string; text?: string }>;
}

const parseToolJson = <T>(result: ToolCallResult): T => {
  const text = result.content.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(text) as T;
};

export class OrchestratorDaemon {
  private clients: McpClients | null = null;
  private sessions = new Map<string, SessionRuntime>();
  /** Buffer per-session de TurnStateEvents emitidos por runTurn.
   *  Capped at TURN_EVENT_BUFFER_CAP. Indexação preserva ordem global
   *  via `totalEmitted` per session (ver subscribeTurnState). */
  private turnEvents = new Map<
    string,
    { events: TurnStateEvent[]; totalEmitted: number }
  >();
  private shuttingDown = false;
  private started = false;

  private readonly factory: () => Promise<McpClients>;
  private readonly dispose: (clients: McpClients) => Promise<void>;
  private readonly log: (msg: string) => void;
  private readonly now: () => string;
  private readonly tracesDir: string;

  constructor(opts: OrchestratorDaemonOptions = {}) {
    this.factory = opts.clientsFactory ?? connectAll;
    this.dispose = opts.clientsDisposer ?? disconnectAll;
    this.log =
      opts.log ?? ((msg: string) => process.stderr.write(`${msg}\n`));
    this.now = opts.now ?? (() => new Date().toISOString());
    this.tracesDir = opts.tracesDir ?? DEFAULT_TRACES_DIR;
  }

  /** Push event ao buffer da sessão, respeitando o cap. Caller passa
   *  esse método como callback pra runTurn via onTurnEvent. */
  private pushTurnEvent(event: TurnStateEvent): void {
    let bucket = this.turnEvents.get(event.sessionId);
    if (bucket === undefined) {
      bucket = { events: [], totalEmitted: 0 };
      this.turnEvents.set(event.sessionId, bucket);
    }
    bucket.events.push(event);
    bucket.totalEmitted += 1;
    if (bucket.events.length > TURN_EVENT_BUFFER_CAP) {
      bucket.events.splice(0, bucket.events.length - TURN_EVENT_BUFFER_CAP);
    }
  }

  /**
   * Pull-based subscribe — retorna events emitidos desde `sinceIndex`
   * (global index, não array index). Caller atualiza sinceIndex com o
   * `nextIndex` retornado pra próxima chamada.
   *
   * Se sinceIndex < (totalEmitted - buffer.length), eventos foram
   * evictados pelo cap — retorna apenas o que está disponível, e caller
   * detecta gap via comparação `(received_first_index > sinceIndex)`.
   */
  subscribeTurnState(sessionId: string, sinceIndex = 0): TurnEventsSnapshot {
    const bucket = this.turnEvents.get(sessionId);
    if (bucket === undefined) {
      return { events: [], nextIndex: 0, totalEmitted: 0 };
    }
    const firstBufferedIndex = bucket.totalEmitted - bucket.events.length;
    const sliceStart = Math.max(0, sinceIndex - firstBufferedIndex);
    const events = bucket.events.slice(sliceStart);
    return {
      events,
      nextIndex: bucket.totalEmitted,
      totalEmitted: bucket.totalEmitted,
    };
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
    this.turnEvents.clear();
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
   * Inicia uma sessão com state hydration. Chamado por
   * `startCardSession` MCP tool quando uma carta-acionada chega via
   * motor-channels bridge. Hidrata state inicial via motorExecucao
   * get_state (mesmo pattern de runTurn em orchestrator.ts).
   *
   * sessionId é derivado de (personaId, conversationId) se não passado —
   * permite reabertura idempotente do mesmo par. Se passado, usa direto.
   */
  async startSession(input: {
    personaId: string;
    conversationId: string;
    sessionId?: string;
  }): Promise<SessionRuntime> {
    if (!this.started || this.clients === null) {
      throw new Error(
        "OrchestratorDaemon.startSession: daemon não iniciado. Chamar start() antes.",
      );
    }
    const sessionId =
      input.sessionId ?? `${input.personaId}__${input.conversationId}`;

    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }

    const stateRaw = (await this.clients.motorExecucao.callTool({
      name: "get_state",
      arguments: { sessionId, personaId: input.personaId },
    })) as ToolCallResult;
    const state = parseToolJson<SessionState>(stateRaw);

    const runtime: SessionRuntime = {
      sessionId,
      personaId: input.personaId,
      conversationId: input.conversationId,
      startedAt: this.now(),
      state,
    };
    this.sessions.set(sessionId, runtime);
    this.log(
      `[orchestrator-daemon] session started: ${sessionId} (persona=${input.personaId})`,
    );
    return runtime;
  }

  /**
   * Executa um turn de carta-acionada — S-OD-05 (PR3).
   *
   * Fluxo:
   *  1. startSession (idempotente) → SessionRuntime com state hidratado
   *  2. runTurn com cardContext = {cardId, pkgRaw} → orchestrator.ts
   *     prefixa pkgRaw em instruction_addition antes de motor-drota
   *  3. Retorna texto materializado pelo motor-drota
   *
   * message do turn = literal `card:<cardId>` (a ativação do detector).
   * Motor vê isso como input e responde construindo opening sobre o pkg.
   */
  async runCardTurn(input: RunCardTurnInput): Promise<RunCardTurnOutput> {
    if (!this.started || this.clients === null) {
      throw new Error(
        "OrchestratorDaemon.runCardTurn: daemon não iniciado",
      );
    }
    const personaId = input.personaId ?? input.from;
    const runtime = await this.startSession({
      personaId,
      conversationId: input.conversationId,
    });
    const message = `card:${input.cardId}`;
    const cardContext: CardContext = {
      cardId: input.cardId,
      pkgRaw: input.pkg.raw,
    };
    const { finalResponse, tracePath } = await runTurn(
      this.clients,
      runtime.sessionId,
      runtime.personaId,
      message,
      this.tracesDir,
      undefined,
      cardContext,
      (ev) => this.pushTurnEvent(ev),
    );
    return {
      sessionId: runtime.sessionId,
      text: finalResponse,
      tracePath,
    };
  }

  /**
   * Encerra sessão. PR2: cleanup minimalista (remove do registry).
   * Flush de eventos + persistência cross-restart vira PR futura.
   */
  async endSession(sessionId: string): Promise<{ closed: boolean }> {
    const runtime = this.sessions.get(sessionId);
    if (runtime === undefined) {
      return { closed: false };
    }
    this.sessions.delete(sessionId);
    this.log(`[orchestrator-daemon] session ended: ${sessionId}`);
    return { closed: true };
  }

  /**
   * Acesso aos clients pra tools MCP que precisam falar com trio.
   * Throws quando daemon não está started — caller verifica.
   */
  getClients(): McpClients {
    if (this.clients === null) {
      throw new Error(
        "OrchestratorDaemon.getClients: daemon não iniciado",
      );
    }
    return this.clients;
  }

  /**
   * Lista sessions ativas — útil pra debug + futura tool MCP `listSessions`.
   */
  listSessions(): SessionRuntime[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Adiciona uma sessão diretamente ao registry. Mantido pra cenários
   * que NÃO precisam de state hydration (scaffolding inicial PR1, testes).
   * Em produção, prefira `startSession`.
   */
  registerSession(runtime: SessionRuntime): void {
    if (this.sessions.has(runtime.sessionId)) {
      throw new Error(
        `OrchestratorDaemon.registerSession: sessionId duplicado ${runtime.sessionId}`,
      );
    }
    this.sessions.set(runtime.sessionId, runtime);
  }

  /** Remove sessão sem efeitos colaterais (não chama endSession). */
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
  // Iniciar daemon ANTES do server: tools MCP precisam de clients prontos.
  await daemon.start();

  const server = createOrchestratorMcpServer({ daemon });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  (opts.log ?? ((m) => process.stderr.write(`${m}\n`)))(
    "[orchestrator-daemon] stdio MCP server ready",
  );

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
const isMainEntry =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("daemon.js") ||
    process.argv[1].endsWith("daemon.ts"));

if (isMainEntry) {
  await bootDaemon();
}
