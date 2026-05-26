/**
 * DiscoveryWriter + BoundaryEventWriter — extraction logic.
 *
 * Spec: 2026-05-25-subject-knowledge-bridge.md §4.2 e §4.3.
 *
 * Pure functions: recebem contexto do turn + signals, retornam
 * SubjectKnowledgeEntry[] prontos pra inclusão no trace JSON.
 * Persistência fica a cargo do BFF scanner (lê trace → upserta SQLite).
 *
 * Fase 2: heurística regex/keyword (v1). Fase 5+ pode evoluir pra
 * embeddings / LLM-as-judge.
 */

import type {
  SubjectKnowledgeEntry,
  SubjectKnowledgeAlignment,
} from "./subject-knowledge.js";

// ─────────────────────────────────────────────────────────────────
// DiscoveryWriter — interest / value / need / discovery
// ─────────────────────────────────────────────────────────────────

export interface DiscoveryWriterInput {
  /** ID do sujeito (persona_id na v1). */
  subjectId: string;
  /** ID da sessão atual. */
  sessionId: string;
  /** Turn ref no formato sessionId__turn_N. */
  turnRef: string;
  /** Última mensagem da persona. */
  lastUserMessage: string;
  /** Signals já extraídos pelo assessor (informativo). */
  signals?: string[];
  /** Mood opcional pra calibrar confidence. */
  mood?: number;
  /**
   * PR 2 tracer — threshold de confidence ajustável por fase.
   * Entries com confidence < minConfidence são suprimidas.
   * Default: 0 (sem filtro — preserva comportamento atual).
   *
   * Uso típico:
   *  - ice_breaker → 0.4 (agressivo, captura sinais frágeis)
   *  - challenge_execute → 0.6 (normal)
   *  - follow_up → 0.7 (conservador, só sinais fortes)
   */
  minConfidence?: number;
}

const INTEREST_PATTERNS: Array<{ re: RegExp; intensity: "low" | "mid" | "high" }> = [
  // Português
  { re: /\b(?:eu\s+)?(?:adoro|amo)\s+([^.,;!?\n]+)/i, intensity: "high" },
  { re: /\b(?:eu\s+)?gosto\s+(?:muito\s+)?de\s+([^.,;!?\n]+)/i, intensity: "mid" },
  { re: /\bsou\s+(?:muito\s+)?(?:fã|f[aã]\s+declarado)\s+de\s+([^.,;!?\n]+)/i, intensity: "high" },
  { re: /\bcurto\s+([^.,;!?\n]+)/i, intensity: "mid" },
  { re: /\b(?:meu|minha)\s+favorito\s+(?:é|eh)\s+([^.,;!?\n]+)/i, intensity: "high" },
  { re: /\binteresso?\s+(?:por|em)\s+([^.,;!?\n]+)/i, intensity: "mid" },
];

const VALUE_PATTERNS: Array<{ re: RegExp; label_extract: (m: RegExpMatchArray) => string }> = [
  { re: /\bacho\s+(?:que\s+)?([^.,;!?\n]+\s+(?:é|eh|importa|conta|vale))/i, label_extract: (m) => m[1].trim() },
  { re: /\bpra\s+mim\s+(?:o\s+)?(?:que\s+)?(?:mais\s+)?importa\s+(?:é|eh)?\s*([^.,;!?\n]+)/i, label_extract: (m) => m[1].trim() },
];

const NEED_PATTERNS: Array<{ re: RegExp }> = [
  { re: /\bqueria\s+(?:muito\s+)?(?:que|poder)\s+[^.,;!?\n]+/i },
  { re: /\bprecisava\s+(?:muito\s+)?([^.,;!?\n]+)/i },
];

/**
 * Extrai descobertas (interest/value/need/discovery) da última mensagem
 * da persona. Usa heurística regex em pt-BR. Não chama LLM.
 *
 * Retorna array vazio se nada novo detectado — caller filtra duplicatas
 * cross-turn antes de persistir (responsabilidade do scanner BFF).
 */
