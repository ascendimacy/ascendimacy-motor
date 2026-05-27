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

// B2 — Drilling primer (banco atômico + SR + mastery)
// spec ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md
export {
  DRILL_ITEM_TYPES,
  DRILL_REGISTERS,
  DrillItemTypeSchema,
  DrillDifficultySchema,
  DrillRegisterSchema,
  DrillItemPayloadSchema,
  DrillItemCulturalMetadataSchema,
  DrillItemBaseSchema,
  DrillItemSchema,
  DrillBankSchema,
  parseDrillBank,
  type DrillItem,
  type DrillItemBase,
  type DrillItemType,
  type DrillDifficulty,
  type DrillRegister,
  type DrillItemPayload,
  type DrillItemCulturalMetadata,
  type DrillBank,
} from "./drill-item.js";

export {
  DRILL_RESPONSES,
  DrillResponseSchema,
  DrillStateSchema,
  DEFAULT_EASINESS,
  MIN_EASINESS,
  MASTERY_MIN_CORRECT,
  MASTERY_WINDOW_SIZE,
  MASTERY_MIN_INTERVAL_DAYS,
  type DrillResponse,
  type DrillState,
} from "./drill-state.js";

// B1 — hooks temporais + continuidade narrativa
// (spec ascendimacy-ops/docs/specs/2026-05-26-b1-hooks-temporais-v0.md)
export {
  TemporalWindowSchema,
  TemporalWindowEntrySchema,
  TemporalExclusionWindowSchema,
  TimeOfDaySchema,
  WEEKDAY_VALUES,
  type Weekday,
  type TemporalWindow,
  type TemporalWindowEntry,
  type TemporalExclusionWindow,
} from "./temporal-window.js";

export {
  NarrativeThreadSchema,
  NarrativeThreadStatusSchema,
  NARRATIVE_THREAD_STATUSES,
  type NarrativeThread,
  type NarrativeThreadStatus,
} from "./narrative-thread.js";

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

// S4 — Separação Tactician (decide jogada) vs Speaker (gera fala).
// Spec: ascendimacy-ops/docs/specs/2026-05-26-s4-separacao-decide-gera-v0.md
export {
  JOGADA_VALUES,
  JogadaSchema,
  RegisterSchema,
  TacticDecisionConstraintsSchema,
  TacticDecisionSchema,
  parseTacticDecision,
  type Jogada,
  type Register,
  type TacticDecision,
  type TacticDecisionConstraints,
} from "./tactic-decision.js";
