/**
 * Client abstrato pro orchestrator daemon (C-MX-07).
 *
 * Interface decouples BFF do transport real (stdio MCP). Production
 * impl spawna daemon como subprocesso e fala stdio via SDK; tests
 * usam mock in-memory.
 *
 * PR2 entrega só a interface + mock. Production stdio impl entra em
 * PR seguinte (quando C-MX-07 mergeado em main + daemon binary
 * disponível em dist/).
 */

/** Espelha types do orchestrator daemon (C-MX-07) — copy local pra
 *  evitar dependência circular entre workspaces. Mantido em sync
 *  manualmente. */

export interface ScoredContentItemShape {
  item: {
    id: string;
    type?: string;
    domain?: string;
    [key: string]: unknown;
  };
  score: number;
  reasons?: string[];
}

export interface StartCardSessionInput {
  cardId: string;
  conversationId: string;
  from: string;
  pkg: { cardId: string; raw: string; sourcePath: string };
  personaId?: string;
}

export interface StartCardSessionOutput {
  sessionId: string;
  text: string;
  tracePath: string;
}

export interface TurnStateEventShape {
  type:
    | "planning_started"
    | "selection_made"
    | "materialization_ready"
    | "playbook_executed";
  sessionId: string;
  turn: number;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface TurnEventsSnapshot {
  events: TurnStateEventShape[];
  nextIndex: number;
  totalEmitted: number;
}

export interface OverrideSelectionResult {
  accepted: boolean;
  foundInPool: boolean;
  gateWasActive: boolean;
}

export interface ApprovalDecision {
  approved: boolean;
  editedText?: string;
  rationale?: string;
}

export interface ApproveOrEditResult {
  accepted: boolean;
  gateWasActive: boolean;
}

export interface DaemonStatus {
  started: boolean;
  sessionCount: number;
}

export interface PendingApproval {
  proposedText: string;
}

export interface OrchestratorDaemonClient {
  startCardSession(
    input: StartCardSessionInput,
  ): Promise<StartCardSessionOutput>;
  subscribeTurnState(
    sessionId: string,
    sinceIndex?: number,
  ): Promise<TurnEventsSnapshot>;
  listOptions(sessionId: string): Promise<{
    contentPool: ScoredContentItemShape[];
  }>;
  overrideSelection(
    sessionId: string,
    contentItemId: string,
  ): Promise<OverrideSelectionResult>;
  approveOrEdit(
    sessionId: string,
    decision: ApprovalDecision,
  ): Promise<ApproveOrEditResult>;
  getPendingApproval(sessionId: string): Promise<PendingApproval | null>;
  daemonStatus(): Promise<DaemonStatus>;
  endSession(sessionId: string): Promise<{ closed: boolean }>;
  close(): Promise<void>;
}

/**
 * Mock pra testes — implementação in-memory completa. Permite test
 * de endpoints HTTP/SSE sem spawn de subprocesso.
 *
 * Helpers de fixture pré-populam estados; tests podem injetar
 * cenários específicos via opts.
 */
export interface MockDaemonClientOptions {
  initialStatus?: DaemonStatus;
  /** Mapa sessionId → events disponíveis (cumulative; nextIndex incrementa) */
  turnEvents?: Map<string, TurnStateEventShape[]>;
  /** Mapa sessionId → contentPool corrente (gate ativo) */
  pendingPools?: Map<string, ScoredContentItemShape[]>;
  /** Mapa sessionId → proposedText (gate ativo) */
  pendingApprovals?: Map<string, string>;
  /** Override behavior pra startCardSession */
  onStartCardSession?: (
    input: StartCardSessionInput,
  ) => Promise<StartCardSessionOutput>;
}

export interface MockDaemonClient extends OrchestratorDaemonClient {
  /** Test helper — adiciona um evento ao buffer de uma sessão. */
  emitTurnEvent(sessionId: string, event: TurnStateEventShape): void;
  /** Test helper — registra um pending approval. */
  setPendingApproval(sessionId: string, proposedText: string): void;
  /** Test helper — registra um pending pool (gate options). */
  setPendingPool(
    sessionId: string,
    pool: ScoredContentItemShape[],
  ): void;
  /** Test helper — captura todas as chamadas startCardSession. */
  readonly startCalls: StartCardSessionInput[];
  /** Test helper — captura overrides. */
  readonly overrideCalls: Array<{
    sessionId: string;
    contentItemId: string;
  }>;
  /** Test helper — captura approvals. */
  readonly approvalCalls: Array<{
    sessionId: string;
    decision: ApprovalDecision;
  }>;
}

export function createMockDaemonClient(
  opts: MockDaemonClientOptions = {},
): MockDaemonClient {
  const status: DaemonStatus = opts.initialStatus ?? {
    started: true,
    sessionCount: 0,
  };
  const turnEvents = opts.turnEvents ?? new Map<string, TurnStateEventShape[]>();
  const pendingPools =
    opts.pendingPools ?? new Map<string, ScoredContentItemShape[]>();
  const pendingApprovals =
    opts.pendingApprovals ?? new Map<string, string>();
  const sessionIds = new Set<string>();

  const startCalls: StartCardSessionInput[] = [];
  const overrideCalls: Array<{
    sessionId: string;
    contentItemId: string;
  }> = [];
  const approvalCalls: Array<{
    sessionId: string;
    decision: ApprovalDecision;
  }> = [];

  return {
    async startCardSession(input) {
      startCalls.push(input);
      const personaId = input.personaId ?? input.from;
      const sessionId = `${personaId}__${input.conversationId}`;
      sessionIds.add(sessionId);
      status.sessionCount = sessionIds.size;
      if (opts.onStartCardSession !== undefined) {
        return opts.onStartCardSession(input);
      }
      return {
        sessionId,
        text: `mock response for ${input.cardId}`,
        tracePath: `/tmp/mock-trace-${sessionId}.json`,
      };
    },
    async subscribeTurnState(sessionId, sinceIndex = 0) {
      const events = turnEvents.get(sessionId) ?? [];
      const slice = events.slice(sinceIndex);
      return {
        events: slice,
        nextIndex: events.length,
        totalEmitted: events.length,
      };
    },
    async listOptions(sessionId) {
      return {
        contentPool: pendingPools.get(sessionId) ?? [],
      };
    },
    async overrideSelection(sessionId, contentItemId) {
      overrideCalls.push({ sessionId, contentItemId });
      const pool = pendingPools.get(sessionId);
      if (pool === undefined) {
        return {
          accepted: false,
          foundInPool: false,
          gateWasActive: false,
        };
      }
      const found = pool.some((s) => s.item.id === contentItemId);
      if (!found) {
        return {
          accepted: false,
          foundInPool: false,
          gateWasActive: true,
        };
      }
      pendingPools.delete(sessionId);
      return { accepted: true, foundInPool: true, gateWasActive: true };
    },
    async approveOrEdit(sessionId, decision) {
      approvalCalls.push({ sessionId, decision });
      if (!pendingApprovals.has(sessionId)) {
        return { accepted: false, gateWasActive: false };
      }
      pendingApprovals.delete(sessionId);
      return { accepted: true, gateWasActive: true };
    },
    async getPendingApproval(sessionId) {
      const text = pendingApprovals.get(sessionId);
      return text !== undefined ? { proposedText: text } : null;
    },
    async daemonStatus() {
      return { ...status };
    },
    async endSession(sessionId) {
      const existed = sessionIds.has(sessionId);
      sessionIds.delete(sessionId);
      status.sessionCount = sessionIds.size;
      return { closed: existed };
    },
    async close() {
      // no-op pra mock
    },
    emitTurnEvent(sessionId, event) {
      const list = turnEvents.get(sessionId) ?? [];
      list.push(event);
      turnEvents.set(sessionId, list);
    },
    setPendingApproval(sessionId, proposedText) {
      pendingApprovals.set(sessionId, proposedText);
    },
    setPendingPool(sessionId, pool) {
      pendingPools.set(sessionId, pool);
    },
    startCalls,
    overrideCalls,
    approvalCalls,
  };
}
