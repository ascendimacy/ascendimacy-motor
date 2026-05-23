/**
 * Router de mensagens inbound — S-MX-06-05 (ops#1115).
 *
 * Função pura sem dependências Baileys/IO. Toma um InboundMessage e devolve
 * a lista de eventos a emitir. PR2 implementa apenas o detector `^card:<id>$`.
 * Outros prefixes (`/start`, slash commands) ficam como hooks extensíveis em
 * iterações futuras — fora de escopo aqui.
 */

import type {
  CardActivatedEvent,
  ChannelEvent,
  InboundMessage,
  MessageReceivedEvent,
} from "./types.js";

/**
 * Detector de carta-acionada. Strict, case-sensitive, sem multi-line.
 * Casa exclusivamente `card:<cardId>` onde cardId ∈ [a-z0-9-]+, e a string
 * inteira é exatamente esse formato (sem leading/trailing whitespace, sem
 * conteúdo extra).
 */
export const CARD_ACTIVATION_REGEX = /^card:([a-z0-9-]+)$/;

/**
 * Roteia uma mensagem inbound em zero ou mais eventos.
 *
 * Contrato:
 * - SEMPRE emite `MessageReceived` (uma vez por inbound).
 * - Se o texto casar com `CARD_ACTIVATION_REGEX`, emite também
 *   `CardActivated` ANTES de `MessageReceived` (consumidores de carta-acionada
 *   tipicamente processam primeiro).
 *
 * A decisão de sempre emitir `MessageReceived` segue a "Interface MCP
 * proposta" da ops#1115 §events, onde `MessageReceived` é canal genérico
 * independente do detector. Orchestrator decide se ignora quando
 * `CardActivated` precedente já encaminhou.
 */
export function routeInbound(msg: InboundMessage): ChannelEvent[] {
  const events: ChannelEvent[] = [];

  const cardMatch = CARD_ACTIVATION_REGEX.exec(msg.text);
  if (cardMatch) {
    const cardId = cardMatch[1]!;
    const activated: CardActivatedEvent = {
      type: "CardActivated",
      cardId,
      from: msg.from,
      conversationId: msg.conversationId,
      timestamp: msg.timestamp,
      raw: msg.text,
    };
    events.push(activated);
  }

  const received: MessageReceivedEvent = {
    type: "MessageReceived",
    from: msg.from,
    text: msg.text,
    conversationId: msg.conversationId,
    timestamp: msg.timestamp,
  };
  events.push(received);

  return events;
}
