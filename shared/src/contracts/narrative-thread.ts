/**
 * NarrativeThread — "o que ficou em aberto" entre sessões (B1).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b1-hooks-temporais-v0.md §schema
 *
 * Persistido em motor-execucao/src/narrative-thread-repo.ts. Consumido
 * pelo trigger #2 do temporal-scheduler para gerar hook de retomada.
 *
 * Filosofia: continuidade narrativa é trigger, não conteúdo. O thread
 * marca "abertura"; o que o motor diz na retomada fica para S3 decidir.
 */

import { z } from "zod";
import { Iso8601DateTime } from "./iso8601.js";

export const NarrativeThreadStatusSchema = z.enum([
  "open",
  "resumed",
  "closed_natural",
  "closed_abandoned",
  "stale",
]);

export const NARRATIVE_THREAD_STATUSES = NarrativeThreadStatusSchema.options;
export type NarrativeThreadStatus = z.infer<typeof NarrativeThreadStatusSchema>;

export const NarrativeThreadSchema = z.object({
  /** ULID-like opaque string; gerado pelo repo no openThread. */
  id: z.string().min(1),
  persona_id: z.string().min(1),
  opened_in_session: z.string().min(1),
  opened_at: Iso8601DateTime,
  /** ≤200 chars — o que ficou em aberto, descritivo. */
  thread_text: z.string().min(1).max(200),
  /** virtude / CASEL dimension / helix axis — opcional. */
  axis: z.string().optional(),
  follow_up_triggered: z.boolean(),
  closed_at: Iso8601DateTime.optional(),
  status: NarrativeThreadStatusSchema,
  /** Quando vira stale se não tocou; default 7d após opened_at. */
  stale_after: Iso8601DateTime,
});

export type NarrativeThread = z.infer<typeof NarrativeThreadSchema>;
