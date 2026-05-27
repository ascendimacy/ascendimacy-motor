/**
 * TemporalWindow — janela temporal cultural por persona (B1).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b1-hooks-temporais-v0.md §schema
 *
 * Consumido por orchestrator/src/temporal-scheduler.ts. Janelas são
 * carregadas em fixtures YAML por persona (fixtures/temporal-windows/*.yaml).
 *
 * Princípio: o motor é proativo APENAS dentro de janelas explícitas; sleep
 * e school window são exclusões absolutas (never hook).
 */

import { z } from "zod";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const WEEKDAY_VALUES = WEEKDAYS;
export type Weekday = (typeof WEEKDAYS)[number];

export const TimeOfDaySchema = z
  .string()
  .regex(TIME_PATTERN, "must be HH:MM 24h local time");

export const TemporalWindowEntrySchema = z.object({
  name: z.string().min(1),
  weekday: z.array(z.enum(WEEKDAYS)).min(1),
  start_local: TimeOfDaySchema,
  end_local: TimeOfDaySchema,
  max_hooks_per_day: z.number().int().positive().default(1),
  requires_parental_ok: z.boolean(),
});

export const TemporalExclusionWindowSchema = z.object({
  start_local: TimeOfDaySchema,
  end_local: TimeOfDaySchema,
});

export const TemporalWindowSchema = z.object({
  persona_id: z.string().min(1),
  /** IANA timezone, ex.: "Asia/Tokyo", "America/Sao_Paulo". */
  timezone: z.string().min(1),
  windows: z.array(TemporalWindowEntrySchema),
  /** Nunca dispara dentro da sleep window (wrap-around aceito). */
  sleep_window: TemporalExclusionWindowSchema.optional(),
  /** Nunca dispara dentro da school window. */
  school_window: TemporalExclusionWindowSchema.optional(),
});

export type TemporalWindowEntry = z.infer<typeof TemporalWindowEntrySchema>;
export type TemporalExclusionWindow = z.infer<typeof TemporalExclusionWindowSchema>;
export type TemporalWindow = z.infer<typeof TemporalWindowSchema>;
