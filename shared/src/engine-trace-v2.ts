/**
 * Engine Trace v2 — full engine telemetry per turn.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-trace-v2-full-engine-telemetry.md
 *
 * Convive AO LADO de `motorTrace` v1 (não substitui) — caller injeta
 * `turn.engineTrace` no trace.json STS. Replay UI v2 consome v2 quando
 * presente, com fallback graceful pra v1 quando ausente.
 *
 * Princípios:
 *   1. Captura na fronteira do componente — cada writer/selector retorna sua seção
 *   2. LLM calls catalogados num array flat (cross-component); seções por
 *      componente referenciam via `llm_call_ref`
 *   3. Backward 100% — todos os campos por turn opcionais; ausência ≠ erro
 *   4. Privacy via env `MOTOR_TRACE_REDACT_PII` (default false em dev)
 *
 * Sub-fase TV2-1: tipos + Zod. Writers + UI consumer entram em TV2-2+.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// State snapshots — pre/post-turn read-only views dos repos do motor
// ─────────────────────────────────────────────────────────────────────────

export const JourneyStateSnapshotSchema = z.object({
  stage: z.string(),
  discoveries_count: z.number().int().nonnegative(),
  families_covered: z.array(z.string()),
});

export const HelixStateSnapshotSchema = z.object({
  activeDimension: z.string(),
  activeLevel: z.number().int().nonnegative(),
  cycleDay: z.number().int().nonnegative(),
  progress: z.number().min(0).max(1),
});

export const SubjectProposedSnapshotSchema = z.object({
  version: z.number().int().nonnegative(),
  axes_active: z.array(z.number().int()),
  ratified_at: z.string().nullable(),
});

export const ParentalProfileSnapshotSchema = z.object({
  aspirations: z.array(z.string()).optional(),
  latent_needs: z.array(z.string()).optional(),
  complement_choices: z.record(z.string(), z.array(z.string())).optional(),
});

export const EngineStateSnapshotSchema = z.object({
  journey_state: JourneyStateSnapshotSchema.optional(),
  helix_state: HelixStateSnapshotSchema.optional(),
  subject_proposed: SubjectProposedSnapshotSchema.optional(),
  parental_profile: ParentalProfileSnapshotSchema.optional(),
  trust_level: z.number().min(0).max(1),
  budget_remaining: z.number(),
  cycle_phase: z.string().optional(),
  current_session_phase: z
    .enum(["ice_breaker", "challenge_explain", "challenge_execute", "follow_up"])
    .optional(),
});

export type JourneyStateSnapshot = z.infer<typeof JourneyStateSnapshotSchema>;
export type HelixStateSnapshot = z.infer<typeof HelixStateSnapshotSchema>;
export type SubjectProposedSnapshot = z.infer<typeof SubjectProposedSnapshotSchema>;
export type ParentalProfileSnapshot = z.infer<typeof ParentalProfileSnapshotSchema>;
export type EngineStateSnapshot = z.infer<typeof EngineStateSnapshotSchema>;

// ─────────────────────────────────────────────────────────────────────────
// State diff — explícito, computado por `computeStateDiff(pre, post)`
// ─────────────────────────────────────────────────────────────────────────

export const EngineStateDiffSchema = z.object({
  journey_stage_transition: z
    .object({
      from: z.string(),
      to: z.string(),
      trigger: z.string(),
    })
    .optional(),
  helix_advance: z
    .object({
      dimension_changed: z.boolean().optional(),
      level_changed: z.boolean().optional(),
      cycle_completed: z.boolean().optional(),
    })
    .optional(),
  subject_knowledge_added_count: z.number().int().nonnegative(),
  trust_delta: z.number(),
  budget_delta: z.number(),
  session_phase_transition: z
    .object({ from: z.string(), to: z.string() })
    .optional(),
});

export type EngineStateDiff = z.infer<typeof EngineStateDiffSchema>;

// ─────────────────────────────────────────────────────────────────────────
// LLM calls — catálogo flat cross-component
// ─────────────────────────────────────────────────────────────────────────

export const LlmCallRoleSchema = z.enum([
  "assessor",
  "materializer",
  "planejador",
  "parental_triage",
  "strategist",
  "other",
]);
export type LlmCallRole = z.infer<typeof LlmCallRoleSchema>;

/**
 * Providers observados pelo trace — superset do `LlmProvider` em
 * llm-router.ts (que só cobre redes pagas). Trace precisa logar `local`
 * (OVMS qwen) e `mock` (testes) também.
 */
export const TraceLlmProviderSchema = z.enum([
  "anthropic",
  "infomaniak",
  "local",
  "mock",
]);
export type TraceLlmProvider = z.infer<typeof TraceLlmProviderSchema>;

