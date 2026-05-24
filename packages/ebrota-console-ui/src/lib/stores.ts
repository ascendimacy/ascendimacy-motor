/**
 * Svelte stores — estado global da UI (BFF status, mode, sessão ativa,
 * chat bubbles).
 *
 * Pattern: stores writable simples; sync com BFF via polling no
 * App.svelte (toda ~2s pra /status). Reactive blocks Svelte propagam
 * mudanças automaticamente.
 */

import { writable } from "svelte/store";
import type { BffStatus, ChatBubble, ConsoleMode } from "./types.js";

/** Status do BFF (null = ainda não carregado / erro de conexão). */
export const bffStatus = writable<BffStatus | null>(null);

/** Modo console — mirror do BFF mode. Default 'auto'. */
export const consoleMode = writable<ConsoleMode>("auto");

/** Session ativa corrente (null = nenhuma sessão em foco). */
export const currentSessionId = writable<string | null>(null);

/** Chat bubbles da sessão ativa. Populado por SSE turn-state +
 *  startCardSession response (PR3 placeholder). */
export const chatBubbles = writable<ChatBubble[]>([]);

/** Erro global pra mostrar banner. Null = sem erro. */
export const globalError = writable<string | null>(null);
