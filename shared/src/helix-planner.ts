/**
 * Helix Planner — funções puras pra evolução do Double Helix
 * (DT-HELIX-01=A, Jun 27-abr).
 *
 * Todas as funções retornam novo HelixState — nunca mutam input.
 * Orchestrator chama essas funções no fim de cada turn/sessão e
 * persiste resultado via HelixRepo.save().
 *
 * Port: ebrota/playbooks/CLAUDE_6.MD §5 + spec
 * docs/specs/2026-04-22-double-helix-mapping.md §6 (H1-H8).
 */

import {
  CaselDim,
  CaselLevel,
  DEFAULT_CYCLE_DAYS,
  DEFAULT_ROTATION_ORDER,
  DeferredEntry,
  HelixState,
  MOOD_BUFFER_THRESHOLD,
  RETRIEVAL_GATE_PROGRESS,
} from "./helix-state.js";

/** ISO date (YYYY-MM-DD) de hoje em UTC. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Builda queue inicial a partir de `firstDim` seguindo DEFAULT_ROTATION_ORDER. */
function buildInitialQueue(firstDim: CaselDim): CaselDim[] {
  const idx = DEFAULT_ROTATION_ORDER.indexOf(firstDim);
  if (idx === -1) {
    // firstDim fora da rotação default: queue genérica (rest of order)
    return DEFAULT_ROTATION_ORDER.filter((d) => d !== firstDim);
  }
  return [
    ...DEFAULT_ROTATION_ORDER.slice(idx + 1),
    ...DEFAULT_ROTATION_ORDER.slice(0, idx),
  ];
}

/**
 * Inicializa HelixState pra um user novo.
 *
 * Default `firstDim = "SA"` (SelfAwareness, ponto de partida pedagógico
 * canônico). Queue construída via DEFAULT_ROTATION_ORDER a partir do firstDim.
 */
export function initHelix(
  userId: string,
  firstDim: CaselDim = "SA",
): HelixState {
  return {
    userId,
    activeDimension: firstDim,
    activeLevel: "emerging",
    progress: 0,
    cycleDay: 1,
    cycleStart: todayIso(),
    previousDimension: null,
    retrievalDone: false,
    estimatedCycleDays: DEFAULT_CYCLE_DAYS,
    queue: buildInitialQueue(firstDim),
    deferred: [],
    completed: [],
    vacationModeActive: false,
  };
}

/**
 * Avança progress do ciclo atual.
 *
 * Bloqueios:
 *   - vacationModeActive → no-op (modo férias)
 *   - mood ≤ MOOD_BUFFER_THRESHOLD (3) → no-op (CLAUDE_6 §5.3 buffer day)
 *
 * Clamp em [0, 1].
 */
export function advanceProgress(
  state: HelixState,
  delta: number,
  mood: number,
): HelixState {
  if (state.vacationModeActive) return state;
  if (mood <= MOOD_BUFFER_THRESHOLD) return state;
  const newProgress = Math.max(0, Math.min(1, state.progress + delta));
  return { ...state, progress: newProgress };
}

/**
 * Retorna par ativo do ciclo: dim atual + dim anterior (retrieval).
 *
 * `previous` só retorna se progress ≥ RETRIEVAL_GATE_PROGRESS (0.5);
 * caso contrário null. Permite ao caller saber se é momento de injetar
 * retrieval da dim anterior no prompt.
 */
export function getActivePair(state: HelixState): {
  active: CaselDim;
  previous: CaselDim | null;
} {
  return {
    active: state.activeDimension,
    previous:
      state.progress >= RETRIEVAL_GATE_PROGRESS
        ? state.previousDimension
        : null,
  };
}

/**
 * True se progress atingiu retrieval gate (≥ 0.5) E retrieval ainda não
 * foi marcada como done. Caller chama markRetrievalDone após primeira
 * sessão pós-gate.
 */
export function checkRetrievalGate(state: HelixState): boolean {
  return state.progress >= RETRIEVAL_GATE_PROGRESS && !state.retrievalDone;
}

/** Marca retrieval como done. Idempotente. */
export function markRetrievalDone(state: HelixState): HelixState {
  return { ...state, retrievalDone: true };
}

