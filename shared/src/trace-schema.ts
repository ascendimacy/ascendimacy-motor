/**
 * Trace schema — Bloco 3 (#17) observabilidade completa.
 *
 * Spec: ascendimacy-ops/docs/fundamentos/ebrota-kids-observabilidade.md §2.
 * Handoff: docs/handoffs/2026-04-24-cc-bloco2-plan.md + Bloco 3.
 *
 * v0.1.0 → v0.3.0 — TurnTrace enriquecida com:
 *   - statusSnapshot (matrix completa do turn)
 *   - gardnerProgramSnapshot (week/day/phase/paused)
 *   - selectedContent (id, type, score) para replay
 *   - gardnerChannelsObserved + caselTargetsTouched
 *   - sacrificeSpent + screenSeconds
 *   - instructionAdditionApplied (echo do string injetado no drota)
 *   - statusTransitions + flags.anomalies/warnings
 *
 * Todos os campos v0.3 são OPCIONAIS — traces antigos continuam válidos.
 */

import type { StatusMatrix, StatusValue } from "./status-matrix.js";
import type { GardnerProgramState } from "./mixins/with-gardner-program.js";
import type { GardnerChannel, CaselDimension, ContentItemType } from "./content-item.js";
import type { SessionMode } from "./types.js";

export const TRACE_SCHEMA_VERSION = "0.3.0";

export interface TraceEntry {
  service: "planejador" | "motor-drota" | "motor-execucao";
  timestamp: string;
  durationMs: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

/** Transição aplicada na status matrix dentro de um turn. */
export interface StatusTransitionRecord {
  dimension: string;
  from: StatusValue | null;
  to: StatusValue;
  accepted: boolean;
  reason: string;
}

export interface SelectedContentSummary {
  id: string;
  type: ContentItemType | string;
  score: number;
  domain: string;
  surprise: number;
  sacrifice_type?: string;
}

export interface TurnTraceFlags {
  anomalies: string[];
  warnings: string[];
}

export interface TurnTrace {
  turnNumber: number;
  sessionId: string;
  /** ISO timestamp do turn (v0.3). */
  timestamp?: string;
  incomingMessage: string;
  entries: TraceEntry[];
  finalResponse: string;

  // ────── v0.3 enrichment (todos opcionais) ──────

  /** Matrix status no início do turn. */
  statusSnapshot?: StatusMatrix;
  /** Estado do programa Gardner no início do turn. */
  gardnerProgramSnapshot?: GardnerProgramState;
  /** Resumo do content selecionado pelo drota. */
  selectedContent?: SelectedContentSummary;
  /** Canais Gardner que foram tocados no turn (derivado do content). */
  gardnerChannelsObserved?: GardnerChannel[];
  /** Dimensões CASEL alvo do content selecionado. */
  caselTargetsTouched?: CaselDimension[];
  /** Pontos de sacrifice debitados no turn. */
  sacrificeSpent?: number;
  /** Segundos de tela no turn. */
  screenSeconds?: number;
  /** Echo literal da instruction_addition injetada (debug + replay). */
  instructionAdditionApplied?: string;
  /** Transições de status aplicadas durante/após o turn. */
  statusTransitions?: StatusTransitionRecord[];
  /** Anomalias ou warnings detectados. */
  flags?: TurnTraceFlags;

  // ─── v0.3.1 — Bloco 6 (dyad) ──────────────────────────────────────────
  sessionMode?: SessionMode;
  jointPartnerChildId?: string;
  jointPartnerName?: string;
  /** Resultado do bullying-check aplicado no turn (se sessionMode=joint). */
  bullyingCheck?: {
    flagged: boolean;
    pattern?: string;
    confidence?: number;
    reason?: string;
  };

  // ─── v0.3.2 — Bloco 5a auto-hook (motor#17) ──────────────────────────
  /** card_id se detectAchievement disparou e emit_card_for_signal persistiu. */
  emittedCardId?: string;
  /** Razão pra skip (scaffold guard, triagem rejeitou, signal nulo, etc). */
  cardEmissionSkipReason?: string;

  // ─── v0.3.3 — motor#25 Tarefa 3 parse fallback ──────────────────────
  /** True se output do drota LLM não foi JSON válido (refusal/explanation). */
  parseFailure?: boolean;
  /** Razão (parse_failure | json_invalid_after_extract). */
  parseFailureReason?: string;

  // ─── v0.3.4 — motor-simplificacao Steps 1-5 (feature flag) ───────────
  /** Snapshot do Unified Assessor (Step 1). Preenchido só com flag on. */
  assessmentSnapshot?: {
    mood: number;
    mood_method: "rule" | "llm" | "fallback";
    mood_confidence: "high" | "medium" | "low";
    signals: string[];
    engagement: "high" | "medium" | "low" | "disengaging";
    model_used?: string;
    latency_ms: number;
  };
  /** Snapshot do Pragmatic Selector (Step 2). Preenchido só com flag on. */
  selectionSnapshot?: {
    decision_path: string;
    candidates_count: number;
    viable_count: number;
    selected_id: string;
    selected_cost: number;
    budget_before: number;
    budget_after: number;
    pulso_emitted?: boolean;
  };
  /** Snapshot do Constrained Materializer (Step 3). Preenchido só com flag on. */
  materializationSnapshot?: {
    model_used: string;
    fallback_triggered: boolean;
    latency_ms: number;
    token_count: number;
    sanitization_applied?: boolean;
  };
}

export interface SessionTrace {
  sessionId: string;
  persona: string;
  /** v0.3: idade opcional pra contextualização em relatórios. */
  personaAge?: number;
  startedAt: string;
  turns: TurnTrace[];
  meta: {
    schemaVersion: string;
    motorVersion: string;
  };
}

export function createSessionTrace(
  sessionId: string,
  persona: string,
  personaAge?: number,
): SessionTrace {
  return {
    sessionId,
    persona,
    personaAge,
    startedAt: new Date().toISOString(),
    turns: [],
    meta: { schemaVersion: TRACE_SCHEMA_VERSION, motorVersion: "0.3.0" },
  };
}
