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
import type {
  ScoredContentItem,
  SessionState,
} from "@ascendimacy/shared";
import { connectAll, disconnectAll, type McpClients } from "./mcp-clients.js";
import { createOrchestratorMcpServer } from "./mcp-server.js";
import {
  runTurn,
  type CardContext,
  type OptionsGate,
  type OptionsGateDecision,
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
  /** Se > 0, ativa semi-auto mode: runTurn aguarda decisão via
   *  listOptions/overrideSelection até esse timeout (ms) antes de
   *  proceder com pool original. Default 0 = auto mode (sem pause,
   *  behavior PR3-PR4 idêntico). */
  semiAutoTimeoutMs?: number;
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

export interface OverrideSelectionResult {
  /** True se gate estava ativo + contentItemId existia no pool corrente. */
  accepted: boolean;
  /** True se contentItemId aparece no pool corrente; false sinaliza "id
   *  inválido" pra UI (vs accepted=false por gate inativo). */
  foundInPool: boolean;
  /** True se uma sessão tinha gate pendente (independente do match). */
  gateWasActive: boolean;
}

export interface ApprovalDecision {
  /** True envia (com editedText se presente, senão proposedText original);
   *  false aborta (não envia outbound). */
  approved: boolean;
  /** Se presente, substitui o proposedText antes do envio. */
  editedText?: string;
  /** Optional: comentário freeform do operador pra Edit Learner v0
   *  (DS-04). Persistido em telemetria pelo caller (BFF). */
  rationale?: string;
}

export interface SubmitForApprovalOptions {
  /** Timeout em ms. Após expirar, gate resolve com `{approved: true}`
   *  (auto-approve fail-safe — não bloqueia outbound em produção). */
  timeoutMs: number;
  /** Decisão default em caso de timeout. Default `{approved: true}`. Em
   *  modo paranoid pode setar `{approved: false}` pra abortar silenciosamente. */
  defaultDecision?: ApprovalDecision;
  /** Contexto pedagógico do turn — populado pelo daemon em semi-auto mode
   *  para enriquecer a ApprovalGate na UI (ops#1158). */
  context?: PendingApprovalContext;
}

/** Snapshot do contexto pedagógico do turn — exibido na ApprovalGate
 *  da eBrota Console para orientar decisão do operador (ops#1158). */
export interface PendingApprovalContext {
  /** IDs do contentPool gerado pelo planejador (top-K antes do drota). */
  contentPoolIds: string[];
  /** Rationale estratégico gerado pelo planejador LLM. */
  strategicRationale: string;
  /** Hints de composição (language, mood, avoid, question_detected, etc). */
  contextHints: Record<string, unknown>;
  /** ContentItem selecionado pelo motor-drota. */
  selectedContentId: string;
  /** Snapshot leve do estado da sessão no momento do turn. */
  sessionState?: {
    trustLevel: number;
    turn: number;
    budgetRemaining: number;
  };
}

export interface ApproveOrEditResult {
  /** True se gate estava pendente + decision foi aplicada. */
  accepted: boolean;
  /** True se sessionId tinha approval gate pendente. */
  gateWasActive: boolean;
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
  /** Gates pendentes per-session — ativos durante runTurn entre
   *  plan_turn e evaluate_and_select quando semiAutoTimeoutMs > 0.
   *  listOptions lê o contentPool daqui; overrideSelection resolve. */
  private pendingGates = new Map<
    string,
    {
      contentPool: ScoredContentItem[];
      resolve: (decision: OptionsGateDecision) => void;
    }
  >();
  /** Approvals pendentes per-session — registradas via submitForApproval
   *  (caller motor-channels bridge ou BFF), resolvidas via approveOrEdit
   *  MCP tool. proposedText fica acessível pra getPendingApproval. */
  private pendingApprovals = new Map<
    string,
    {
      proposedText: string;
      context?: PendingApprovalContext;
      resolve: (decision: ApprovalDecision) => void;
    }
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

  /**
   * Cria optionsGate pra runTurn quando semi-auto está ativo. Gate
   * registra entrada no pendingGates + cria timeout que resolve sem
   * override se Jun não decidir a tempo. Returns undefined em auto
   * mode.
   */
  private buildOptionsGate(
    sessionId: string,
    timeoutMs: number,
  ): OptionsGate | undefined {
    if (timeoutMs <= 0) return undefined;
    return (gateInput) =>
      new Promise<OptionsGateDecision>((resolve) => {
        const timeoutHandle = setTimeout(() => {
          this.pendingGates.delete(sessionId);
          resolve({});
        }, timeoutMs);
        this.pendingGates.set(sessionId, {
          contentPool: gateInput.contentPool,
          resolve: (decision) => {
            clearTimeout(timeoutHandle);
            this.pendingGates.delete(sessionId);
            resolve(decision);
          },
        });
      });
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
   * Registra approval pendente pra `sessionId` (S-OD-09). Retorna
   * Promise que resolve quando approveOrEdit é chamado, ou após timeout
   * com `defaultDecision` (default `{approved: true}` — fail-safe que
   * NÃO bloqueia outbound em produção). Caller (bridge ou BFF) await
   * essa Promise antes de fazer channel.send.
   *
   * Se já há approval pendente pra mesma sessionId, sobrescreve (caller
   * decide política — em geral, último win).
   */
  submitForApproval(
    sessionId: string,
    proposedText: string,
    opts: SubmitForApprovalOptions,
  ): Promise<ApprovalDecision> {
    const defaultDecision: ApprovalDecision =
      opts.defaultDecision ?? { approved: true };
    return new Promise<ApprovalDecision>((resolve) => {
      const existing = this.pendingApprovals.get(sessionId);
      if (existing !== undefined) {
        // Resolve a anterior com default (sem perder caller que estava
        // aguardando) e sobrescreve com a nova.
        existing.resolve(defaultDecision);
      }
      const timeoutHandle = setTimeout(() => {
        this.pendingApprovals.delete(sessionId);
        resolve(defaultDecision);
      }, opts.timeoutMs);
      this.pendingApprovals.set(sessionId, {
        proposedText,
        context: opts.context,
        resolve: (decision) => {
          clearTimeout(timeoutHandle);
          this.pendingApprovals.delete(sessionId);
          resolve(decision);
        },
      });
    });
  }

  /**
   * Snapshot do approval pendente. UI usa pra mostrar o proposedText
   * antes do operador decidir. Inclui contexto pedagógico (ops#1158).
   */
  getPendingApproval(
    sessionId: string,
  ): { proposedText: string; context?: PendingApprovalContext } | undefined {
    const pending = this.pendingApprovals.get(sessionId);
    if (pending === undefined) return undefined;
    return { proposedText: pending.proposedText, context: pending.context };
  }

  /**
   * Resolve approval pendente com a decisão do operador (S-OD-09).
   * Caller (BFF do eBrota Console via MCP tool approve_or_edit) chama
   * isso quando Jun clica Approve/Edit/Reject na UI.
   */
  approveOrEdit(
    sessionId: string,
    decision: ApprovalDecision,
  ): ApproveOrEditResult {
    const pending = this.pendingApprovals.get(sessionId);
    if (pending === undefined) {
      return { accepted: false, gateWasActive: false };
    }
    pending.resolve(decision);
    return { accepted: true, gateWasActive: true };
  }

  /**
   * Retorna pool corrente sob gate pendente (S-OD-07). Vazio se sessão
   * não tem gate ativo (auto mode, ou turn já passou da fase). UI usa
   * pra mostrar leque pedagógico TOP-N expansível.
   */
  listOptions(sessionId: string): ScoredContentItem[] {
    return this.pendingGates.get(sessionId)?.contentPool ?? [];
  }

  /**
   * Resolve o gate pendente forçando motor-drota a usar `contentItemId`
   * em vez do top-score (S-OD-08). Retorna metadata:
   *  - gateWasActive: tinha gate pendente
   *  - foundInPool: contentItemId existe no pool atual
   *  - accepted: ambos true → override aplicado
   */
  overrideSelection(
    sessionId: string,
    contentItemId: string,
  ): OverrideSelectionResult {
    const pending = this.pendingGates.get(sessionId);
    if (pending === undefined) {
      return { accepted: false, foundInPool: false, gateWasActive: false };
    }
    const foundInPool = pending.contentPool.some(
      (s) => s.item.id === contentItemId,
    );
    if (!foundInPool) {
      return { accepted: false, foundInPool: false, gateWasActive: true };
    }
    pending.resolve({ overrideContentItemId: contentItemId });
    return { accepted: true, foundInPool: true, gateWasActive: true };
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
    // Resolve gates/approvals pendentes pra não deixar callers em pé.
    for (const [, pending] of this.pendingGates) {
      pending.resolve({});
    }
    this.pendingGates.clear();
    // Approvals: shutdown decide approved=false (não envia outbound se
    // operador não decidiu). Conservador no shutdown.
    for (const [, pending] of this.pendingApprovals) {
      pending.resolve({ approved: false });
    }
    this.pendingApprovals.clear();
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
    const optionsGate = this.buildOptionsGate(
      runtime.sessionId,
      input.semiAutoTimeoutMs ?? 0,
    );
    const { finalResponse, tracePath } = await runTurn(
      this.clients,
      runtime.sessionId,
      runtime.personaId,
      message,
      this.tracesDir,
      undefined,
      cardContext,
      (ev) => this.pushTurnEvent(ev),
      optionsGate,
    );

    // Semi-auto approval gate (ops#1158): após runTurn, submete texto pro
    // operador revisar/editar antes de retornar. Bloqueia até aprovação ou
    // timeout (auto-approve fail-safe). Contexto pedagógico vem dos turn events.
    if (input.semiAutoTimeoutMs && input.semiAutoTimeoutMs > 0) {
      const approvalContext = this.buildApprovalContext(runtime.sessionId, runtime.state);
      const decision = await this.submitForApproval(
        runtime.sessionId,
        finalResponse,
        { timeoutMs: input.semiAutoTimeoutMs, context: approvalContext },
      );
      const approvedText =
        decision.approved && decision.editedText !== undefined
          ? decision.editedText
          : finalResponse;
      return { sessionId: runtime.sessionId, text: approvedText, tracePath };
    }

    return {
      sessionId: runtime.sessionId,
      text: finalResponse,
      tracePath,
    };
  }

  /**
   * Extrai contexto pedagógico dos turn events recentes para enriquecer
   * a ApprovalGate (ops#1158). Lê os últimos planning_started e
   * selection_made emitidos pela sessão.
   */
  private buildApprovalContext(
    sessionId: string,
    sessionState: SessionRuntime["state"],
  ): PendingApprovalContext {
    const bucket = this.turnEvents.get(sessionId);
    const events = bucket?.events ?? [];
    // Busca o último planning_started e selection_made (ordem crescente = índice maior).
    let strategicRationale = "";
    let contentPoolIds: string[] = [];
    let contextHints: Record<string, unknown> = {};
    let selectedContentId = "";
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]!;
      if (ev.type === "selection_made" && !selectedContentId) {
        selectedContentId = ev.payload.selectedContentId;
      }
      if (ev.type === "planning_started" && !strategicRationale) {
        strategicRationale = ev.payload.strategicRationale;
        contentPoolIds = ev.payload.contentPoolIds;
        contextHints = ev.payload.contextHints;
      }
      if (strategicRationale && selectedContentId) break;
    }
    return {
      contentPoolIds,
      strategicRationale,
      contextHints,
      selectedContentId,
      sessionState: sessionState
        ? {
            trustLevel: sessionState.trustLevel,
            turn: sessionState.turn,
            budgetRemaining: sessionState.budgetRemaining,
          }
        : undefined,
    };
  }

  /**
   * Executa um turn de mensagem livre para sessão existente (eBrota Console).
   * Requer que a sessão já exista (via runCardTurn anterior). Se
   * semiAutoTimeoutMs > 0, submete resultado para aprovação antes de retornar.
   */
  async sendConsoleTurn(
    sessionId: string,
    message: string,
    semiAutoTimeoutMs = 0,
  ): Promise<RunCardTurnOutput> {
    if (!this.started || this.clients === null) {
      throw new Error(
        "OrchestratorDaemon.sendConsoleTurn: daemon não iniciado",
      );
    }
    const runtime = this.sessions.get(sessionId);
    if (runtime === undefined) {
      throw new Error(
        `OrchestratorDaemon.sendConsoleTurn: sessão não encontrada: ${sessionId}`,
      );
    }
    const optionsGate = this.buildOptionsGate(sessionId, semiAutoTimeoutMs);
    const { finalResponse, tracePath } = await runTurn(
      this.clients,
      sessionId,
      runtime.personaId,
      message,
      this.tracesDir,
      undefined,
      undefined,
      (ev) => this.pushTurnEvent(ev),
      optionsGate,
    );
    if (semiAutoTimeoutMs > 0) {
      const approvalContext = this.buildApprovalContext(sessionId, runtime.state);
      const decision = await this.submitForApproval(sessionId, finalResponse, {
        timeoutMs: semiAutoTimeoutMs,
        context: approvalContext,
      });
      const approvedText =
        decision.approved && decision.editedText !== undefined
          ? decision.editedText
          : finalResponse;
      return { sessionId, text: approvedText, tracePath };
    }
    return { sessionId, text: finalResponse, tracePath };
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
