/**
 * EmergentPlaybook v0 — physical world challenge playbook composto pelo
 * Strategist a partir de inventário + axes + objetivos (não hardcoded).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-30-physical-world-challenge-piloto-bolo-v0.md
 *
 * v0 scope: tipos + zod schemas. Composer roda em planejador/src/strategist/
 * (módulo separado). NÃO integrado ao pipeline do motor ainda — instalado
 * como ferramenta isolada pra validar shape antes de wire-up downstream.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// SubjectInventory — o que o sujeito tem disponível AGORA
// ─────────────────────────────────────────────────────────────────────────

export const SubjectInventorySchema = z.object({
  collected_at: z.string(),
  available_materials: z.array(z.string()),
  available_time_minutes: z.number().int().nonnegative(),
  available_budget_cents: z.number().int().nonnegative(),
  family_present: z.array(z.string()),
  aspirational_wishlist: z.array(z.string()),
  /** 0=guess; 1=baixa; 2=média; 3=confirmada por pai/sujeito */
  confidence: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});
export type SubjectInventory = z.infer<typeof SubjectInventorySchema>;

// ─────────────────────────────────────────────────────────────────────────
// EmergentVirtueTarget — virtude/axis sendo treinada
//
// Diferente do `TargetDemonstration` do strategy-plan.ts (que carrega
// framework/dimension/goal/rationale para Strategist plan composition em
// applied_double_helix). Aqui é forma simplificada {axis, virtue} pro LLM
// composer encher fácil em saída JSON.
// ─────────────────────────────────────────────────────────────────────────

export const EmergentVirtueTargetSchema = z.object({
  axis: z.string(),
  virtue: z.string(),
});
export type EmergentVirtueTarget = z.infer<typeof EmergentVirtueTargetSchema>;

// ─────────────────────────────────────────────────────────────────────────
// PlaybookStep — etapa executável
// ─────────────────────────────────────────────────────────────────────────

export const PlaybookStepKindSchema = z.union([
  z.literal("shopping_list"),
  z.literal("execute_recipe_step"),
  z.literal("wait"),
  z.literal("reflect"),
]);
export type PlaybookStepKind = z.infer<typeof PlaybookStepKindSchema>;

export const EvidenceKindSchema = z.union([
  z.literal("photo"),
  z.literal("voice_memo"),
  z.literal("text_answer"),
  z.literal("parent_confirmation"),
  z.literal("none"),
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const PlaybookStepSchema = z.object({
  step_id: z.string(),
  kind: PlaybookStepKindSchema,
  hint_to_subject: z.string(),
  evidence_kind: EvidenceKindSchema,
  expected_duration_minutes: z.number().int().nonnegative(),
  fallback_hint: z.string().optional(),
});
export type PlaybookStep = z.infer<typeof PlaybookStepSchema>;

// ─────────────────────────────────────────────────────────────────────────
// PhilosophicalDilemma — camada de virtude opcional por step
// ─────────────────────────────────────────────────────────────────────────

export const DilemmaTriggerSchema = z.union([
  z.literal("step_complete"),
  z.literal("step_midway"),
  z.literal("evidence_received"),
]);
export type DilemmaTrigger = z.infer<typeof DilemmaTriggerSchema>;

export const DilemmaEvaluationFocusSchema = z.union([
  z.literal("raciocinio"),
  z.literal("consistencia_com_valor_declarado"),
  z.literal("consideracao_do_outro"),
]);
export type DilemmaEvaluationFocus = z.infer<typeof DilemmaEvaluationFocusSchema>;

export const PhilosophicalDilemmaSchema = z.object({
  dilemma_id: z.string(),
  attached_to_step: z.string(),
  trigger: DilemmaTriggerSchema,
  virtue_tested: z.string(),
  prompt: z.string(),
  evaluation_focus: DilemmaEvaluationFocusSchema,
});
export type PhilosophicalDilemma = z.infer<typeof PhilosophicalDilemmaSchema>;

// ─────────────────────────────────────────────────────────────────────────
// EmergentPlaybook — saída completa do composer
// ─────────────────────────────────────────────────────────────────────────

export const EmergentPlaybookSchema = z.object({
  playbook_id: z.string(),
  composed_at: z.string(),
  source_inventory: SubjectInventorySchema,
  primary_objective: EmergentVirtueTargetSchema,
  secondary_objectives: z.array(EmergentVirtueTargetSchema),
  steps: z.array(PlaybookStepSchema).min(1),
  total_duration_minutes: z.number().int().nonnegative(),
  budget_range_cents: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }),
  philosophical_dilemmas: z.array(PhilosophicalDilemmaSchema),
  composition_rationale: z.string(),
});
export type EmergentPlaybook = z.infer<typeof EmergentPlaybookSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Composer input — o que o Strategist recebe pra compor
// ─────────────────────────────────────────────────────────────────────────

export interface PlaybookComposerInput {
  inventory: SubjectInventory;
  /** Axes ativos no Subject Knowledge (Gardner numbering ou nome). */
  active_axes: readonly string[];
  /** Objetivos correntes vindos do Console parental ou Gardner. */
  current_objectives: readonly EmergentVirtueTarget[];
  /** IDs de playbooks anteriores — anti-repetição. */
  previous_playbook_ids?: readonly string[];
  /** Nome do sujeito pra contexto humano nos prompts. */
  subject_name: string;
  /** Idade pra calibrar dilemas. */
  subject_age?: number;
  /** run_id pra trace correlation. */
  run_id?: string;
}
