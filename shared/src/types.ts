import type { StatusMatrix } from "./status-matrix.js";
import type { GardnerProgramState } from "./mixins/with-gardner-program.js";
import type { MoodScore, MoodWindow } from "./mood.js";

export interface PersonaDef {
  id: string;
  name: string;
  age: number;
  profile: Record<string, unknown>;
}

export interface AdquirenteDef {
  id: string;
  name: string;
  defaults: Record<string, unknown>;
}

export interface PlaybookIndex {
  id: string;
  title: string;
  category: string;
  estimatedSacrifice: number;
  estimatedConfidenceGain: number;
}

export const SESSION_MODES = ["solo", "joint"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export interface SessionState {
  sessionId: string;
  trustLevel: number;
  budgetRemaining: number;
  eventLog: EventEntry[];
  turn: number;
  /** Hidratado por motor-execucao a partir de tree_nodes (zone='status'). */
  statusMatrix?: StatusMatrix;
  /** Estado do programa Gardner 5 semanas (Bloco 2b). */
  gardnerProgram?: GardnerProgramState;

  // ─── F1 mood (motor#35) ──────────────────────────────────────────────

  /**
   * Mood absoluto da criança neste turn (1-10 integer). Producer:
   * mood-extractor (LLM v0 + fallback rule-based, PR PART B).
   * Default MOOD_DEFAULT (5) quando producer não rodou.
   */
  currentMood?: MoodScore;
  /**
   * Janela móvel pra comfort gate + prompt context. Computada via
   * `computeMoodWindow(history, now)` no início do turn.
   */
  moodWindow?: MoodWindow;

  // ─── Bloco 6 — Dinâmicas em grupo (dyad) ─────────────────────────────

  /** solo | joint. Default 'solo' se ausente. Joint só ativa com consent Bloco 4. */
  sessionMode?: SessionMode;
  /** Se joint: child_id do parceiro (ex: 'kei' quando sessão é com Ryo + Kei). */
  jointPartnerChildId?: string;
  /** Nome do parceiro — pro drota endereçar por nome. */
  jointPartnerName?: string;
  /** StatusMatrix do parceiro no instante do turn. Planejador verifica brejo unilateral. */
  partnerStatusMatrix?: StatusMatrix;
}

export interface EventEntry {
  timestamp: string;
  type: string;
  playbookId?: string;
  data: Record<string, unknown>;
}
