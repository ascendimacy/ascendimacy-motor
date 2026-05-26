/**
 * SessionPhase + JourneyStage — Fase 8 (Session Phases + Strategist).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-25-session-phases-journey-stages-strategist.md
 *
 * Foundation types do tracer bullet. Comportamento phase-aware vem em PR
 * seguinte (PR 2 motor). Strategist em PR 3.
 *
 * Princípio: sessão tem 3 níveis temporais — JOURNEY (cross-session,
 * meses) > STAGE (1-N sessões) > SESSION (15+30+5 min) > PHASE (sub-bloco).
 */

import type { SubjectKnowledgeEntry } from "./subject-knowledge.js";

// ─────────────────────────────────────────────────────────────────────────
// SessionPhase — 4 fases intra-sessão (spec §2)
// ─────────────────────────────────────────────────────────────────────────

export type SessionPhase =
  | "ice_breaker"        // 15 min — abrir + descobrir + tom seguro
  | "challenge_explain"  // ~5 min — apresentar desafio
  | "challenge_execute"  // 30 min — ação efetiva (StrategyPlan em execução)
  | "follow_up";         // 5 min — consolidar, comparar plano vs demonstração

export const SESSION_PHASES: readonly SessionPhase[] = [
  "ice_breaker",
  "challenge_explain",
  "challenge_execute",
  "follow_up",
] as const;

export interface SessionTiming {
  total_minutes: number;
  ice_breaker_minutes: number;
  challenge_explain_minutes: number;
  challenge_execute_minutes: number;
  follow_up_minutes: number;
}

/** Configuração default da sessão eBrota — 15+30+5 = 50min total (spec SP-01). */
export const DEFAULT_SESSION_TIMING: SessionTiming = {
  total_minutes: 50,
  ice_breaker_minutes: 15,
  challenge_explain_minutes: 0, // embutido nos últimos 5min do ice_breaker
  challenge_execute_minutes: 30,
  follow_up_minutes: 5,
};

// ─────────────────────────────────────────────────────────────────────────
// JourneyStage — 3 stages cross-session (spec §3)
// ─────────────────────────────────────────────────────────────────────────

export type JourneyStage =
  | "discovery_only"          // primeiras sessões: SÓ mapear
  | "mapping_ready"            // transição: motor propõe mapa, pai ratifica
  | "applied_double_helix";    // sessões correntes: Strategist + ponte tripla

export const JOURNEY_STAGES: readonly JourneyStage[] = [
  "discovery_only",
  "mapping_ready",
  "applied_double_helix",
] as const;