export const LlmCallTraceSchema = z.object({
  id: z.string(),
  role: LlmCallRoleSchema,
  provider: TraceLlmProviderSchema,
  model: z.string(),
  prompt: z.string(),
  response: z.string(),
  duration_ms: z.number().nonnegative(),
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  prompt_cache_hit: z.boolean().optional(),
  redacted: z.boolean().optional(),
  error: z.string().optional(),
});

export type LlmCallTrace = z.infer<typeof LlmCallTraceSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Subject Knowledge writes do turn (writer + trigger anotados)
// ─────────────────────────────────────────────────────────────────────────

export const SubjectKnowledgeWriterSchema = z.enum([
  "discovery",
  "boundary",
  "concept_ledger",
  "recall_check",
  "axis_attempt_outcome",
  "vertical_affinity",
  "other",
]);
export type SubjectKnowledgeWriter = z.infer<typeof SubjectKnowledgeWriterSchema>;

export const SubjectKnowledgeWriteTraceSchema = z.object({
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  writer: SubjectKnowledgeWriterSchema,
  triggered_by: z.string(),
});

export type SubjectKnowledgeWriteTrace = z.infer<
  typeof SubjectKnowledgeWriteTraceSchema
>;

// ─────────────────────────────────────────────────────────────────────────
// Per-componente traces
// ─────────────────────────────────────────────────────────────────────────

export const AssessorTraceSchema = z.object({
  inputs: z.object({
    user_message: z.string(),
    turn_history_window: z.number().int().nonnegative().optional(),
  }),
  outputs: z.object({
    mood: z.number(),
    signals: z.array(z.string()),
    engagement: z.enum(["low", "mid", "high"]),
  }),
  mood_method: z.enum(["rule", "llm"]),
  duration_ms: z.number().nonnegative(),
  llm_call_ref: z.string().optional(),
});

const ScoredItemRefSchema = z.object({
  item: z
    .object({
      id: z.string().optional(),
      type: z.string().optional(),
      domain: z.string().optional(),
      axis_id: z.number().optional(),
    })
    .passthrough(),
  score: z.number(),
  reasons: z.array(z.string()).optional(),
});

export const PlanejadorTraceSchema = z.object({
  inputs: z.object({
    mood: z.number().optional(),
    signals: z.array(z.string()).optional(),
    recent_context: z.record(z.string(), z.unknown()).optional(),
  }),
  outputs: z.object({
    contentPool: z.array(ScoredItemRefSchema),
    contextHints: z.record(z.string(), z.unknown()).optional(),
    instruction_addition: z.string().optional(),
    strategicRationale: z.string().optional(),
    candidateSetEntropy: z.number().optional(),
  }),
  triageDecision: z
    .object({
      route: z.enum(["parental", "drota"]),
      reason: z.string(),
    })
    .optional(),
  triggerEvaluation: z
    .object({
      transitions_checked: z.array(z.string()),
      fired: z.string().optional(),
    })
    .optional(),
  llm_call_ref: z.string().optional(),
  duration_ms: z.number().nonnegative(),
});

