/**
 * Repetition inquiry — protocolo conversacional pra decisão de repetição
 * (ops#1068, Jun ratificado 2026-05-14).
 *
 * Origem do reframe: ops#1066 (algorithmic 4-sub-signal classification) →
 * Jun pergunta "pergunta a opinião da criança?" — pivota pra drota perguntar
 * diretamente, alinhado a Brota Mestre §2.1 "humanos primeiro".
 *
 * Esta layer (planejador) faz APENAS detecção + decisão:
 * - Conta repetições recentes na window
 * - Decide SE drota deve perguntar (conjunção (i)-(vii))
 *
 * Quem pergunta de fato: motor-drota, ao receber `contextHints.repetition_inquiry`.
 * Quem parseia resposta: motor-drota/src/parse-repetition-answer.ts.
 *
 * Sub-decisões ratificadas (ops#1068 defaults aceitos 2026-05-14):
 *  1. Cap por sessão: 1 pergunta; cooldown 8 turns; gate ≥4 turns
 *  2. Skip explícito → default (b) "ir pra outro parecido"
 *  3. Joint mode → suprime sempre (joint_mode)
 *  4. Per-persona: profile.repetition_inquiry { enabled, threshold_repetitions, default_on_skip }
 *  5. Window: 20 turns ∧ 7 dias, o que for menor
 *  6. Items expirados: fora da opção (a)
 *  7. Parsing: literal regex (LLM stage v0.1 follow-up)
 *  8. Heurística trigger: conjunção (i)-(vii); brejo override absoluto
 */

import type { EventEntry } from "@ascendimacy/shared";

// ─── Defaults ────────────────────────────────────────────────────────────

/** Cap de inquiries por sessão (sub-decisão 1). */
export const DEFAULT_INQUIRY_CAP_PER_SESSION = 1;
/** Cooldown em turns desde a última inquiry (sub-decisão 1). */
export const DEFAULT_INQUIRY_COOLDOWN_TURNS = 8;
/** Gate: turn mínimo pra começar a perguntar (sub-decisão 1). */
export const DEFAULT_INQUIRY_TURN_GATE = 4;
/** Threshold mínimo de repetições no window pra trigger (sub-decisão 5). */
export const DEFAULT_REPETITION_THRESHOLD = 2;
/** Window: turns (sub-decisão 5). */
export const DEFAULT_WINDOW_TURNS = 20;
/** Window: dias (sub-decisão 5). */
export const DEFAULT_WINDOW_DAYS = 7;
/** Default on skip (sub-decisão 2). */
export const DEFAULT_ON_SKIP = "b" as const;

// ─── Profile schema (runtime, freeform) ──────────────────────────────────

/**
 * Configuração per-persona do protocolo (sub-decisão 4).
 *
 * Vive em `persona.profile.repetition_inquiry` (Record<string, unknown>
 * freeform — parse defensivo no extractProfileConfig).
 */
export interface RepetitionInquiryProfileConfig {
  /** Master switch. Default true (universal). Saki: false (autorregulação). */
  enabled?: boolean;
  /** Repetições mínimas pra disparar. Default 2. Saki: ∞ via enabled=false. */
  threshold_repetitions?: number;
  /** Default quando criança skipa ("tanto faz" / silêncio). Default "b". */
  default_on_skip?: "a" | "b" | "c";
}

export function extractProfileConfig(
  profile: Record<string, unknown> | undefined,
): RepetitionInquiryProfileConfig {
  const raw = profile?.["repetition_inquiry"];
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: RepetitionInquiryProfileConfig = {};
  if (typeof r["enabled"] === "boolean") out.enabled = r["enabled"];
  if (typeof r["threshold_repetitions"] === "number") {
    out.threshold_repetitions = r["threshold_repetitions"];
  }
  if (r["default_on_skip"] === "a" || r["default_on_skip"] === "b" || r["default_on_skip"] === "c") {
    out.default_on_skip = r["default_on_skip"];
  }
  return out;
}