export function extractDiscoveries(
  input: DiscoveryWriterInput,
): SubjectKnowledgeEntry[] {
  const out: SubjectKnowledgeEntry[] = [];
  const msg = input.lastUserMessage.trim();
  if (msg.length === 0) return out;

  // Interests
  for (const pat of INTEREST_PATTERNS) {
    const m = msg.match(pat.re);
    if (m && m[1]) {
      const label = m[1].trim().replace(/[.,;!?]+$/, "");
      if (label.length === 0 || label.length > 80) continue;
      out.push(
        makeEntry({
          subjectId: input.subjectId,
          sessionId: input.sessionId,
          turnRef: input.turnRef,
          type: "interest",
          source: "self_declared",
          confidence: pat.intensity === "high" ? 0.9 : 0.7,
          payload: {
            kind: "interest",
            label,
            evidence_phrase: msg.slice(0, 200),
            intensity: pat.intensity,
          },
        }),
      );
    }
  }

  // Values
  for (const pat of VALUE_PATTERNS) {
    const m = msg.match(pat.re);
    if (m) {
      const label = pat.label_extract(m).replace(/[.,;!?]+$/, "");
      if (label.length === 0 || label.length > 100) continue;
      out.push(
        makeEntry({
          subjectId: input.subjectId,
          sessionId: input.sessionId,
          turnRef: input.turnRef,
          type: "value",
          source: "self_declared",
          confidence: 0.55,
          payload: {
            kind: "value",
            label,
            evidence_phrase: msg.slice(0, 200),
          },
        }),
      );
    }
  }

  // Needs
  for (const pat of NEED_PATTERNS) {
    const m = msg.match(pat.re);
    if (m) {
      const label = (m[1] ?? m[0]).trim().replace(/[.,;!?]+$/, "");
      if (label.length === 0 || label.length > 100) continue;
      out.push(
        makeEntry({
          subjectId: input.subjectId,
          sessionId: input.sessionId,
          turnRef: input.turnRef,
          type: "need",
          source: "self_declared",
          confidence: 0.5,
          payload: {
            kind: "need",
            label,
          },
        }),
      );
    }
  }

  // PR 2 tracer — filtra por threshold de confidence quando aplicado.
  if (input.minConfidence !== undefined && input.minConfidence > 0) {
    return out.filter((e) => e.confidence >= input.minConfidence!);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// BoundaryEventWriter — registra boundary respeitada
// ─────────────────────────────────────────────────────────────────

export type BoundarySignalType =
  | "deflection_thematic"
  | "gatekeeper_resistance"
  | "frame_rejection"
  | "distress_marker_low"
  | "distress_marker_high"
  | "exit_marker_implicit"
  | "exit_marker_explicit"
  | "mood_drift_down";

const BOUNDARY_SIGNAL_SET: ReadonlySet<string> = new Set<BoundarySignalType>([
  "deflection_thematic",
  "gatekeeper_resistance",
  "frame_rejection",
  "distress_marker_low",
  "distress_marker_high",
  "exit_marker_implicit",
  "exit_marker_explicit",
  "mood_drift_down",
]);

export interface BoundaryEventWriterInput {
  subjectId: string;
  sessionId: string;
  turnRef: string;
  /** Signals do assessor — apenas os boundary_* são processados. */
  signals: string[];
  /** Tema/categoria abstraída do turn corrente (não conteúdo literal).
   * Caller é responsável pela abstração — se vazio, fica "indefinido".
   */
  topicCategory?: string;
  /** Como o motor respondeu. */
  motorResponse?: "muda_tema" | "suaviza" | "recua_total" | "outro";
}

/**
 * Extrai boundary_events do turn atual baseado nos signals do assessor.
 *
 * v1: severity_band sempre 'routine'. Detecção de 'clinical_signal'
 * (padrão recorrente) fica a cargo do scanner BFF / view agregada,
 * que tem acesso ao histórico cross-session.
 */
export function extractBoundaryEvents(
  input: BoundaryEventWriterInput,
): SubjectKnowledgeEntry[] {
  const out: SubjectKnowledgeEntry[] = [];
  for (const signalRaw of input.signals) {
    if (!BOUNDARY_SIGNAL_SET.has(signalRaw)) continue;
    const signalType = signalRaw as BoundarySignalType;
    const intensity = signalIntensity(signalType);
    const motorResponse = input.motorResponse ?? inferMotorResponse(signalType);
    out.push(
      makeEntry({
        subjectId: input.subjectId,
        sessionId: input.sessionId,
        turnRef: input.turnRef,
        type: "boundary_event",
        source: "motor_inferred",
        confidence: 0.85,
        alignment: "unknown",
        payload: {
          kind: "boundary_event",
          signal_type: signalType,
          topic_category: input.topicCategory ?? "indefinido",
          intensity,
          motor_response: motorResponse,
          severity_band: "routine",
        },
      }),
    );
  }
  return out;
}

function signalIntensity(s: BoundarySignalType): "low" | "mid" | "high" {
  switch (s) {
    case "distress_marker_high":
    case "exit_marker_explicit":
      return "high";
    case "distress_marker_low":
    case "frame_rejection":
    case "deflection_thematic":
      return "mid";
    default:
      return "low";
  }
}

function inferMotorResponse(
  s: BoundarySignalType,
): "muda_tema" | "suaviza" | "recua_total" | "outro" {
  switch (s) {
    case "exit_marker_explicit":
    case "distress_marker_high":
      return "recua_total";
    case "deflection_thematic":
      return "muda_tema";
    case "gatekeeper_resistance":
    case "frame_rejection":
      return "suaviza";
    default:
      return "outro";
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

interface MakeEntryInput {
  subjectId: string;
  sessionId: string;
  turnRef: string;
  type: SubjectKnowledgeEntry["type"];
  source: SubjectKnowledgeEntry["source"];
  confidence: number;
  alignment?: SubjectKnowledgeAlignment;
  payload: SubjectKnowledgeEntry["payload"];
}

function makeEntry(i: MakeEntryInput): SubjectKnowledgeEntry {
  return {
    id: `sk-${i.subjectId}-${i.turnRef}-${i.type}-${randomTag()}`,
    subject_id: i.subjectId,
    type: i.type,
    source: i.source,
    confidence: i.confidence,
    confirmed_at: i.source === "self_declared" ? i.turnRef : null,
    alignment: i.alignment ?? "unknown",
    payload: i.payload,
    turn_ref: i.turnRef,
    session_id: i.sessionId,
    created_at: new Date().toISOString(),
  };
}

function randomTag(): string {
  return Math.random().toString(36).slice(2, 8);
}
