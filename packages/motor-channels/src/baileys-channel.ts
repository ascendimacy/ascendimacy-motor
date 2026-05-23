/**
 * Implementação real de `WhatsAppChannel` sobre Baileys — S-MX-06-03 (PR4b).
 *
 * Auth state file-based via `useMultiFileAuthState` (Baileys built-in).
 * Default D2 ratificou SQLite — desviado temporariamente (Q7=β no thread).
 * Migração SQLite vira PR follow-up dedicado quando houver sinal real que
 * vale o trabalho (~150 LOC custom + signal key store).
 *
 * Lifecycle:
 *  - start() → carrega auth state, cria socket, assina eventos
 *  - eventos QR/connection/messages → repassados pros handlers do contrato
 *  - reconnect automático em close não-logout (DisconnectReason.loggedOut
 *    requer re-scan QR, então paramos)
 *  - stop() → encerra socket sem reconnect
 *  - send() → sock.sendMessage com text content
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { WhatsAppChannel, Unsubscribe } from "./channel.js";
import type {
  ChannelAddress,
  ConnectionChangedEvent,
  ConnectionStatus,
  InboundMessage,
  SendResult,
} from "./types.js";

export interface BaileysChannelOptions {
  /** Diretório pra auth state (multi-file). Será criado se não existir.
   *  Default sugerido: `.baileys-auth/` (já em .gitignore). */
  authDir: string;
  /** Permite injetar uma factory custom de `makeWASocket` em testes pra
   *  evitar IO real. Em prod usa o `makeWASocket` do Baileys diretamente. */
  socketFactory?: typeof makeWASocket;
  /** Idem pra auth state. Permite mock em testes. */
  authStateLoader?: typeof useMultiFileAuthState;
  /** Quanto tempo esperar antes de reconectar após close não-logout.
   *  Default 3000ms. Em testes pode passar 0 pra acelerar. */
  reconnectDelayMs?: number;
}

export function createBaileysChannel(
  opts: BaileysChannelOptions,
): WhatsAppChannel {
  const socketFactory = opts.socketFactory ?? makeWASocket;
  const authStateLoader = opts.authStateLoader ?? useMultiFileAuthState;
  const reconnectDelayMs = opts.reconnectDelayMs ?? 3000;

  const messageHandlers = new Set<(msg: InboundMessage) => void>();
  const connHandlers = new Set<(ev: ConnectionChangedEvent) => void>();
  const qrHandlers = new Set<(qrText: string) => void>();

  let sock: WASocket | null = null;
  let connected = false;
  let lastSeen: string | undefined;
  let stopped = false;

  const emitConnectionChange = (
    nextConnected: boolean,
    reason?: string,
  ): void => {
    connected = nextConnected;
    const ts = new Date().toISOString();
    lastSeen = ts;
    const ev: ConnectionChangedEvent = {
      type: "ConnectionChanged",
      connected: nextConnected,
      ...(reason !== undefined ? { reason } : {}),
      timestamp: ts,
    };
    for (const h of connHandlers) h(ev);
  };

  const parseInbound = (rawMsg: {
    key?: { remoteJid?: string | null };
    message?: {
      conversation?: string | null;
      extendedTextMessage?: { text?: string | null } | null;
    } | null;
    /** number em prod; Long (protobuf wrapper) em alguns paths. */
    messageTimestamp?: unknown;
  }): InboundMessage | null => {
    const from = rawMsg.key?.remoteJid;
    if (typeof from !== "string" || from.length === 0) return null;
    const text =
      rawMsg.message?.conversation ??
      rawMsg.message?.extendedTextMessage?.text ??
      null;
    if (typeof text !== "string" || text.length === 0) return null;
    let timestamp: string;
    if (
      rawMsg.messageTimestamp !== null &&
      rawMsg.messageTimestamp !== undefined
    ) {
      const seconds =
        typeof rawMsg.messageTimestamp === "number"
          ? rawMsg.messageTimestamp
          : Number(rawMsg.messageTimestamp);
      timestamp = new Date(seconds * 1000).toISOString();
    } else {
      timestamp = new Date().toISOString();
    }
    return {
      from,
      text,
      conversationId: from,
      timestamp,
    };
  };

  const connectSocket = async (): Promise<void> => {
    const { state, saveCreds } = await authStateLoader(opts.authDir);
    sock = socketFactory({ auth: state, printQRInTerminal: false });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, qr, lastDisconnect } = update;
      if (typeof qr === "string" && qr.length > 0) {
        for (const h of qrHandlers) h(qr);
      }
      if (connection === "open") {
        emitConnectionChange(true);
      } else if (connection === "close") {
        // lastDisconnect.error é tipicamente Boom (@hapi/boom) — tipamos
        // inline pra não puxar dep transitiva do Baileys explicitamente.
        const errLike = lastDisconnect?.error as
          | { output?: { statusCode?: number } }
          | undefined;
        const code = errLike?.output?.statusCode;
        const isLoggedOut = code === DisconnectReason.loggedOut;
        const reason = isLoggedOut
          ? "loggedOut"
          : `code:${code ?? "unknown"}`;
        emitConnectionChange(false, reason);
        if (!stopped && !isLoggedOut) {
          // reconnect com delay pequeno pra evitar tight loop em falhas
          // persistentes (DNS, banimento, etc.)
          setTimeout(() => {
            if (!stopped) {
              void connectSocket().catch((err) => {
                console.error("[motor-channels] reconnect failed:", err);
              });
            }
          }, reconnectDelayMs);
        }
      }
    });

    sock.ev.on("messages.upsert", ({ messages }) => {
      for (const raw of messages) {
        // ignora mensagens enviadas pelo próprio número (echo) e status
        if (raw.key?.fromMe === true) continue;
        const parsed = parseInbound(raw);
        if (parsed === null) continue;
        for (const h of messageHandlers) h(parsed);
      }
    });
  };

  const subscribe = <T>(set: Set<T>, handler: T): Unsubscribe => {
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  };

  return {
    async start(): Promise<void> {
      stopped = false;
      await connectSocket();
    },

    async stop(): Promise<void> {
      stopped = true;
      if (sock !== null) {
        try {
          sock.end(undefined);
        } catch {
          // sock pode estar em estado inconsistente — engole pra cleanup
        }
        sock = null;
      }
      if (connected) emitConnectionChange(false, "stopped");
    },

    async send(to: ChannelAddress, text: string): Promise<SendResult> {
      if (sock === null) {
        throw new Error(
          "BaileysChannel.send: canal não iniciado. Chamar start() antes.",
        );
      }
      const result = await sock.sendMessage(to, { text });
      const messageId =
        result?.key?.id ?? `unknown-${Date.now()}`;
      return { messageId };
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
  };
}
