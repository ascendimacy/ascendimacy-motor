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

/** Resumo de um EmittedCard para o relatório semanal (Bloco 5a). */
export interface EmittedCardSummary {
  card_id: string;
  archetype_id: string;
  title: string;
  narrative: string;
  image_url: string;
  rarity: string;
  cheat_code: string;
  serial_number: string;
  qr_payload: string;
  casel_dimension: string;
  gardner_channel_icon: string;
  issued_at: string;
  approved_at: string;
  emitted_at: string;
}

/** Resumo de sessões joint (dyad) na semana (Bloco 6). */
export interface JointSessionSummary {
  session_id: string;
  partner_child_id: string;
  partner_name?: string;
  turns_count: number;
  /** Média de score dos content items selecionados — proxy pra engagement/trust. */
  avg_engagement_score: number;
  /** Count de turns com bullying flag por pattern. */
  bullying_flags_count: Record<string, number>;
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
  /** Cards emitidos na semana (Bloco 5a). */
  emitted_cards: EmittedCardSummary[];
  status_comparison: StatusComparison[];
  ignitions: IgnitionEvent[];
  aspirations: AspirationSignal[];
  metrics: OperationalMetrics;
  /** Dinâmicas conjuntas agregadas (Bloco 6). Array vazio se só sessões solo. */
  joint_sessions: JointSessionSummary[];
  /**
   * Trend do trust dyad (Bloco 6): média atual − média semana anterior.
   * Null se não tem dados para comparação.
   */
  dyad_trust_trend: number | null;
}

export interface WeeklyReportOptions {
  /** Status matrix da semana anterior — pra comparação. */
  previous_matrix?: StatusMatrix;
  /** Range de datas; se omitido, tenta derivar dos traces. */
  week_range?: WeekRange;
  /** EmittedCards da semana (opcional — vem do caller que consulta motor-execucao). */
  emitted_cards?: import("@ascendimacy/shared").EmittedCard[];
  /** Avg de engagement de joint sessions na semana anterior — usado pra trend (Bloco 6). */
  previous_dyad_avg_engagement?: number;
}
