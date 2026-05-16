/**
 * Trio runtime engine — contracts (ops#1086).
 *
 * Tipos puros do trio rotation runtime. Lógica vive em
 * `orchestrator/src/trio-runtime.ts`. Persistência: caller
 * monta TrioState a partir de event_log + persona profiles.
 *
 * Doctrine source: ascendimacy-ops/docs/fundamentos/ebrota-kids-dinamicas-grupo.md §10 + §11
 * Config source: ascendimacy-ops/docs/playbooks/kids.group.playbook.yaml moderation_rules
 *
 * Sub-decisões ratificadas Jun 2026-05-16 (ops#1086):
 *   1. bot_turn_ratio_trio = 0.20 (< 0.25 dyad)
 *   2. dominance_threshold_trio = 0.50 (< 0.60 dyad)
 *   3. absence_threshold per-persona: Saki=5, default=3
 *   4. brejo_pause_policy_trio: sensory_saki=partial, emotional_any=full
 *
 * Cross-ref: motor#122 (fixture Saki regulation_strategy + silence_tolerance_rounds),
 *            ops#1090 (docs §11 + playbook config).
 */

/** Modo do grupo — drive da escolha de thresholds dyad vs trio. */
export const GROUP_MODES = ["dyad", "trio"] as const;
export type GroupMode = (typeof GROUP_MODES)[number];

/**
 * Configuração do runtime — derivada de `kids.group.playbook.yaml`
 * moderation_rules. Shape canonical, leitor faz fallback em campos
 * ausentes pra defaults dyad-doctrine.
 */
export interface TrioRuntimeConfig {
  /** Tamanho máximo do grupo (dyad=2, trio=3 v1, 4-8 v2). */
  max_group_size: number;

  /** Bot turn ratio cap (< este valor) em dyad. Default 0.25 (§10.1). */
  bot_turn_ratio_dyad: number;
  /** Bot turn ratio cap (< este valor) em trio. Default 0.20 (§11.1). */
  bot_turn_ratio_trio: number;

  /** Dominance threshold em dyad. Default 0.60 (§10.4). */
  dominance_threshold_dyad: number;
  /** Dominance threshold em trio. Default 0.50 (§11.2). */
  dominance_threshold_trio: number;

  /** Default absence threshold (rounds silenciosos antes de ping). §10.3 = 3. */
  absence_threshold_rounds_default: number;
  /** Overrides per-persona-id. Saki=5 (§11.3). */
  absence_threshold_rounds_overrides: Record<string, number>;

  /**
   * Brejo pause policy em trio (§11.4):
   *  - sensory_saki: "partial" → skip Saki rotation, Ryo/Kei continuam
   *  - emotional_any: "full"   → pause total (qualquer membro brejo emocional)
   * Dyad mantém doctrine §10.6 (any-brejo → full pause).
   */
  brejo_pause_policy_trio: {
    sensory_saki: "partial" | "full";
    emotional_any: "partial" | "full";
  };

  /** Max consecutive bot turns (§10.2 inalterado em trio). Default 2. */
  max_consecutive_bot_turns: number;
}

/**
 * Default config — usado quando playbook YAML ausente ou parcial.
 * Reflete doctrine canonizada ops#1090 (Jun GO 2026-05-16).
 */
export const DEFAULT_TRIO_RUNTIME_CONFIG: TrioRuntimeConfig = {
  max_group_size: 3,
  bot_turn_ratio_dyad: 0.25,
  bot_turn_ratio_trio: 0.2,
  dominance_threshold_dyad: 0.6,
  dominance_threshold_trio: 0.5,
  absence_threshold_rounds_default: 3,
  absence_threshold_rounds_overrides: {},
  brejo_pause_policy_trio: {
    sensory_saki: "partial",
    emotional_any: "full",
  },
  max_consecutive_bot_turns: 2,
};

/** Tipo de quem falou — "bot" é o drota; ou persona_id da criança. */
export const TURN_SPEAKER_TYPES = ["bot", "child"] as const;
export type TurnSpeakerType = (typeof TURN_SPEAKER_TYPES)[number];

