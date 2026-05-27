// Pre-Sprint Bootstrap contracts (ops#1008) — superfície pública
// importada por CC-Strategist (C-T-09), CC-Jogadas (C-T-10),
// CC-Recovery e CC-STS.

export { Iso8601DateTime } from "./iso8601.js";

export {
  JOGADA_TYPES,
  type JogadaType,
  type JogadaSignal,
  type PlanoTaticoSnapshot,
  type JogadaInput,
  type JogadaOutput,
  type JogadaStep,
} from "./jogada-step.js";

export {
  PlanoTaticoDeltaSchema,
  DELTA_TYPES,
  EIXO_STATES,
  type PlanoTaticoDelta,
  type DeltaType,
  type EixoState,
} from "./plano-tatico-delta.js";

export {
  TelemetryEventSchema,
  TELEMETRY_EVENT_TYPES,
  type TelemetryEvent,
  type TelemetryEventType,
} from "./telemetry-event.js";

export {
  ACTION_MENU_ITEM_TYPES,
  ACTION_MENU_SCHEMA_VERSION,
  ActionMenuItemSchema,
  ActionMenuItemTypeSchema,
  ActionMenuSchema,
  ActionMenuSourceSchema,
  INTENSITY_VALUES,
  IntensitySchema,
  parseActionMenu,
  PLAYED_AS_VALUES,
  PlayedAsSchema,
  type ActionMenu,
  type ActionMenuItem,
  type ActionMenuItemType,
  type ActionMenuSource,
  type Intensity,
  type PlayedAs,
} from "./action-menu.js";

export {
  KIDS_HELIX_MODES,
  KIDS_HELIX_DEFER_REASONS,
  KIDS_HELIX_RESUME_REASONS,
  KIDS_HELIX_VACATION_TRIGGERS,
  KIDS_HELIX_ACTIVE_DAYS,
  KIDS_HELIX_TOTAL_DAYS,
  KIDS_HELIX_BREJO_VACATION_DAYS,
  KIDS_HELIX_BREJO_DEFER_DAYS,
  KIDS_HELIX_SACRIFICE_EXHAUSTION_SESSIONS,
  KIDS_HELIX_DEFAULT_FALLBACK_PAIR,
  // G-07 (ops#1020) — cadence trigger exports
  KIDS_HELIX_CADENCE_TRIGGERS,
  KIDS_HELIX_EXTENSION_RECOMMENDATIONS,
  KIDS_HELIX_RETRIEVAL_TRIGGER_DAY,
  KIDS_HELIX_BOSS_FIGHT_TRIGGER_DAY,
  KIDS_HELIX_MIDCYCLE_ASSESSMENT_DAY,
  KIDS_HELIX_EXTENSION_EVOLUTION_THRESHOLD,
  defaultKidsHelixState,
  type KidsHelixState,
  type KidsHelixMode,
  type KidsHelixDeferReason,
  type KidsHelixResumeReason,
  type KidsHelixVacationTrigger,
  type KidsHelixCadenceTrigger,
  type KidsHelixExtensionRecommendation,
  type CaselDimensionPair,
} from "./kids-helix-state.js";

export {
  CRITICAL_REASONS,
  CriticalReasonSchema,
  type CriticalReason,
} from "./critical-reason.js";

// S1 unified read contract (ops#1150) — LearnerSummary schema + type.
export {
  LearnerSummarySchema,
  type LearnerSummary,
} from "./learner-summary.js";

// Trio runtime engine (ops#1086) — types puros; lógica em
// orchestrator/src/trio-runtime.ts. Doctrine §10 + §11 dinamicas-grupo.
export {
  GROUP_MODES,
  DEFAULT_TRIO_RUNTIME_CONFIG,
  TURN_SPEAKER_TYPES,
  TRIO_WARNING_KINDS,
  NEXT_SPEAKER_TARGETS,
  type GroupMode,
  type TrioRuntimeConfig,
  type TurnSpeakerType,
  type TurnHistoryEntry,
  type TrioParticipant,
  type BrejoSignal,
  type TrioState,
  type TrioWarningKind,
  type TrioWarning,
  type NextSpeakerTarget,
  type TrioDecision,
} from "./trio-runtime.js";

export {
  MilestoneEventSchema,
  MilestoneEventTypeSchema,
  MILESTONE_EVENT_TYPES,
  type MilestoneEvent,
  type MilestoneEventType,
} from "./milestone-event.js";

// S1 declared objectives (ops spec 2026-05-26-s1-objetivos-declarados-v0)
export {
  DECLARED_OBJECTIVE_STATUSES,
  DeclaredObjectiveSchema,
  DeclaredObjectiveStatusSchema,
  DeclaredObjectiveDraftSchema,
  type DeclaredObjective,
  type DeclaredObjectiveStatus,
  type DeclaredObjectiveDraft,
} from "./declared-objective.js";
