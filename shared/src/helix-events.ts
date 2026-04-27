/**
 * Helix Events — emitters pra debug-logger (events.ndjson).
 *
 * Cada função recebe o HelixState relevante e loga evento estruturado
 * com snapshot do estado pós-mudança. Step strings seguem convenção
 * "helix.<event>" — namespace separado de LLM steps (planejador, drota,
 * etc.) e de execução (execute_playbook, etc.).
 *
 * Eventos são no-op quando ASC_DEBUG_MODE off (debug-logger faz check
 * internamente).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-22-double-helix-mapping.md
 *   §8.2 (event_log): helix.cycle.started, helix.retrieval.triggered,
 *   helix.boss.completed, helix.cycle.completed, helix.pair.deferred.
 */

import { logDebugEvent } from "./debug-logger.js";
import type { CaselDim, HelixState } from "./helix-state.js";

/** Emitted quando ciclo novo começa (initHelix ou completeCycle). */
export function emitHelixCycleStarted(state: HelixState): void {
  logDebugEvent({
    side: "motor",
    step: "helix.cycle.started",
    user_id: state.userId,
    motor_target: "kids",
    outcome: "ok",
    snapshots_post: {
      helix: {
        active_dimension: state.activeDimension,
        active_level: state.activeLevel,
        cycle_start: state.cycleStart,
        queue: state.queue,
        previous_dimension: state.previousDimension,
      },
    },
  });
}

/** Emitted quando retrieval gate ativa (progress ≥ 0.5 + !retrievalDone). */
export function emitRetrievalTriggered(
  state: HelixState,
  previous: CaselDim,
): void {
  logDebugEvent({
    side: "motor",
    step: "helix.retrieval.triggered",
    user_id: state.userId,
    motor_target: "kids",
    outcome: "ok",
    snapshots_post: {
      helix: {
        active_dimension: state.activeDimension,
        previous_dimension: previous,
        progress: state.progress,
      },
    },
  });
}

/** Emitted quando boss fight é concluído (após completeCycle). */
export function emitBossCompleted(
  state: HelixState,
  bossDimension: CaselDim,
): void {
  logDebugEvent({
    side: "motor",
    step: "helix.boss.completed",
    user_id: state.userId,
    motor_target: "kids",
    outcome: "ok",
    snapshots_post: {
      helix: {
        boss_dimension: bossDimension,
        previous_dimension: state.previousDimension,
        completed_count: state.completed.length,
      },
    },
  });
}

/** Emitted após completeCycle (ciclo encerrou, novo começou ou loop). */
export function emitCycleCompleted(state: HelixState): void {
  logDebugEvent({
    side: "motor",
    step: "helix.cycle.completed",
    user_id: state.userId,
    motor_target: "kids",
    outcome: "ok",
    snapshots_post: {
      helix: {
        new_active: state.activeDimension,
        new_level: state.activeLevel,
        completed: state.completed,
        queue_remaining: state.queue.length,
      },
    },
  });
}

/** Emitted quando dim é deferida (par não ativou). */
export function emitPairDeferred(
  state: HelixState,
  deferredDim: CaselDim,
  reason: string,
): void {
  logDebugEvent({
    side: "motor",
    step: "helix.pair.deferred",
    user_id: state.userId,
    motor_target: "kids",
    outcome: "ok",
    snapshots_post: {
      helix: {
        deferred_dimension: deferredDim,
        reason,
        new_active: state.activeDimension,
        deferred_count: state.deferred.length,
      },
    },
  });
}
