/**
 * Ring buffer in-memory + helpers pra LLM call events — S-OC-24/25/29
 * (Fase G parcial / tail mode).
 *
 * shared/gateway-client.ts (consumer) emite events via POST quando
 * `ASC_LLM_DEBUG_MODE=true`. PR8 entrega a infraestrutura no BFF; o
 * hook real em gateway-client é PR follow-up (shared workspace é
 * mais invasivo).
 *
 * V0.1 = tail-only (Q11 ratificado): emit + UI mostra. Sem pausa,
 * sem gate. Gate mode (pausa pra Jun aprovar cada call) fica V0.2.
 *
 * Memória apenas — prompts NÃO persistem em SQLite por default
 * (D-OC-13 LGPD). Telemetry de actions agregadas em debug_actions
 * (sem prompt content).
 */

import type { Database as DatabaseType } from "better-sqlite3";

/** Provider conhecido — usado pra colorir badge no UI. */
export type LlmProvider = "anthropic" | "infomaniak" | "local" | "unknown";

export interface LlmCallEventPayload {
  /** Step pedagógico (assessor, planejador, drota, etc.) */
  step: string;
  provider: LlmProvider;
  model: string;
  /** Prompt como objeto estruturado — system/user/assistant prefill etc. */
  prompt: {
    system?: string;
    user?: string;
    assistantPrefill?: string;
    /** Texto raw pra display rápida quando structure não está disponível. */
    raw?: string;
  };
  params?: {
    temperature?: number;
    maxTokens?: number;
    [key: string]: unknown;
  };
  /** sessionId que originou a call (se disponível). */
  sessionId?: string;
  /** Turn number da sessão. */
  turn?: number;
}

export interface LlmCallEvent extends LlmCallEventPayload {
  /** Index sequencial (monotônico) — caller passa `sinceId` pra paginar. */
  id: number;
  /** ISO 8601 — quando BFF recebeu. */
  receivedAt: string;
}

export const DEBUG_EVENTS_BUFFER_CAP = 200;

export interface DebugEventsStore {
  /** Adiciona event ao buffer. Cap respeitado (FIFO eviction). */
  push(payload: LlmCallEventPayload): LlmCallEvent;
  /** Pega events com id > sinceId. */
  since(sinceId: number): LlmCallEvent[];
  /** Snapshot completo (top latest, capped). */
  snapshot(): LlmCallEvent[];
  /** Limpa buffer. */
  clear(): void;
  /** Total emitido desde init (não cap-bounded). */
  totalEmitted(): number;
}

export function createDebugEventsStore(opts: {
  /** Override clock pra testes. */
  now?: () => string;
  /** Cap override. Default DEBUG_EVENTS_BUFFER_CAP. */
  cap?: number;
} = {}): DebugEventsStore {
  const now = opts.now ?? (() => new Date().toISOString());
  const cap = opts.cap ?? DEBUG_EVENTS_BUFFER_CAP;
  let buffer: LlmCallEvent[] = [];
  let nextId = 1;
  let total = 0;

  return {
    push(payload) {
      const event: LlmCallEvent = {
        id: nextId++,
        receivedAt: now(),
        ...payload,
      };
      buffer.push(event);
      total += 1;
      if (buffer.length > cap) {
        buffer = buffer.slice(-cap);
      }
      return event;
    },
    since(sinceId) {
      return buffer.filter((e) => e.id > sinceId);
    },
    snapshot() {
      return [...buffer];
    },
    clear() {
      buffer = [];
    },
    totalEmitted() {
      return total;
    },
  };
}

/** Telemetry de actions debug (S-OC-29) — agregada, SEM prompt content
 *  (LGPD; prompts ficam só em memória). Caller pode logar
 *  approve/edit/cancel/swap actions em debug_actions table. */
export interface RecordDebugActionInput {
  sessionId: string;
  llmCallId?: string;
  action: "tail" | "approve" | "edit" | "cancel" | "swap" | "bypass";
  /** SHA-256 ou similar (não plaintext). */
  originalPromptHash?: string;
  editedPromptHash?: string;
  swapTo?: string;
  rationale?: string;
}

export function recordDebugAction(
  db: DatabaseType,
  input: RecordDebugActionInput,
  now: () => string = () => new Date().toISOString(),
): { id: number } | { error: string } {
  try {
    const stmt = db.prepare(`
      INSERT INTO debug_actions (
        session_id, llm_call_id, action, original_prompt_hash,
        edited_prompt_hash, swap_to, rationale, recorded_at
      ) VALUES (
        @sessionId, @llmCallId, @action, @originalPromptHash,
        @editedPromptHash, @swapTo, @rationale, @recordedAt
      )
    `);
    const result = stmt.run({
      sessionId: input.sessionId,
      llmCallId: input.llmCallId ?? null,
      action: input.action,
      originalPromptHash: input.originalPromptHash ?? null,
      editedPromptHash: input.editedPromptHash ?? null,
      swapTo: input.swapTo ?? null,
      rationale: input.rationale ?? null,
      recordedAt: now(),
    });
    return { id: Number(result.lastInsertRowid) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
