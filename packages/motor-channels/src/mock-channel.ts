/**
 * Mock in-memory de `WhatsAppChannel` — zero IO, determinístico.
 *
 * Uso: testes unitários do router/orchestrator wiring sem dependência
 * Baileys/WhatsApp. As três `simulate*` permitem ao teste injetar
 * eventos como se viessem do canal real. `sentMessages` expõe o histórico
 * de outbound pra asserções.
 */

import type { WhatsAppChannel, Unsubscribe } from "./channel.js";
import type {
  ChannelAddress,
  ConnectionChangedEvent,
  ConnectionStatus,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from "./types.js";

export interface MockChannel extends WhatsAppChannel {
  /** Histórico de outbound desde a criação. Read-only pelo consumidor. */
  readonly sentMessages: ReadonlyArray<OutboundMessage>;

  /** Injeta uma mensagem inbound — handlers de `onMessage` recebem. */
  simulateInbound(msg: InboundMessage): void;

  /** Injeta uma mudança de conexão — handlers + `status()` atualizam. */
  simulateConnectionChange(ev: ConnectionChangedEvent): void;

  /** Injeta um QR code — handlers de `onQrCode` recebem. */
  simulateQrCode(qrText: string): void;

  /** Reseta histórico de outbound (útil entre asserções). */
  resetSentMessages(): void;
}

export function createMockChannel(): MockChannel {
  const sent: OutboundMessage[] = [];
  const messageHandlers = new Set<(msg: InboundMessage) => void>();
  const connHandlers = new Set<(ev: ConnectionChangedEvent) => void>();
  const qrHandlers = new Set<(qrText: string) => void>();

  let connected = false;
  let lastSeen: string | undefined;
  let messageCounter = 0;

  const emitConnectionChange = (ev: ConnectionChangedEvent): void => {
    connected = ev.connected;
    lastSeen = ev.timestamp;
    for (const h of connHandlers) h(ev);
  };

  const subscribe = <T>(set: Set<T>, handler: T): Unsubscribe => {
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  };

  return {
    async start(): Promise<void> {
      emitConnectionChange({
        type: "ConnectionChanged",
        connected: true,
        timestamp: new Date().toISOString(),
      });
    },

    async stop(): Promise<void> {
      emitConnectionChange({
        type: "ConnectionChanged",
        connected: false,
        reason: "stopped",
        timestamp: new Date().toISOString(),
      });
    },

    async send(to: ChannelAddress, text: string): Promise<SendResult> {
      sent.push({ to, text });
      messageCounter += 1;
      return { messageId: `mock-msg-${messageCounter}` };
    },

    status(): ConnectionStatus {
      return {
        connected,
        ...(lastSeen !== undefined ? { lastSeen } : {}),
        queueDepth: 0,
      };
    },

    onMessage(handler) {
      return subscribe(messageHandlers, handler);
    },
    onConnectionChange(handler) {
      return subscribe(connHandlers, handler);
    },
    onQrCode(handler) {
      return subscribe(qrHandlers, handler);
    },

    simulateInbound(msg: InboundMessage): void {
      for (const h of messageHandlers) h(msg);
    },

    simulateConnectionChange(ev: ConnectionChangedEvent): void {
      emitConnectionChange(ev);
    },

    simulateQrCode(qrText: string): void {
      for (const h of qrHandlers) h(qrText);
    },

    get sentMessages(): ReadonlyArray<OutboundMessage> {
      return sent;
    },

    resetSentMessages(): void {
      sent.length = 0;
    },
  };
}
