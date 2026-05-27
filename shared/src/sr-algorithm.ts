/**
 * SM-2 simplificado — algoritmo SR para B2 (Drilling).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md §"Algoritmo SR"
 *
 * Battle-tested (Anki/SuperMemo), implementação <80 LOC, sem training data
 * (vs FSRS). Mastery = janela 5 attempts com 4 corretos + intervalo ≥7d.
 */

import {
  MIN_EASINESS,
  MASTERY_MIN_CORRECT,
  MASTERY_MIN_INTERVAL_DAYS,
  MASTERY_WINDOW_SIZE,
  type DrillResponse,
  type DrillState,
} from "./contracts/drill-state.js";

export type SrResponse = "correct" | "incorrect" | "slow_correct";

export interface SrResult {
  next_interval_days: number;
  next_easiness: number;
}

/**
 * Calcula próximo intervalo + easiness dado o estado atual e a resposta.
 *
 * - `incorrect`: reset interval=1d, easiness -= 0.2 (floor MIN_EASINESS).
 * - `correct` (q=5): easiness += 0.1; interval cresce 0→1→3→round(prev*ef).
 * - `slow_correct` (q=3): easiness levemente cai; interval cresce.
 */
export function nextInterval(
  state: Pick<DrillState, "current_interval_days" | "current_easiness">,
  response: SrResponse,
): SrResult {
  if (response === "incorrect") {
    return {
      next_interval_days: 1,
      next_easiness: Math.max(MIN_EASINESS, state.current_easiness - 0.2),
    };
  }
  const q = response === "correct" ? 5 : 3;
  const ef = Math.max(
    MIN_EASINESS,
    state.current_easiness + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
  );
  const next =
    state.current_interval_days === 0
      ? 1
      : state.current_interval_days === 1
        ? 3
        : Math.round(state.current_interval_days * ef);
  return { next_interval_days: next, next_easiness: ef };
}

/**
 * Mastery = evento, não estado. True quando a janela das últimas 5 attempts
 * contém ≥4 corretas E o intervalo atual já é ≥7d (descarta acertos rasos).
 */
export function isMastered(
  state: Pick<DrillState, "last_5_attempts" | "current_interval_days">,
): boolean {
  if (state.last_5_attempts.length < MASTERY_WINDOW_SIZE) return false;
  const correctCount = state.last_5_attempts.filter(
    (a: DrillResponse) => a === "correct" || a === "slow_correct",
  ).length;
  if (correctCount < MASTERY_MIN_CORRECT) return false;
  if (state.current_interval_days < MASTERY_MIN_INTERVAL_DAYS) return false;
  return true;
}
