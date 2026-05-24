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