/**
 * Entrada do histórico de turns. `round` é o ordinal da rodada
 * dentro da dinâmica (1-indexed; bot prompt + child responses
 * formam 1 round). `personaId` é o id quando type=child;
 * undefined/"bot" quando bot turn.
 */
export interface TurnHistoryEntry {
  /** 1-indexed; vários turns podem dividir o mesmo round. */
  round: number;
  /** "bot" pro drota, persona_id pra criança. */
  speakerType: TurnSpeakerType;
  /** Persona id quando speakerType=="child". Ignorado pro bot. */
  personaId?: string;
  /** ISO timestamp opcional (usado em silence_tolerance_seconds futuro). */
  timestamp?: string;
}

/**
 * Perfil mínimo de participante usado pelo runtime. Caller
 * extrai dos PersonaDef.profile.
 */
export interface TrioParticipant {
  /** Persona id (mesmo usado em TurnHistoryEntry.personaId). */
  personaId: string;
  /** Nome legível (pro drota endereçar). */
  name: string;
  /**
   * Strategy de autorregulação. "sensory" habilita partial-pause path
   * (§11.4). Saki default = "sensory"; Ryo/Kei = undefined.
   */
  regulation_strategy?: "sensory" | "emotional" | "cognitive";
  /**
   * Per-persona override do absence threshold. Saki=5; ausente →
   * usa absence_threshold_rounds_default do config.
   */
  silence_tolerance_rounds?: number;
}

/**
 * Sinal de brejo recebido do statusMatrix (ou equivalente). Caller
 * extrai do partnerStatusMatrix/groupStateMatrix e injeta.
 */
export interface BrejoSignal {
  personaId: string;
  /** "emotional" → full pause path; "sensory" → partial-Saki path. */
  type: "emotional" | "sensory";
}

/** Estado atual da dinâmica — input pra todas as decisões runtime. */
export interface TrioState {
  /** Modo do grupo — drive da escolha de thresholds. */
  mode: GroupMode;
  /** Participantes (2 em dyad, 3 em trio). */
  participants: TrioParticipant[];
  /** Histórico cronológico. Runtime tipicamente usa últimos N. */
  turnHistory: TurnHistoryEntry[];
  /** Sinais ativos de brejo (caller decide TTL). */
  brejoSignals: BrejoSignal[];
}

/** Categoria de warning emitido pelo runtime. */
export const TRIO_WARNING_KINDS = [
  "bot_ratio_exceeded",
  "consecutive_bot_turns_exceeded",
  "dominance_detected",
  "absence_detected",
] as const;
export type TrioWarningKind = (typeof TRIO_WARNING_KINDS)[number];

export interface TrioWarning {
  kind: TrioWarningKind;
  /** Persona id associada (dominador, silencioso, etc). */
  personaId?: string;
  /** Descrição legível pra log + debug. */
  reason: string;
  /** Métrica numérica relevante (ratio, rounds silentes, etc). */
  value?: number;
}

/** Tipo do próximo target sugerido pelo runtime. */
export const NEXT_SPEAKER_TARGETS = [
  "bot",
  "child",
  "pause_full",
  "pause_partial",
] as const;
export type NextSpeakerTarget = (typeof NEXT_SPEAKER_TARGETS)[number];

/**
 * Decisão composta. `nextSpeakerHint` pode ser bot ou um
 * persona_id específico (child). Pause states são terminais
 * — caller não chama LLM, espera signal externo.
 *
 * `excludedParticipants` lista personas que devem ser puladas
 * na próxima rodada (ex: Saki em sensory partial-pause).
 */
export interface TrioDecision {
  target: NextSpeakerTarget;
  /** Quando target=="child", id sugerido pro próximo turn. */
  nextSpeakerHint?: string;
  /** Personas que NÃO devem receber prompts no próximo turn. */
  excludedParticipants: string[];
  /** Warnings agregados pra logging + debug. */
  warnings: TrioWarning[];
  /**
   * Distribuição observada de turns (persona_id → count) — exposta
   * pra trace + downstream observability.
   */
  turnDistribution: Record<string, number>;
  /** Ratio observado de bot turns (0..1). */
  botTurnRatio: number;
}
