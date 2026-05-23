/**
 * Bridge motor-channels ↔ orchestrator — S-MX-06-07 (ops#1115).
 *
 * Shim que conecta:
 *  1. inbound do canal → `routeInbound` (PR2) → `CardActivated`
 *  2. `CardActivated` → `loader.load(cardId)` (PR3) → `CardPackage` ou
 *     `cardNotFoundMessage` de fallback
 *  3. bridge.startCardSession(pkg) → resposta textual
 *  4. resposta → `channel.send` (PR4) sob rate limit
 *
 * `OrchestratorBridge` é a interface que o orchestrator real (capability
 * separada, PR6b skeleton) implementa. Para testes, usa-se um mock.
 */

import { routeInbound } from "./router.js";
import { createTokenBucket, type RateLimiter } from "./rate-limit.js";
import type { CardPackageLoader } from "./cards-loader.js";
import type { WhatsAppChannel, Unsubscribe } from "./channel.js";
import type {
  CardActivatedEvent,
  CardId,
  CardPackage,
  ChannelAddress,
  ConversationId,
  InboundMessage,
} from "./types.js";

export interface StartCardSessionInput {
  cardId: CardId;
  conversationId: ConversationId;
  from: ChannelAddress;
  pkg: CardPackage;
}

export interface StartCardSessionOutput {
  /** Texto a enviar de volta pelo canal. */
  text: string;
}

export interface OrchestratorBridge {
  /** Chamado quando o detector dispara `CardActivated`. Implementação real
   *  (futura PR motor-orchestrator) faz route pra motor-drota com contexto
   *  enriquecido pelo pacote. PR6 só define a forma. */
  startCardSession(
    input: StartCardSessionInput,
  ): Promise<StartCardSessionOutput>;
}

export interface InboundBridgeOptions {
  channel: WhatsAppChannel;
  loader: CardPackageLoader;
  bridge: OrchestratorBridge;
  /** Default: token bucket 1 msg/sec, burst 3. Override pra testes ou
   *  configs prod via env. */
  rateLimit?: RateLimiter;
  /** Mensagem enviada quando o cardId é válido (detector casou) mas o
   *  pacote pedagógico não está disponível no loader. Default em pt-br.
   *  Futura PR pode mover essa decisão pro orchestrator. */
  cardNotFoundMessage?: string;
  /** Hook opcional pra erros surgindo de bridge.startCardSession ou
   *  channel.send. Default loga via console.error. */
  onError?: (err: unknown, context: { event: CardActivatedEvent }) => void;
}

export interface InboundBridge {
  /** Subscreve a canal.onMessage. Idempotente — chamadas extras são no-op. */
  start(): void;
  /** Cancela subscription. Idempotente. */
  stop(): void;
}

const DEFAULT_CARD_NOT_FOUND = "Carta não encontrada.";

export function createInboundBridge(
  opts: InboundBridgeOptions,
): InboundBridge {
  const rateLimit =
    opts.rateLimit ?? createTokenBucket({ tokensPerSec: 1, burst: 3 });
  const fallback = opts.cardNotFoundMessage ?? DEFAULT_CARD_NOT_FOUND;
  const onError =
    opts.onError ??
    ((err) => {
      console.error("[motor-channels] inbound bridge error:", err);
    });

  let unsubscribe: Unsubscribe | null = null;

  const handleInbound = (msg: InboundMessage): void => {
    const events = routeInbound(msg);
    for (const ev of events) {
      if (ev.type !== "CardActivated") continue;
      // fire-and-forget — handler de canal é sync, e queremos drenar todas
      // as cartas sem bloquear o stream. Erros vão pro onError.
      void processCardActivated(ev);
    }
  };

  const processCardActivated = async (
    ev: CardActivatedEvent,
  ): Promise<void> => {
    try {
      const pkg = await opts.loader.load(ev.cardId);
      let responseText: string;
      if (pkg === null) {
        responseText = fallback;
      } else {
        const result = await opts.bridge.startCardSession({
          cardId: ev.cardId,
          conversationId: ev.conversationId,
          from: ev.from,
          pkg,
        });
        responseText = result.text;
      }
      await rateLimit.acquire();
      await opts.channel.send(ev.from, responseText);
    } catch (err) {
      onError(err, { event: ev });
    }
  };

  return {
    start(): void {
      if (unsubscribe !== null) return;
      unsubscribe = opts.channel.onMessage(handleInbound);
    },
    stop(): void {
      if (unsubscribe === null) return;
      unsubscribe();
      unsubscribe = null;
    },
  };
}