/**
 * True se progress atingiu boss fight gate (≥ 1.0) E activeDimension
 * ainda não está em completed (boss não foi feito).
 */
export function checkBossFight(state: HelixState): boolean {
  return (
    state.progress >= 1.0 && !state.completed.includes(state.activeDimension)
  );
}

/**
 * Avalia se par ativou no dia 7 do ciclo. Decisão guia próxima ação:
 *   - continue: par ativou conforme planejado, segue o ciclo
 *   - extend: ativação parcial — extende ciclo (dá mais tempo)
 *   - defer: nenhum sinal — defer dim, próximo da queue assume
 */
export function evaluatePairActivation(
  _state: HelixState,
  pairActivated: boolean,
  partialActivation: boolean,
): { decision: "continue" | "extend" | "defer"; reason: string } {
  if (pairActivated) {
    return { decision: "continue", reason: "par ativou conforme planejado" };
  }
  if (partialActivation) {
    return {
      decision: "extend",
      reason: "ativação parcial — extender ciclo pra mais tempo",
    };
  }
  return {
    decision: "defer",
    reason: "par não ativou — defer dim, próxima da queue assume",
  };
}

/**
 * Completa ciclo após boss fight bem-sucedido.
 * Rotação: active → completed[]; queue.shift() → nova active;
 * antiga active → previous; reset progress/cycleDay/retrievalDone.
 *
 * Edge case: queue vazia (todas dimensões já passaram). Mantém active
 * mas registra em completed e reseta ciclo (loop sobre dim mais recente).
 */
export function completeCycle(state: HelixState): HelixState {
  const completedNow = state.completed.includes(state.activeDimension)
    ? state.completed
    : [...state.completed, state.activeDimension];

  if (state.queue.length === 0) {
    return {
      ...state,
      activeLevel: nextLevel(state.activeLevel),
      progress: 0,
      cycleDay: 1,
      cycleStart: todayIso(),
      previousDimension: state.activeDimension,
      retrievalDone: false,
      completed: completedNow,
    };
  }

  const [nextActive, ...restQueue] = state.queue;
  return {
    ...state,
    activeDimension: nextActive!,
    activeLevel: "emerging",
    progress: 0,
    cycleDay: 1,
    cycleStart: todayIso(),
    previousDimension: state.activeDimension,
    retrievalDone: false,
    queue: restQueue,
    completed: completedNow,
  };
}

/**
 * Defere dimensão atual (par não ativou). Move pra deferred[],
 * próximo da queue assume como active. Reset progress.
 *
 * Edge case: queue vazia → registra deferred mas mantém active
 * (caller deve tratar como "fim de fila" e considerar entrar em férias).
 */
export function deferDimension(
  state: HelixState,
  reason: string,
  retryAfter: string,
): HelixState {
  const deferredEntry: DeferredEntry = {
    dimension: state.activeDimension,
    reason,
    retryAfter,
  };
  const deferredNow = [...state.deferred, deferredEntry];

  if (state.queue.length === 0) {
    return { ...state, deferred: deferredNow };
  }

  const [nextActive, ...restQueue] = state.queue;
  return {
    ...state,
    activeDimension: nextActive!,
    activeLevel: "emerging",
    progress: 0,
    cycleDay: 1,
    cycleStart: todayIso(),
    previousDimension: state.activeDimension,
    retrievalDone: false,
    queue: restQueue,
    deferred: deferredNow,
  };
}

/** Entra em modo férias — advance bloqueado até exitVacationMode. */
export function enterVacationMode(state: HelixState): HelixState {
  return { ...state, vacationModeActive: true };
}

/** Sai de modo férias — advance volta a funcionar. */
export function exitVacationMode(state: HelixState): HelixState {
  return { ...state, vacationModeActive: false };
}

/** Próximo nível Dreyfus na escala. mastering → mastering (cap). */
function nextLevel(current: CaselLevel): CaselLevel {
  const order: CaselLevel[] = [
    "emerging",
    "developing",
    "demonstrating",
    "mastering",
  ];
  const idx = order.indexOf(current);
  if (idx === -1 || idx === order.length - 1) return current;
  return order[idx + 1]!;
}
