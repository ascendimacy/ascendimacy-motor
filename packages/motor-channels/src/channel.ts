/**
 * Contrato `WhatsAppChannel` — S-MX-06-03 (ops#1115).
 *
 * Define a superfície que o motor-channels expõe ao orchestrator e a
 * qualquer test/integração: ciclo de vida, envio, status e três streams
 * de eventos (inbound, mudança de conexão, QR code de auth).
 *
 * PR4 (escopo magro): apenas a interface + mock in-memory. A impl real
 * (Baileys + SQLite auth) entra em PR4b, atrás de QR scan manual pelo
 * Jun. Mock é zero-IO, suficiente pra testar router/orchestrator wiring
 * em PRs seguintes.
 */

import type {
  ChannelAddress,
  ConnectionChangedEvent,
  ConnectionStatus,
  InboundMessage,
  SendResult,
} from "./types.js";

/** Função pra remover um handler previamente registrado. Idempotente. */
export type Unsubscribe = () => void;

export interface WhatsAppChannel {
  /** Inicia ciclo de conexão. Para impl real dispara fluxo Baileys (QR se
   *  primeiro acesso, reconnect se sessão persistida). Para mock apenas
   *  marca `connected=true` e dispara `ConnectionChanged`. */
  start(): Promise<void>;

  /** Encerra conexão limpa. Marca `connected=false` + dispara evento. */
  stop(): Promise<void>;

  /** Envia mensagem outbound. Resolve com `messageId` opaco do canal. */
  send(to: ChannelAddress, text: string): Promise<SendResult>;

  /** Snapshot síncrono do estado atual da conexão. */
  status(): ConnectionStatus;

  /** Stream de mensagens recebidas. Caller decide se passa por `routeInbound`
   *  ou processa direto. Múltiplos handlers permitidos. */
  onMessage(handler: (msg: InboundMessage) => void): Unsubscribe;

  /** Stream de mudanças de conexão (QR scan completo, drop, logout, etc.). */
  onConnectionChange(
    handler: (ev: ConnectionChangedEvent) => void,
  ): Unsubscribe;

  /** Emite QR code (texto) na primeira auth ou após logout. Mock pode
   *  disparar via `simulateQrCode`. Impl real recebe do Baileys
   *  `connection.update`. */
  onQrCode(handler: (qrText: string) => void): Unsubscribe;
}
