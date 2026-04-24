import type { StatusMatrix } from "./status-matrix.js";
import type { GardnerProgramState } from "./mixins/with-gardner-program.js";

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
