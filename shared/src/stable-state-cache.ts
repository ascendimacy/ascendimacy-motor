/**
 * Stable State Cache — campos cacheados por sessão pra alimentar
 * Unified Assessor sem recalcular tudo a cada turn.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-28-motor-simplificacao-llm-spec-v1.md §3.6
 *
 * Distinção:
 *   - StableStateFields: recalculados UMA VEZ por sessão (ou via evento explícito)
 *   - VolatileStateFields: recalculados a cada turn pelo Unified Assessor
 *
 * Invalidação de stable: operador online/offline, transição status_matrix,
 * fim de sessão. Não a cada turn.
 *
 * DT-SIM-02 (Jun, 28-abr): VoiceProfile ainda não existe como tipo canônico
 * em shared/. Usa stub `Record<string, unknown>` aqui; refina quando voice
 * profiles entrarem como tipo formal.
 */

import type { HelixState } from "./helix-state.js";
import type { StatusMatrix } from "./status-matrix.js";
import type { SemanticSignal } from "./semantic-signals.js";

/** Jurisdição ativa do sujeito (afeta jurisdiction_respect). */
export type Jurisdiction = "br" | "jp" | "ch";

/** Engajamento derivado dos signals + mood. */
export type EngagementLevel = "high" | "medium" | "low" | "disengaging";

/**
 * Campos estáveis — recalculados UMA VEZ por sessão.
 * Invalidação só via evento explícito (transição, operador, fim de sessão).
 */
export interface StableStateFields {
  /** ID canônico do sujeito (cross-session via motor#47). */
  child_id: string;
  /** 0.0-1.0 — derivado do trust-calculator.ts. */
  trust_level: number;
  /** Jurisdição ativa pra constraints de materialização. */
  jurisdiction_active: Jurisdiction;
  /** Flags de modificadores (futoko, incident, crisis_flag, etc.). */
  modifier_flags: string[];
  /** Operador humano disponível pra escalation. */
  operator_online: boolean;
  /**
   * Voice profile do sujeito (cascade: ClientVoiceProfile → CulturalDefault
   * → Universal). Estrutura formal pendente (DT-SIM-02). Stub Record por enquanto.
   */
  voice_profile: Record<string, unknown>;
  /** Estado do Double Helix (atualiza só no fim da sessão). */
  helix_state: HelixState;
  /** Status matrix brejo/baia/pasto (atualiza só via transição detectada). */
  status_matrix: StatusMatrix;
  /** Timestamp do início da sessão (epoch ms). */
  stable_computed_at: number;
}

/**
 * Campos voláteis — recalculados a cada turn pelo Unified Assessor.
 */
export interface VolatileStateFields {
  /** Mood absoluto 1-10 (do AssessmentResult). */
  mood: number;
  /** Últimos 3 valores de mood pra detectar drift. */
  mood_window: number[];
  /** Engajamento derivado dos signals. */
  engagement: EngagementLevel;
  /** Signals do turn atual (capturados pelo Unified Assessor). */
  signals_last_turn: SemanticSignal[];
  /** Budget restante (decrementado pelo Pragmatic Selector). */
  budget_remaining: number;
  /** Contador do turn atual na sessão. */
  turn_count: number;
}

/**
 * Cache em memória de StableStateFields por child_id.
 *
 * Nao thread-safe — assume single-process. Cada chamada
 * createStableStateCache() cria store independente (isolamento em tests).
 */
export interface StableStateCache {
  /** Lê campos estáveis pro child. Retorna null se não cacheado. */
  get(childId: string): StableStateFields | null;
  /** Persiste campos estáveis (cria ou atualiza). */
  set(childId: string, fields: StableStateFields): void;
  /** Invalida cache pro child (transição detectada, fim de sessão). */
  invalidate(childId: string): void;
  /** Invalida cache inteiro (debug, restart). */
  invalidateAll(): void;
  /** Retorna idade do cache em ms (Date.now() - stable_computed_at). */
  age(childId: string): number | null;
}

/**
 * Cria instância nova do cache. Map em memória; cada chamada cria store
 * independente (útil em tests pra isolamento).
 */
export function createStableStateCache(): StableStateCache {
  const store = new Map<string, StableStateFields>();

  return {
    get(childId: string): StableStateFields | null {
      return store.get(childId) ?? null;
    },
    set(childId: string, fields: StableStateFields): void {
      store.set(childId, fields);
    },
    invalidate(childId: string): void {
      store.delete(childId);
    },
    invalidateAll(): void {
      store.clear();
    },
    age(childId: string): number | null {
      const fields = store.get(childId);
      if (!fields) return null;
      return Date.now() - fields.stable_computed_at;
    },
  };
}
