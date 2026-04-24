/**
 * withGardnerProgram — mixin pedagógico de 5 semanas com padrão triádico
 * força-ensina-fraqueza.
 *
 * Spec:
 *   - ascendimacy-ops/docs/fundamentos/ebrota-kids-fundamentos.md §6
 *   - ascendimacy-ops/docs/specs/2026-04-24-ebrota-learning-mechanics-paper.md §4.2-4.3
 *
 * Estrutura:
 *   Semana 1: Top#1 ensina Bottom#1
 *   Semana 2: Top#2 ensina Bottom#2
 *   Semana 3: Top#3 ensina Bottom#3
 *   Semana 4: Top#4 ensina Bottom#4
 *   Semana 5: combinação múltipla — arremate
 *
 * 3 fases por semana (em ordem):
 *   1. exploration_in_strength (off-screen)
 *   2. translation_via_weakness (on-screen)
 *   3. presentation (off-screen — audiência real)
 *
 * Invariantes:
 *   - Assessment Gardner exige min 3 sessões antes de ativar (D-firme #8)
 *   - Programa pausa em emotional=brejo (canEmitChallenge)
 *   - Criança pode pedir pausa a qualquer momento
 */

import type { GardnerChannel } from "../content-item.js";
import { canEmitChallenge } from "../status-matrix.js";
import type { StatusMatrix } from "../status-matrix.js";

export const PROGRAM_PHASES = [
  "exploration_in_strength",
  "translation_via_weakness",
  "presentation",
] as const;
export type ProgramPhase = (typeof PROGRAM_PHASES)[number];

/** Assessment Gardner — ranking parcial dos 9 canais. */
export interface GardnerAssessment {
  /** Top 4+ canais por rank, mais forte primeiro. */
  top: GardnerChannel[];
  /** Bottom 4+ canais por rank, mais fraco primeiro. */
  bottom: GardnerChannel[];
  /** Quantas sessões produziram esse ranking. min 3 pra ativar programa. */
  sessions_observed: number;
}

/** Estado persistido do programa em andamento. */
export interface GardnerProgramState {
  /** Se undefined, programa nunca iniciou; se null, pausado. */
  current_week: number | null;
  current_day: number;
  current_phase: ProgramPhase | null;
  paused: boolean;
  paused_reason?: string;
  /** count de fases completadas (week × phase). */
  phases_completed: number;
  /** Milestones consecutivos não entregues (pause-revisão parental). */
  consecutive_missed_milestones: number;
  started_at?: string;
  updated_at?: string;
}

/** min de sessões antes de liberar programa. */
export const MIN_SESSIONS_FOR_ASSESSMENT = 3;

/** Total de semanas do programa. */
export const PROGRAM_LENGTH_WEEKS = 5;

/** Milestones consecutivos faltantes que disparam pause parental. */
export const MISSED_MILESTONES_TO_PAUSE = 2;

/** `true` se o assessment tem dados suficientes pra ativar programa. */
export function isAssessmentReady(a: GardnerAssessment | undefined): boolean {
  if (!a) return false;
  if (a.sessions_observed < MIN_SESSIONS_FOR_ASSESSMENT) return false;
  if (a.top.length < 1 || a.bottom.length < 1) return false;
  return true;
}

export interface ChannelPair {
  strength: GardnerChannel;
  weakness: GardnerChannel;
  multi_channel: boolean;
}

/**
 * Retorna o par força×fraqueza da semana conforme tabela §4.2:
 *   semana 1 → Top#1 × Bottom#1
 *   ...
 *   semana 4 → Top#4 × Bottom#4
 *   semana 5 → multi-channel (arremate) — usa Top#1 + Bottom#1 como base + flag
 */
export function pairForWeek(
  week: number,
  assessment: GardnerAssessment,
): ChannelPair | null {
  if (week < 1 || week > PROGRAM_LENGTH_WEEKS) return null;
  if (!isAssessmentReady(assessment)) return null;

  const rank = week === 5 ? 0 : week - 1;
  const strength = assessment.top[rank] ?? assessment.top[0]!;
  const weakness = assessment.bottom[rank] ?? assessment.bottom[0]!;
  return {
    strength,
    weakness,
    multi_channel: week === 5,
  };
}

/**
 * Fase → descrição localizável usada no instruction_addition.
 */
const PHASE_LABEL: Record<ProgramPhase, string> = {
  exploration_in_strength: "exploração na força (off-screen)",
  translation_via_weakness: "tradução via fraqueza (tela)",
  presentation: "apresentação para audiência real (off-screen)",
};

