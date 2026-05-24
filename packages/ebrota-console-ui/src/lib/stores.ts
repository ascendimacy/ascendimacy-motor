/**
 * Svelte stores — estado global da UI (BFF status, mode, sessão ativa,
 * chat bubbles, turn snapshot, content pool).
 *
 * Pattern: stores writable simples; sync com BFF via polling no
 * App.svelte (~2s pra /status; ~250ms pra listOptions; SSE pra
 * turn-state). Reactive blocks Svelte propagam mudanças automaticamente.
 */

import { writable } from "svelte/store";
import type {
  BffStatus,
  ChatBubble,
  ConsoleMode,
  TurnSnapshot,
} from "./types.js";
import type { ScoredContentItemSummary } from "./api.js";

/** Status do BFF (null = ainda não carregado / erro de conexão). */
export const bffStatus = writable<BffStatus | null>(null);

/** Modo console — mirror do BFF mode. Default 'auto'. */
export const consoleMode = writable<ConsoleMode>("auto");

/** Session ativa corrente (null = nenhuma sessão em foco). */
export const currentSessionId = writable<string | null>(null);

/** Chat bubbles da sessão ativa. Populado por SSE turn-state +
 *  startCardSession response (PR3 placeholder). */
export const chatBubbles = writable<ChatBubble[]>([]);

/** Snapshot agregado do turn corrente — derivado de TurnStateEvents
 *  via reducer `applyTurnEvent`. Null = sem turn ativo. */
export const currentTurnSnapshot = writable<TurnSnapshot | null>(null);

/** Content pool corrente (sob gate ativo em semi-auto). Vazio em auto
 *  mode ou fora de gate. Polled via listOptions endpoint. */
export const currentContentPool = writable<ScoredContentItemSummary[]>(
  [],
);

/** Erro global pra mostrar banner. Null = sem erro. */
export const globalError = writable<string | null>(null);

/** Pending approval — populated by polling /pending-approval em
 *  semi-auto mode. Null = sem pendência. */
export const pendingApproval = writable<{ proposedText: string } | null>(
  null,
);

/** Sidebar Histórico aberto? */
export const libraryOpen = writable<boolean>(false);

/** Replay modal open com qual sessionId. Null = fechado. */
export const replaySessionId = writable<string | null>(null);