// ─── Window extraction ───────────────────────────────────────────────────

export interface RepetitionWindowOptions {
  /** Now em ISO 8601. Default: Date.now(). */
  nowIso?: string;
  /** Window turns (default 20). */
  windowTurns?: number;
  /** Window dias (default 7). */
  windowDays?: number;
}

/**
 * Extrai contagem de repetições por content_id na window (20 turns ∧ 7d).
 *
 * Item conta como repetido se aparece como `selectedContentId` em
 * `playbook_executed` events dentro da janela.
 *
 * Window é AND: o que for MAIS RESTRITIVO entre 20 turns e 7 dias vale.
 * (sub-decisão 5: "20 turns ∧ 7 dias, o que for menor")
 */
export function extractRepetitionCounts(
  eventLog: ReadonlyArray<EventEntry>,
  options: RepetitionWindowOptions = {},
): Map<string, number> {
  const nowMs = options.nowIso ? Date.parse(options.nowIso) : Date.now();
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const windowTurns = options.windowTurns ?? DEFAULT_WINDOW_TURNS;
  const cutoffMs = nowMs - windowDays * 24 * 60 * 60 * 1000;

  // 1. Filter to playbook_executed events
  const executed = eventLog.filter((e) => e.type === "playbook_executed");

  // 2. Bound: last N events (turns proxy) AND timestamp >= cutoff
  //    "what is more restrictive" — both must hold
  const lastN = executed.slice(-windowTurns);
  const inWindow = lastN.filter((e) => {
    const ts = Date.parse(e.timestamp);
    return Number.isFinite(ts) && ts >= cutoffMs;
  });

  const counts = new Map<string, number>();
  for (const e of inWindow) {
    const data = e.data as { selectedContentId?: string | null } | undefined;
    const id = data?.selectedContentId;
    if (typeof id === "string" && id.length > 0) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

// ─── Decision: should drota ask? ─────────────────────────────────────────

export interface RepetitionInquiryDecisionInput {
  /** Profile config (parsed from persona.profile.repetition_inquiry). */
  profileConfig: RepetitionInquiryProfileConfig;
  /** Counts por content_id na window. */
  repetitionCounts: Map<string, number>;
  /** Turn atual da sessão. */
  turn: number;
  /** sessionMode atual ("solo" | "joint"). */
  sessionMode: "solo" | "joint";
  /** Há brejo afetivo ativo no statusMatrix? */
  brejoActive: boolean;
  /** Inquiries já feitas nesta sessão (extraído do eventLog). */
  inquiriesThisSession: number;
  /** Turns desde a última inquiry. Infinity se nunca. */
  turnsSinceLastInquiry: number;
  /** IDs do pool elegível (após filtros). Items expirados NÃO entram aqui. */
  eligiblePoolIds: ReadonlyArray<string>;
}

export interface RepetitionInquiryDecision {
  /** Drota deve perguntar? */
  ask: boolean;
  /** IDs candidatos a "opção (a) tentar de novo" — só items elegíveis (não-expirados) com count >= threshold. */
  candidateIds: string[];
  /** Threshold efetivo usado. */
  thresholdUsed: number;
  /** Default on skip propagado pra drota. */
  defaultOnSkip: "a" | "b" | "c";
  /** Reason quando ask=false (auditoria). */
  suppressedReason?:
    | "profile_disabled"
    | "cap_reached"
    | "cooldown"
    | "turn_too_early"
    | "joint_mode"
    | "brejo_active"
    | "no_pool_options";
}

/**
 * Decide se drota deve perguntar à criança sobre repetição.
 *
 * Conjunção (i)-(vii) — TODAS devem valer:
 *  (i)   profile.enabled !== false
 *  (ii)  inquiriesThisSession < cap
 *  (iii) turnsSinceLastInquiry >= cooldown
 *  (iv)  ∃ item no pool eligível com count >= threshold
 *  (v)   sessionMode === "solo"
 *  (vi)  !brejoActive  ← override absoluto
 *  (vii) turn >= gate
 *
 * Brejo (vi) sobrepõe tudo — perguntar em dor aguda é anti-padrão Brota §6.3.
 */
export function shouldAskRepetitionInquiry(
  input: RepetitionInquiryDecisionInput,
): RepetitionInquiryDecision {
  const cfg = input.profileConfig;
  const thresholdUsed = cfg.threshold_repetitions ?? DEFAULT_REPETITION_THRESHOLD;
  const defaultOnSkip = cfg.default_on_skip ?? DEFAULT_ON_SKIP;
  const candidateIds: string[] = [];

  // (i) profile_disabled — checa primeiro pra Saki + outros explicitamente off
  if (cfg.enabled === false) {
    return { ask: false, candidateIds, thresholdUsed, defaultOnSkip, suppressedReason: "profile_disabled" };
  }

  // (vi) brejo_active — override absoluto, checa cedo
  if (input.brejoActive) {
    return { ask: false, candidateIds, thresholdUsed, defaultOnSkip, suppressedReason: "brejo_active" };
  }

  // (v) joint_mode
  if (input.sessionMode === "joint") {
    return { ask: false, candidateIds, thresholdUsed, defaultOnSkip, suppressedReason: "joint_mode" };
  }

  // (vii) turn_too_early
  if (input.turn < DEFAULT_INQUIRY_TURN_GATE) {
    return { ask: false, candidateIds, thresholdUsed, defaultOnSkip, suppressedReason: "turn_too_early" };
  }

  // (ii) cap_reached
  if (input.inquiriesThisSession >= DEFAULT_INQUIRY_CAP_PER_SESSION) {
    return { ask: false, candidateIds, thresholdUsed, defaultOnSkip, suppressedReason: "cap_reached" };
  }

  // (iii) cooldown
  if (input.turnsSinceLastInquiry < DEFAULT_INQUIRY_COOLDOWN_TURNS) {
    return { ask: false, candidateIds, thresholdUsed, defaultOnSkip, suppressedReason: "cooldown" };
  }

  // (iv) pool tem item ≥ threshold + ainda elegível (não-expirado)
  const eligibleSet = new Set(input.eligiblePoolIds);
  for (const [id, count] of input.repetitionCounts) {
    if (count >= thresholdUsed && eligibleSet.has(id)) {
      candidateIds.push(id);
    }
  }
  if (candidateIds.length === 0) {
    return { ask: false, candidateIds, thresholdUsed, defaultOnSkip, suppressedReason: "no_pool_options" };
  }

  return { ask: true, candidateIds, thresholdUsed, defaultOnSkip };
}

// ─── Helpers pra plan.ts consumir eventLog ────────────────────────────────

/**
 * Conta inquiries já feitas nesta sessão.
 * Olha eventLog por type === "repetition_inquiry_asked".
 */
export function countInquiriesInSession(
  eventLog: ReadonlyArray<EventEntry>,
): number {
  return eventLog.filter((e) => e.type === "repetition_inquiry_asked").length;
}

/**
 * Turns desde a última inquiry. Conta playbook_executed events APÓS a
 * última repetition_inquiry_asked. Infinity se nunca.
 */
export function turnsSinceLastInquiry(
  eventLog: ReadonlyArray<EventEntry>,
): number {
  // Encontra index do último asked
  let lastIdx = -1;
  for (let i = eventLog.length - 1; i >= 0; i--) {
    if (eventLog[i]!.type === "repetition_inquiry_asked") {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx === -1) return Number.POSITIVE_INFINITY;
  // Conta playbook_executed depois disso
  let executed = 0;
  for (let i = lastIdx + 1; i < eventLog.length; i++) {
    if (eventLog[i]!.type === "playbook_executed") executed++;
  }
  return executed;
}
