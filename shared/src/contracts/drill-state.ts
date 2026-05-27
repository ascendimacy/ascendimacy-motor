/**
 * DrillState — estado per-aprendiz-per-item do subsistema B2.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md
 *
 * Atualizado por `recordAttempt` (motor-execucao/drill-repo).
 * Algoritmo SR em `shared/sr-algorithm.ts` (SM-2 simplificado).
 */

import { z } from "zod";
import { Iso8601DateTime } from "./iso8601.js";

export const DRILL_RESPONSES = [
  "correct",
  "incorrect",
  "timeout",
  "slow_correct",
] as const;
export const DrillResponseSchema = z.enum(DRILL_RESPONSES);
export type DrillResponse = z.infer<typeof DrillResponseSchema>;

export const DrillStateSchema = z.object({
  persona_id: z.string().min(1),
  item_id: z.string().min(1),
  presented_count: z.number().int().nonnegative(),
  correct_count: z.number().int().nonnegative(),
  last_seen_at: Iso8601DateTime,
  next_due_at: Iso8601DateTime,
  current_interval_days: z.number().nonnegative(),
  current_easiness: z.number().min(1.3),
  mastery_reached_at: Iso8601DateTime.nullable().optional(),
  last_5_attempts: z.array(DrillResponseSchema).max(5),
});
export type DrillState = z.infer<typeof DrillStateSchema>;

/** SM-2 default — easiness inicial pra item novo (sem histórico). */
export const DEFAULT_EASINESS = 2.5;
/** Mínimo absoluto do SM-2 — abaixo daqui, o item vira "leech" no Anki tradicional. */
export const MIN_EASINESS = 1.3;

/** Mastery threshold — 4 de 5 corretos. */
export const MASTERY_MIN_CORRECT = 4;
/** Janela considerada pra mastery — últimas 5 attempts. */
export const MASTERY_WINDOW_SIZE = 5;
/** Mastery só conta se item já passou ≥7 dias de intervalo. */
export const MASTERY_MIN_INTERVAL_DAYS = 7;
