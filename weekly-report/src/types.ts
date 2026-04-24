/**
 * Tipos de saída do weekly-report — aggregate + metrics + render.
 *
 * Spec: ascendimacy-ops/docs/fundamentos/ebrota-kids-observabilidade.md
 * Handoff #17 Bloco 3.
 */

import type {
  GardnerChannel,
  CaselDimension,
  StatusMatrix,
  StatusValue,
} from "@ascendimacy/shared";

export interface WeekRange {
  /** ISO date (inclusive). */
  from: string;
  /** ISO date (exclusive). */
  to: string;
}

export interface CardSummary {
  content_id: string;
  content_type: string;
  domain: string;
  casel_targets: CaselDimension[];
  gardner_channels: GardnerChannel[];
  sacrifice_spent: number;
  turn: number;
  session_id: string;
  timestamp?: string;
}

export interface StatusComparison {
  dimension: string;
  previous: StatusValue | null;
  current: StatusValue;
  trend: "improved" | "worsened" | "stable" | "new";
}

/** Combinação de canais Gardner × dimensões CASEL ativados numa sessão. */
export interface IgnitionEvent {
  session_id: string;
  turn: number;
  gardner_channels: GardnerChannel[];
  casel_dimensions: CaselDimension[];
  /** Score de ignição: ≥3 canais + ≥2 dimensões (§2.2 paper). */
  ignited: boolean;
}

/** Métrica de sinal emergente — o que repete pode virar aspiração. */
export interface AspirationSignal {
  key: string;
  occurrences: number;
  first_seen_turn: number;
  last_seen_turn: number;
  contexts: string[];
}

export interface OperationalMetrics {
  total_turns: number;
  total_sessions: number;
  off_on_screen_ratio: { off: number; on: number; ratio: number };
  sessions_in_brejo: number;
  program_pause_frequency: number;
  missed_milestones_total: number;
  avg_sacrifice_per_turn: number;
  total_screen_seconds: number;
}

export interface WeeklyReportData {
  child_name: string;
  child_age: number | null;
  week: WeekRange;
  program_status: {
    current_week: number | null;
    current_phase: string | null;
    paused: boolean;
    paused_reason?: string;
  };
  cards: CardSummary[];
  status_comparison: StatusComparison[];
  ignitions: IgnitionEvent[];
  aspirations: AspirationSignal[];
  metrics: OperationalMetrics;
}

export interface WeeklyReportOptions {
  /** Status matrix da semana anterior — pra comparação. */
  previous_matrix?: StatusMatrix;
  /** Range de datas; se omitido, tenta derivar dos traces. */
  week_range?: WeekRange;
}
