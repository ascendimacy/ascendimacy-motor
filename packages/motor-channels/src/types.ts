/**
 * Contratos do motor-channels — superfície stdio MCP entre WhatsApp/Baileys
 * e o orchestrator canônico. Ver ops#1115 §"Interface MCP proposta".
 *
 * PR1 (S-MX-06-01+02): só os tipos. Wrappers, router, MCP server entram nos
 * PRs seguintes do plan da capability.
 */

/** ISO 8601 datetime string (e.g., "2026-05-23T12:34:56.000Z"). */
export type Iso8601 = string;

/** WhatsApp JID ou wrapper opaco. Anonimizado em telemetria (ops#1115 NFR Privacy). */
export type ChannelAddress = string;

/** Id de sessão de conversa repassado pro orchestrator. */
export type ConversationId = string;

/** Id da carta física (extraído por detector `^card:<cardId>$`). */
export type CardId = string;

/** Mensagem recebida no canal. */
export interface InboundMessage {
  from: ChannelAddress;
  text: string;
  conversationId: ConversationId;
  timestamp: Iso8601;
}

/** Mensagem a enviar pelo canal. */
export interface OutboundMessage {
  to: ChannelAddress;
  text: string;
}

/** Resultado de envio. */
export interface SendResult {
  messageId: string;
}

/** Status do canal (tool MCP `channel.status`). */
export interface ConnectionStatus {
  connected: boolean;
  lastSeen?: Iso8601;
  queueDepth: number;
}

/** Pacote pedagógico carregado por `cards.getPackage(cardId)`. Estrutura
 *  detalhada vive em S-MX-06-06 (PR3); aqui só o envelope mínimo. */
export interface CardPackage {
  cardId: CardId;
  /** Conteúdo markdown bruto do pacote pedagógico (formato a definir em PR3). */
  raw: string;
  /** Caminho de origem (debug/hot reload). */
  sourcePath: string;
}

/** Evento emitido quando detector `^card:<cardId>$` casa em inbound.
 *  `raw` preserva o texto original (S-MX-06-05) — útil pra telemetria e
 *  debug do detector. */
export interface CardActivatedEvent {
  type: "CardActivated";
  cardId: CardId;
  from: ChannelAddress;
  conversationId: ConversationId;
  timestamp: Iso8601;
  raw: string;
}

/** Evento emitido pra toda mensagem inbound (após detector). */
export interface MessageReceivedEvent {
  type: "MessageReceived";
  from: ChannelAddress;
  text: string;
  conversationId: ConversationId;
  timestamp: Iso8601;
}

/** Mudança de estado da conexão Baileys (QR, reconnect, drop). */
export interface ConnectionChangedEvent {
  type: "ConnectionChanged";
  connected: boolean;
  reason?: string;
  timestamp: Iso8601;
}

/** União discriminada de todos os eventos emitidos pelo motor-channels. */
export type ChannelEvent =
  | CardActivatedEvent
  | MessageReceivedEvent
  | ConnectionChangedEvent;
