/**
 * Subscription manager — conecta SSE turn-state stream do BFF ao
 * `currentTurnSnapshot` store. Lifecycle reactive a `currentSessionId`
 * change: abre nova conexão quando session inicia, fecha quando muda
 * ou esvazia.
 *
 * Também alimenta `chatBubbles` quando `materialization_ready` chega —
 * substitui bubble bot placeholder com texto materializado real.
 */

import type { ApiClient } from "./api.js";
import { subscribeTurnState } from "./api.js";
import {
  chatBubbles,
  currentSessionId,
  currentTurnSnapshot,
  globalError,
} from "./stores.js";
import { applyTurnEvent, type ChatBubble } from "./types.js";

export interface TurnStateStreamManager {
  /** Para o subscriber corrente. Idempotente. */
  stop(): void;
}

export function startTurnStateStream(
  api: ApiClient,
): TurnStateStreamManager {
  let closeFn: (() => void) | null = null;
  let lastSessionId: string | null = null;

  // Reactive: quando currentSessionId muda, fecha conexão anterior +
  // abre nova (se newSessionId não-null).
  const unsubscribe = currentSessionId.subscribe((sessionId) => {
    if (sessionId === lastSessionId) return;
    lastSessionId = sessionId;
    if (closeFn !== null) {
      closeFn();
      closeFn = null;
    }
    if (sessionId === null) {
      currentTurnSnapshot.set(null);
      return;
    }
    // Reset snapshot pra nova sessão
    currentTurnSnapshot.set(null);
    closeFn = subscribeTurnState(
      api,
      sessionId,
      (ev) => {
        currentTurnSnapshot.update((prev) => applyTurnEvent(prev, ev));
        // materialization_ready substitui bubble bot placeholder
        if (ev.type === "materialization_ready") {
          chatBubbles.update((bubbles) =>
            replaceBotBubble(bubbles, sessionId, ev.payload.proposedText),
          );
        }
      },
      (err) => {
        globalError.set(`SSE turn-state error: ${String(err)}`);
      },
    );
  });

  return {
    stop(): void {
      if (closeFn !== null) {
        closeFn();
        closeFn = null;
      }
      unsubscribe();
    },
  };
}

const replaceBotBubble = (
  bubbles: ChatBubble[],
  sessionId: string,
  proposedText: string,
): ChatBubble[] => {
  // Encontra última bubble bot da sessão e substitui text (se diferente).
  // Se não existe, append.
  const idx = [...bubbles]
    .reverse()
    .findIndex((b) => b.role === "bot" && b.id.startsWith(sessionId));
  if (idx === -1) {
    return [
      ...bubbles,
      {
        id: `${sessionId}-bot-${Date.now()}`,
        role: "bot",
        text: proposedText,
        timestamp: new Date().toISOString(),
      },
    ];
  }
  const realIdx = bubbles.length - 1 - idx;
  if (bubbles[realIdx]!.text === proposedText) return bubbles;
  return bubbles.map((b, i) =>
    i === realIdx ? { ...b, text: proposedText } : b,
  );
};