export interface JourneyState {
  subject_id: string;
  stage: JourneyStage;
  stage_entered_at: string;
  discoveries_count: number;
  /** Famílias do catálogo Subject Knowledge já cobertas por discoveries. */
  families_covered: string[];
  override_by_parent?: {
    forced_stage: JourneyStage;
    reason: string;
    timestamp: string;
  };
  last_updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────
// SessionStateResolver — decide fase atual heuristicamente (spec §7.1)
// ─────────────────────────────────────────────────────────────────────────

export interface SessionStateInput {
  /** Número do turn atual na sessão (1-indexed). */
  turn: number;
  /** Minutos médios por turn (default 4 — observado em smokes reais). */
  avgMinutesPerTurn?: number;
  /** Override explícito de minutos elapsed (para integrações futuras com tempo real). */
  elapsedMinutesOverride?: number;
  /** Stage atual da jornada do sujeito. */
  journeyStage: JourneyStage;
  /** Configuração temporal da sessão. */
  timing?: SessionTiming;
}

export interface SessionStateOutput {
  phase: SessionPhase;
  journey_stage: JourneyStage;
  elapsed_minutes_estimate: number;
  /** Quantos minutos restam na fase atual antes da transição automática. */
  minutes_until_next_phase: number;
}

const DEFAULT_AVG_MIN_PER_TURN = 4;

/**
 * Resolve fase + stage. Heurística v1: phase = f(elapsed_minutes).
 * Override por elapsedMinutesOverride quando tempo real é conhecido.
 */
export function resolveSessionState(input: SessionStateInput): SessionStateOutput {
  const timing = input.timing ?? DEFAULT_SESSION_TIMING;
  const elapsed =
    input.elapsedMinutesOverride !== undefined
      ? input.elapsedMinutesOverride
      : input.turn * (input.avgMinutesPerTurn ?? DEFAULT_AVG_MIN_PER_TURN);

  const iceEnd = timing.ice_breaker_minutes;
  const explainEnd = iceEnd + timing.challenge_explain_minutes;
  const executeEnd = explainEnd + timing.challenge_execute_minutes;

  let phase: SessionPhase;
  let nextBoundary: number;
  if (elapsed < iceEnd) {
    phase = "ice_breaker";
    nextBoundary = iceEnd;
  } else if (elapsed < explainEnd) {
    phase = "challenge_explain";
    nextBoundary = explainEnd;
  } else if (elapsed < executeEnd) {
    phase = "challenge_execute";
    nextBoundary = executeEnd;
  } else {
    phase = "follow_up";
    nextBoundary = timing.total_minutes;
  }

  return {
    phase,
    journey_stage: input.journeyStage,
    elapsed_minutes_estimate: elapsed,
    minutes_until_next_phase: Math.max(0, nextBoundary - elapsed),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Threshold de maturidade — saída de discovery_only (spec §3.2, SP-04)
// ─────────────────────────────────────────────────────────────────────────

export const READY_FOR_MAPPING_MIN_DISCOVERIES = 10;
export const READY_FOR_MAPPING_MIN_FAMILIES = 3;

export interface ReadyForMappingInput {
  state: JourneyState;
  /** Override explícito dos pais ("force mapping_ready" / "stay in discovery"). */
  parentOverride?: JourneyStage;
}

/**
 * Avalia se o sujeito está pronto pra avançar de discovery_only para
 * mapping_ready. Critério (ratificado 2026-05-25):
 *   - ≥10 descobertas distribuídas em ≥3 famílias (saturação)
 *   - OU override parental explícito
 */
export function readyForMapping(input: ReadyForMappingInput): boolean {
  if (input.parentOverride === "mapping_ready" || input.parentOverride === "applied_double_helix") {
    return true;
  }
  if (input.parentOverride === "discovery_only") {
    return false; // pai forçou ficar em descoberta
  }
  return (
    input.state.discoveries_count >= READY_FOR_MAPPING_MIN_DISCOVERIES &&
    input.state.families_covered.length >= READY_FOR_MAPPING_MIN_FAMILIES
  );
}

/**
 * Helper: deriva families_covered + discoveries_count de uma lista de
 * SubjectKnowledgeEntry. Usado pelo BFF pra computar estado a partir
 * do ledger. Conta tipos discovery-like (interest/value/need/discovery).
 */
export function computeDiscoveryMaturity(
  entries: SubjectKnowledgeEntry[],
  axisToFamilyFn?: (axisId: number) => string | undefined,
): { discoveries_count: number; families_covered: string[] } {
  const discoveryTypes: ReadonlySet<string> = new Set([
    "interest",
    "value",
    "need",
    "discovery",
  ]);
  const families = new Set<string>();
  let count = 0;
  for (const e of entries) {
    if (!discoveryTypes.has(e.type)) continue;
    count += 1;
    // Tenta extrair família via lineage_anchor do payload se houver,
    // senão via axis_id quando presente, senão via heurística parcial.
    // Double cast unknown → Record evita TS2352 com union discriminada.
    const payload = e.payload as unknown as Record<string, unknown>;
    if (typeof payload["family"] === "string") {
      families.add(payload["family"] as string);
    } else if (typeof payload["axis_id"] === "number" && axisToFamilyFn) {
      const fam = axisToFamilyFn(payload["axis_id"] as number);
      if (fam) families.add(fam);
    }
    // Discoveries sem axis_id/family não contam pro multi-família mas
    // contam pro count total — caller decide se é OK na thresh.
  }
  return {
    discoveries_count: count,
    families_covered: Array.from(families).sort(),
  };
}

/** Inicializa journey_state pra sujeito novo. */
export function initialJourneyState(subjectId: string): JourneyState {
  const now = new Date().toISOString();
  return {
    subject_id: subjectId,
    stage: "discovery_only",
    stage_entered_at: now,
    discoveries_count: 0,
    families_covered: [],
    last_updated_at: now,
  };
}
