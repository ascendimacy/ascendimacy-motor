/**
 * LearnerSummary — contrato unificado de leitura do estado do aprendiz.
 *
 * S1.read({ persona }) agrega 3 fontes (kids_casel_history,
 * kids_tree_nodes, kids_helix_state) e retorna este shape com cache TTL 60s.
 *
 * Spec: ascendimacy-ops#1150. Decisões aplicadas:
 *  - D-P41-01: TTL = 60s
 *  - D-P41-02: cache em memória (in-process Map)
 */

import { z } from "zod";

export const LearnerSummarySchema = z.object({
  persona: z.string().min(1),
  casel_levels: z.record(z.string(), z.number()),
  tree_zones: z.array(z.string()),
  helix_position: z.string().nullable(),
  last_session: z.string().nullable(),
  cached_at: z.number(),
});

export type LearnerSummary = z.infer<typeof LearnerSummarySchema>;