export const StrategistTraceSchema = z.object({
  inputs: z.object({
    journey_stage: z.string(),
    latent_needs: z.array(z.string()).optional(),
    current_objectives: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  outputs: z.object({
    plan_id: z.string().optional(),
    target_demonstrations: z.array(z.record(z.string(), z.unknown())),
    playbook_composition: z.array(z.record(z.string(), z.unknown())),
  }),
  composition_method: z.enum(["template_v1", "llm"]),
  duration_ms: z.number().nonnegative(),
});

export const SelectorTraceSchema = z.object({
  inputs: z.object({
    pool_size: z.number().int().nonnegative(),
    mood: z.number().optional(),
    budget: z.number().optional(),
  }),
  filters_applied: z.array(
    z.object({
      name: z.string(),
      items_removed: z.array(z.string()),
      reason: z.string(),
    }),
  ),
  outputs: z.object({
    selected_id: z.string(),
    pool_remaining: z.array(z.string()),
  }),
  duration_ms: z.number().nonnegative(),
});

export const MaterializerTraceSchema = z.object({
  inputs: z.object({
    selected_item_id: z.string(),
    instruction_addition: z.string().optional(),
    user_message: z.string(),
  }),
  stable_prefix_hash: z.string(),
  user_message_constructed: z.string(),
  outputs: z.object({
    raw_response: z.string(),
    final_text: z.string(),
  }),
  llm_call_ref: z.string(),
  duration_ms: z.number().nonnegative(),
});

export type AssessorTrace = z.infer<typeof AssessorTraceSchema>;
export type PlanejadorTrace = z.infer<typeof PlanejadorTraceSchema>;
export type StrategistTrace = z.infer<typeof StrategistTraceSchema>;
export type SelectorTrace = z.infer<typeof SelectorTraceSchema>;
export type MaterializerTrace = z.infer<typeof MaterializerTraceSchema>;

// ─────────────────────────────────────────────────────────────────────────
// EngineTraceV2 — top-level aggregate per turn
// ─────────────────────────────────────────────────────────────────────────

export const ENGINE_TRACE_SCHEMA_VERSION = 2 as const;

export const EngineTraceV2Schema = z.object({
  schema_version: z.literal(2),
  turn_started_at: z.string(),
  turn_completed_at: z.string(),

  pre_state: EngineStateSnapshotSchema,
  post_state: EngineStateSnapshotSchema,
  state_diff: EngineStateDiffSchema,

  components: z.object({
    unified_assessor: AssessorTraceSchema.optional(),
    planejador: PlanejadorTraceSchema.optional(),
    strategist: StrategistTraceSchema.optional(),
    pragmatic_selector: SelectorTraceSchema.optional(),
    constrained_materializer: MaterializerTraceSchema.optional(),
  }),

  llm_calls: z.array(LlmCallTraceSchema),

  subject_knowledge_writes: z.array(SubjectKnowledgeWriteTraceSchema),

  warnings: z.array(
    z.object({
      component: z.string(),
      message: z.string(),
      recoverable: z.literal(true),
    }),
  ),
});

export type EngineTraceV2 = z.infer<typeof EngineTraceV2Schema>;

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Computa diff explícito entre dois snapshots — facilita render UI sem
 * forçar consumer a derivar.
 */
export function computeStateDiff(
  pre: EngineStateSnapshot,
  post: EngineStateSnapshot,
  subjectKnowledgeAddedCount: number,
): EngineStateDiff {
  const diff: EngineStateDiff = {
    subject_knowledge_added_count: subjectKnowledgeAddedCount,
    trust_delta: post.trust_level - pre.trust_level,
    budget_delta: post.budget_remaining - pre.budget_remaining,
  };

  if (
    pre.journey_state &&
    post.journey_state &&
    pre.journey_state.stage !== post.journey_state.stage
  ) {
    diff.journey_stage_transition = {
      from: pre.journey_state.stage,
      to: post.journey_state.stage,
      trigger: "auto", // caller pode sobrescrever com razão específica
    };
  }

  if (pre.helix_state && post.helix_state) {
    const helix: NonNullable<EngineStateDiff["helix_advance"]> = {};
    if (pre.helix_state.activeDimension !== post.helix_state.activeDimension) {
      helix.dimension_changed = true;
    }
    if (pre.helix_state.activeLevel !== post.helix_state.activeLevel) {
      helix.level_changed = true;
    }
    if (
      pre.helix_state.progress >= 0 &&
      post.helix_state.progress === 0 &&
      pre.helix_state.cycleDay > post.helix_state.cycleDay
    ) {
      helix.cycle_completed = true;
    }
    if (Object.keys(helix).length > 0) {
      diff.helix_advance = helix;
    }
  }

  if (
    pre.current_session_phase &&
    post.current_session_phase &&
    pre.current_session_phase !== post.current_session_phase
  ) {
    diff.session_phase_transition = {
      from: pre.current_session_phase,
      to: post.current_session_phase,
    };
  }

  return diff;
}

/**
 * Factory pra um EngineTraceV2 mínimo válido — usado por callers que
 * querem começar a trace e depois preencher seções incrementalmente.
 */
export function createEmptyEngineTrace(opts: {
  turn_started_at: string;
  pre_state: EngineStateSnapshot;
}): EngineTraceV2 {
  return {
    schema_version: ENGINE_TRACE_SCHEMA_VERSION,
    turn_started_at: opts.turn_started_at,
    turn_completed_at: opts.turn_started_at, // override on finalize
    pre_state: opts.pre_state,
    post_state: opts.pre_state, // override on finalize
    state_diff: {
      subject_knowledge_added_count: 0,
      trust_delta: 0,
      budget_delta: 0,
    },
    components: {},
    llm_calls: [],
    subject_knowledge_writes: [],
    warnings: [],
  };
}

/**
 * Parse + valida JSON crua. Retorna `null` quando schema inválido —
 * caller decide (UI: cai pra v1; STS scanner: warn + skip).
 */
export function parseEngineTraceV2(raw: unknown): EngineTraceV2 | null {
  const result = EngineTraceV2Schema.safeParse(raw);
  return result.success ? result.data : null;
}
