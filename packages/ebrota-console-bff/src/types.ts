/**
 * Tipos compartilhados eBrota Console BFF — C-MX-08 (ops#1123).
 *
 * PR1 (S-OC-bootstrap): só os contratos. Implementações de SSE proxy,
 * SQLite índice, approval gate resolver, etc. entram em PR2+ do plan.
 *
 * Esses tipos definem a superfície HTTP/SSE que o frontend Svelte
 * consome. Espelham as MCP tools do orchestrator daemon (C-MX-07) mas
 * em JSON shape compatível com browser.
 */

/** Modo de operação do console. */
export type ConsoleMode = "auto" | "semi-auto";

/** Status do BFF — health/observabilidade. */
export interface BffStatus {
  /** Console mode atualmente ativo (preferência operador). */
  mode: ConsoleMode;
  /** Daemon orchestrator conectado via stdio MCP. */
  daemonConnected: boolean;
  /** motor-channels Baileys conectado (via tools status). */
  channelConnected: boolean;
  /** Sessões ativas no daemon (espelha daemon.status). */
  sessionCount: number;
  /** ISO timestamp do startup BFF. */
  startedAt: string;
}

/** Item da session library (S-OC-30). PR1 só define shape; impl PR6. */
export interface SessionSummary {
  sessionId: string;
  personaId: string;
  conversationId: string;
  kind: "real" | "sts";
  startedAt: string;
  endedAt?: string;
  turnCount: number;
  hasOverrides: boolean;
}

/** Decisão do operador num approval gate (S-OC-08 + S-OD-09). */
export interface ApprovalDecisionPayload {
  approved: boolean;
  editedText?: string;
  rationale?: string;
}