export interface ComposeInstructionInput {
  week_number: number;
  day_in_week: number;
  strength_channel: GardnerChannel;
  weakness_channel: GardnerChannel;
  phase: ProgramPhase;
  multi_channel?: boolean;
}

/**
 * Compõe o conteúdo pra `EvaluateAndSelectInput.instruction_addition`.
 * String de 3-6 linhas para o drota incorporar no bloco 2 do prompt.
 *
 * Diferente por fase — CADA fase produz instrução distinta:
 *   1. exploration: pede artifact bruto no canal forte
 *   2. translation: pede conversão usando canal fraco
 *   3. presentation: convida apresentação pra audiência real
 */
export function composeInstructionAddition(input: ComposeInstructionInput): string {
  const { week_number, day_in_week, strength_channel, weakness_channel, phase, multi_channel } = input;
  const header = multi_channel
    ? `[programa dual-helix | semana ${week_number}/5 — arremate multi-canal | dia ${day_in_week}]`
    : `[programa dual-helix | semana ${week_number}/5 | dia ${day_in_week}]`;
  const pair = multi_channel
    ? `Força principal: ${strength_channel} (+ combinar outros canais do top). Fraqueza a trabalhar: ${weakness_channel}.`
    : `Força da semana: ${strength_channel}. Fraqueza a trabalhar: ${weakness_channel}.`;

  const phaseInstruction = (() => {
    switch (phase) {
      case "exploration_in_strength":
        return `Fase 1 — ${PHASE_LABEL.exploration_in_strength}. Peça material bruto (rabiscos, notas, áudios, fotos — qualquer formato) produzido no canal ${strength_channel}. Isto não é desafio de tela: o artefato existe físico. Sua fala deve convidar produção autêntica, sem julgar qualidade.`;
      case "translation_via_weakness":
        return `Fase 2 — ${PHASE_LABEL.translation_via_weakness}. Convide a criança a CONVERTER o material da fase 1 usando canal ${weakness_channel}. A fraqueza é ponte, não treino isolado — sua função é ser o único caminho pra expressar o que a força criou.`;
      case "presentation":
        return `Fase 3 — ${PHASE_LABEL.presentation}. Incentive que o artefato final seja apresentado pra uma audiência real (irmão, responsável, amigo). Enfatize que não há nota nem score — só o ato de mostrar pra alguém importante.`;
    }
  })();

  return [header, pair, phaseInstruction].join("\n");
}

/**
 * Decide se o programa deve pausar AGORA dada a status matrix.
 * Reusa `canEmitChallenge` pra enforçar a invariante emotional=brejo.
 */
export interface PauseDecision {
  paused: boolean;
  reason?: string;
}

export function shouldPauseProgram(matrix: StatusMatrix): PauseDecision {
  const gate = canEmitChallenge(matrix, "cognitive_math");
  if (!gate.ok && gate.reason === "emotional_brejo_blocks_all") {
    return { paused: true, reason: "emotional_brejo" };
  }
  // Brejo no próprio emotional (gate bloqueia a dimensão alvo) também pausa.
  const emotional = matrix["emotional"];
  if (emotional === "brejo") {
    return { paused: true, reason: "emotional_brejo" };
  }
  return { paused: false };
}

/**
 * Avança fase: phase 1 → 2, 2 → 3, 3 → week+1 phase 1.
 * Week 5 phase 3 → programa completo (retorna `null` em current_phase).
 */
export function nextPhase(state: GardnerProgramState): GardnerProgramState {
  if (state.paused) return state;
  const { current_week, current_phase } = state;
  if (current_week === null || current_phase === null) {
    // Primeiro turno — inicia week 1 phase 1.
    return {
      ...state,
      current_week: 1,
      current_phase: "exploration_in_strength",
      phases_completed: 0,
    };
  }
  const idx = PROGRAM_PHASES.indexOf(current_phase);
  const newPhasesCompleted = state.phases_completed + 1;
  if (idx < PROGRAM_PHASES.length - 1) {
    return {
      ...state,
      current_phase: PROGRAM_PHASES[idx + 1]!,
      phases_completed: newPhasesCompleted,
    };
  }
  // Última fase da semana — avança semana.
  if (current_week >= PROGRAM_LENGTH_WEEKS) {
    // Programa completo.
    return {
      ...state,
      current_phase: null,
      current_week: null,
      phases_completed: newPhasesCompleted,
    };
  }
  return {
    ...state,
    current_week: current_week + 1,
    current_phase: "exploration_in_strength",
    phases_completed: newPhasesCompleted,
  };
}
