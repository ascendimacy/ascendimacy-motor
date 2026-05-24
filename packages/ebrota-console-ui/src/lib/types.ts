/**
 * Tipos compartilhados frontend ↔ BFF. Espelham os de
 * `@ascendimacy/ebrota-console-bff/src/types.ts` — copy-local pra
 * evitar build-time cross-workspace dep no frontend (vite bundle).
 *
 * Mantido em sync manual (acoplamento documentado).
 */

export type ConsoleMode = "auto" | "semi-auto";

export interface BffStatus {
  mode: ConsoleMode;
  daemonConnected: boolean;
  channelConnected: boolean;
  sessionCount: number;
  startedAt: string;
}

export interface StartCardSessionOutput {
  sessionId: string;
  text: string;
  tracePath: string;
}

export type TurnStateEvent =
  | {
      type: "planning_started";
      sessionId: string;
      turn: number;
      timestamp: string;
      payload: {
        strategicRationale: string;
        contentPoolSize: number;
        contentPoolIds: string[];
        contextHints: Record<string, unknown>;
        transitionEvaluationsCount: number;
      };
    }
  | {
      type: "selection_made";
      sessionId: string;
      turn: number;
      timestamp: string;
      payload: {
        selectedContentId: string;
        selectedContentScore: number;
        selectionRationale: string;
      };
    }
  | {
      type: "materialization_ready";
      sessionId: string;
      turn: number;
      timestamp: string;
      payload: {
        proposedText: string;
        instructionAdditionApplied: boolean;
      };
    }
  | {
      type: "playbook_executed";
      sessionId: string;
      turn: number;
      timestamp: string;
      payload: {
        playbookId: string;
        success: boolean;
        newTurnNumber: number;
      };
    };

/** Bubble do chat feed — representação UI agregando inbound + outbound +
 *  estado pedagógico mínimo. Population vem de TurnStateEvents (PR3+). */
export interface ChatBubble {
  /** Identifica a bubble (turn:phase ou uuid). */
  id: string;
  /** "user" = mensagem que veio do canal; "bot" = resposta motor. */
  role: "user" | "bot" | "system";
  text: string;
  timestamp: string;
  /** Marca bubble como pendente de aprovação (semi-auto). */
  pendingApproval?: boolean;
}

/**
 * Snapshot agregado do estado pedagógico corrente — derivado de
 * TurnStateEvents. Sequência canônica garantida pelo orchestrator:
 * planning_started → selection_made → materialization_ready →
 * playbook_executed. UI aplica eventos em ordem; campos populam
 * incrementalmente.
 */
export interface TurnSnapshot {
  sessionId: string;
  turn: number;
  /** Última fase recebida — UI usa pra renderizar progresso. */
  lastPhase:
    | "planning_started"
    | "selection_made"
    | "materialization_ready"
    | "playbook_executed";
  lastTimestamp: string;
  /** Da planning_started. */
  strategicRationale?: string;
  contentPoolSize?: number;
  contentPoolIds?: string[];
  contextHints?: Record<string, unknown>;
  transitionEvaluationsCount?: number;
  /** Da selection_made. */
  selectedContentId?: string;
  selectedContentScore?: number;
  selectionRationale?: string;
  /** Da materialization_ready. */
  proposedText?: string;
  instructionAdditionApplied?: boolean;
  /** Da playbook_executed. */
  playbookId?: string;
  playbookSuccess?: boolean;
  newTurnNumber?: number;
}

/** Reducer canônico — aplica um event ao snapshot. Exportado pra reuse
 *  em store update + tests. */
export const applyTurnEvent = (
  prev: TurnSnapshot | null,
  ev: TurnStateEvent,
): TurnSnapshot => {
  const base: TurnSnapshot = prev !== null
    ? { ...prev }
    : {
        sessionId: ev.sessionId,
        turn: ev.turn,
        lastPhase: ev.type,
        lastTimestamp: ev.timestamp,
      };
  // Se mudou de turn, reset o snapshot
  const isNewTurn =
    prev !== null &&
    (prev.sessionId !== ev.sessionId || prev.turn !== ev.turn);
  const snap: TurnSnapshot = isNewTurn
    ? {
        sessionId: ev.sessionId,
        turn: ev.turn,
        lastPhase: ev.type,
        lastTimestamp: ev.timestamp,
      }
    : base;
  snap.sessionId = ev.sessionId;
  snap.turn = ev.turn;
  snap.lastPhase = ev.type;
  snap.lastTimestamp = ev.timestamp;
  switch (ev.type) {
    case "planning_started":
      snap.strategicRationale = ev.payload.strategicRationale;
      snap.contentPoolSize = ev.payload.contentPoolSize;
      snap.contentPoolIds = ev.payload.contentPoolIds;
      snap.contextHints = ev.payload.contextHints;
      snap.transitionEvaluationsCount =
        ev.payload.transitionEvaluationsCount;
      break;
    case "selection_made":
      snap.selectedContentId = ev.payload.selectedContentId;
      snap.selectedContentScore = ev.payload.selectedContentScore;
      snap.selectionRationale = ev.payload.selectionRationale;
      break;
    case "materialization_ready":
      snap.proposedText = ev.payload.proposedText;
      snap.instructionAdditionApplied =
        ev.payload.instructionAdditionApplied;
      break;
    case "playbook_executed":
      snap.playbookId = ev.payload.playbookId;
      snap.playbookSuccess = ev.payload.success;
      snap.newTurnNumber = ev.payload.newTurnNumber;
      break;
  }
  return snap;
};
