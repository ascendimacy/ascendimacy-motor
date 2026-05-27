/**
 * TacticDecision — contrato intermediário entre Tactician e Speaker
 * dentro do Motor Drota (S4).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-s4-separacao-decide-gera-v0.md
 *
 * Filosofia: separa "decidir a jogada" (Tactician) de "executar em fala"
 * (Speaker). Tactician produz JSON estruturado, auditável, replayável.
 * Speaker recebe TacticDecision e materializa o texto final.
 *
 * Vocabulário de jogadas alinhado com `ScoredContentItem.isaLabels.played_as`
 * (motor-drota/content-item.ts) e com o catálogo de jogadas de C-T-10.
 */

import { z } from "zod";

export const JOGADA_VALUES = [
  "bridge",
  "espelho",
  "canal",
  "diamante",
  "arena",
  "recovery",
] as const;

export const JogadaSchema = z.enum(JOGADA_VALUES);
export type Jogada = z.infer<typeof JogadaSchema>;

export const RegisterSchema = z.enum([
  "neutro",
  "lúdico",
  "firme",
  "acolhedor",
]);
export type Register = z.infer<typeof RegisterSchema>;

export const TacticDecisionConstraintsSchema = z.object({
  /** Tópicos/tons forbidden. Pode incluir entries do contextHints.avoid. */
  avoid: z.array(z.string()),
  /** Anchor obrigatório (fact/keyword) que o Speaker DEVE incluir. */
  must_include: z.string().optional(),
  /** Tom geral da fala — varia por mood/engagement. */
  register: RegisterSchema,
  /** Cap conservador no comprimento de saída do Speaker. */
  max_length_chars: z.number().int().positive().optional(),
});

export const TacticDecisionSchema = z.object({
  jogada: JogadaSchema,
  /** ID do ScoredContentItem escolhido do contentPool. */
  selected_item_id: z.string().min(1),
  /** Virtude / CASEL dim / helix axis em foco — opcional. */
  target_axis: z.string().optional(),
  /** ≤80 chars: como o Speaker entra; "ponto de entrada" verbal. */
  angle: z.string().max(80),
  constraints: TacticDecisionConstraintsSchema,
  /** ≤140 chars: por que essa jogada agora (auditabilidade). */
  rationale: z.string().max(140),
  /** Jogada fallback caso Speaker falhe (parse/Zod). */
  fallback_jogada: JogadaSchema.optional(),
});

export type TacticDecision = z.infer<typeof TacticDecisionSchema>;
export type TacticDecisionConstraints = z.infer<
  typeof TacticDecisionConstraintsSchema
>;

/** Parse seguro — retorna null em vez de lançar. */
export function parseTacticDecision(raw: unknown): TacticDecision | null {
  const result = TacticDecisionSchema.safeParse(raw);
  return result.success ? result.data : null;
}
