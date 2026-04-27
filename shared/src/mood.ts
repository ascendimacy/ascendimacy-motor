/**
 * Mood — estado emocional absoluto da criança por turn/sessão.
 *
 * Escala (DT-MOOD-01, Jun 2026-04-27): integer 1-10. LLM-friendly
 * ("humor 5/10" lê bem em prompt). Comfort gate dispara em mood ≤ 3.
 *
 * Persistência: tabela `conversations.mood INT` via `MoodRepo` port
 * (concrete postgres adapter fica pra F1-bootstrap-db, ascendimacy-motor#40).
 *
 * Integration:
 *   - Producer (LLM extractor + fallback rule-based): motor-drota/src/mood-extractor.ts
 *     (DT-MOOD-02 = LLM v0 + fallback) — pendente de PR PART B.
 *   - Comfort gate (DT-MOOD-03): mood ≤ 3 ativa "mode aquecimento" (POC SessionMode);
 *     congela helix advance (alinhado com CLAUDE_6 §5.3 buffer day).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-27-statevector-primitives-inventory-f1.md §2
 * Sub-issue: ascendimacy-motor#35
 */

/** Escala canônica: integer 1 (péssimo) → 10 (excelente). */
export const MOOD_MIN = 1;
export const MOOD_MAX = 10;
/** Default neutral usado quando producer não rodou ainda (turn 1) ou falhou. */
export const MOOD_DEFAULT = 5;
/** Threshold do comfort gate. Mood ≤ COMFORT_GATE → mode aquecimento. */
export const COMFORT_GATE = 3;

/** Score de mood — integer 1-10. Type-aliased pra clareza em assinaturas. */
export type MoodScore = number;

/** Origem da leitura — útil pra trace/audit. */
export type MoodSource = "llm" | "rule_based" | "manual";

/** Uma leitura de mood — par (score, timestamp) + origem. */
export interface MoodReading {
  score: MoodScore;
  /** ISO 8601 UTC. */
  at: string;
  source: MoodSource;
}

/**
 * Janela móvel de mood — agregações pra usar em prompt context e
 * comfort gate. Ambos podem ser null se sem leituras na janela.
 */
export interface MoodWindow {
  /** Média das últimas 3 leituras (turns mais recentes). */
  recent3turns: number | null;
  /** Média das leituras dentro de 7 dias do `now` injetado. */
  recent7days: number | null;
  /** Leitura mais recente (latest), ou null se histórico vazio. */
  latest: MoodReading | null;
  /** Quantas leituras caíram na janela 7d (debug/trace). */
  countIn7Days: number;
}

/**
 * Type guard pra MoodScore. Aceita só integer no range [1,10].
 * Decimais e fora-do-range retornam false (defensivo contra LLM
 * que ocasionalmente devolve 7.5 ou 11).
 */
export function isMoodScore(v: unknown): v is MoodScore {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= MOOD_MIN &&
    v <= MOOD_MAX
  );
}

/**
 * Clampa um número arbitrário pro range [MOOD_MIN, MOOD_MAX].
 * Decimais são arredondados pro inteiro mais próximo. Útil quando
 * LLM devolve algo fora do schema esperado e queremos coerção
 * resiliente em vez de falha hard.
 */
export function clampMoodScore(v: number): MoodScore {
  if (!Number.isFinite(v)) return MOOD_DEFAULT;
  const rounded = Math.round(v);
  if (rounded < MOOD_MIN) return MOOD_MIN;
  if (rounded > MOOD_MAX) return MOOD_MAX;
  return rounded;
}

/** True se mood ativa o comfort gate (≤ COMFORT_GATE). */
export function triggersComfortGate(mood: MoodScore): boolean {
  return mood <= COMFORT_GATE;
}

/**
 * Computa MoodWindow a partir de histórico de leituras.
 *
 * - `recent3turns`: média das 3 leituras mais recentes (por timestamp desc).
 *   Se < 3 leituras existem, média do que tem. Null se vazio.
 * - `recent7days`: média de todas leituras com `at >= now - 7 days`.
 *   Null se nenhuma leitura cair na janela.
 * - `latest`: leitura mais recente.
 * - `countIn7Days`: count das leituras na janela 7d.
 *
 * `now` injetado pra determinismo em tests.
 */
export function computeMoodWindow(
  history: MoodReading[],
  now: string,
): MoodWindow {
  if (history.length === 0) {
    return {
      recent3turns: null,
      recent7days: null,
      latest: null,
      countIn7Days: 0,
    };
  }

  const sorted = [...history].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );

  const last3 = sorted.slice(0, 3);
  const recent3turns = average(last3.map((r) => r.score));

  const sevenDaysAgoMs =
    new Date(now).getTime() - 7 * 24 * 60 * 60 * 1000;
  const within7days = sorted.filter(
    (r) => new Date(r.at).getTime() >= sevenDaysAgoMs,
  );
  const recent7days =
    within7days.length > 0
      ? average(within7days.map((r) => r.score))
      : null;

  return {
    recent3turns,
    recent7days,
    latest: sorted[0]!,
    countIn7Days: within7days.length,
  };
}

function average(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const sum = scores.reduce((a, b) => a + b, 0);
  return sum / scores.length;
}

// ─────────────────────────────────────────────────────────────────────────
// Persistência — port (interface) + helpers
//
// Concrete adapter postgres em F1-bootstrap-db (ascendimacy-motor#40).
// In-memory adapter pra tests/STS em mood-repo-memory.ts.
// ─────────────────────────────────────────────────────────────────────────

/** Linha persistida da tabela `conversations` filtrada pras colunas de mood. */
export interface MoodReadingRow extends MoodReading {
  userId: string;
  /** Opcional — id da conversation/turn pra cross-reference no trace. */
  conversationId?: string;
}

/**
 * Port de persistência. Implementações concretas:
 *   - InMemory (testes + STS): mood-repo-memory.ts
 *   - Postgres (produção): F1-bootstrap-db
 */
export interface MoodRepo {
  /**
   * Carrega histórico ordenado por `at` desc.
   * - `limit`: pega só as N mais recentes.
   * - `since`: filtra leituras com `at >= since`.
   */
  loadHistory(
    userId: string,
    options?: { limit?: number; since?: string },
  ): Promise<MoodReadingRow[]>;
  /** Append nova leitura. */
  append(reading: MoodReadingRow): Promise<void>;
}
