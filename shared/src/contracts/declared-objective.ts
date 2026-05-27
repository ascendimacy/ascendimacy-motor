/**
 * DeclaredObjective — promessa datada do aprendiz consigo mesmo.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-s1-objetivos-declarados-v0.md
 *
 * Conceito: o motor não dita objetivos; recebe-os via captura conversacional,
 * lembra deles, e periodicamente verifica drift. Persistência é append-only —
 * mudanças de status criam nova versão linkada via `parent_objective_id`.
 *
 * Sem `target_date` não é objetivo: é desejo.
 */

import { z } from "zod";
import { Iso8601DateTime } from "./iso8601.js";

export const DeclaredObjectiveStatusSchema = z.enum([
  "active",
  "achieved",
  "abandoned",
  "drift_flagged",
  "revised",
]);

export const DECLARED_OBJECTIVE_STATUSES = DeclaredObjectiveStatusSchema.options;
export type DeclaredObjectiveStatus = z.infer<typeof DeclaredObjectiveStatusSchema>;

export const DeclaredObjectiveSchema = z.object({
  id: z.string().min(1),
  persona_id: z.string().min(1),
  declared_at: Iso8601DateTime,
  declared_in_session: z.string().min(1),
  target_date: Iso8601DateTime,
  statement: z.string().min(1).max(200),
  axis: z.string().optional(),
  status: DeclaredObjectiveStatusSchema,
  parent_objective_id: z.string().optional(),
  evidence_event_ids: z.array(z.string()).optional(),
  drift_check_due_at: Iso8601DateTime.optional(),
});

export type DeclaredObjective = z.infer<typeof DeclaredObjectiveSchema>;

export const DeclaredObjectiveDraftSchema = DeclaredObjectiveSchema.omit({
  id: true,
  status: true,
}).extend({
  axis: z.string().optional(),
  evidence_event_ids: z.array(z.string()).optional(),
  drift_check_due_at: Iso8601DateTime.optional(),
});

export type DeclaredObjectiveDraft = z.infer<typeof DeclaredObjectiveDraftSchema>;
