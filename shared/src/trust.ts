/**
 * Trust — nível de confiança calibrado por sessões + mood + engagement.
 *
 * Formula (port direto de ebrota/src/kids/trust.js):
 *   score = (sessions × 2) + avgMood + avgEngagement
 *   score ≥ 30 → trusted (0.0...1.0 = 1.0)
 *   score ≥ 20 → warm    (≈ 0.67)
 *   score ≥ 10 → warming (≈ 0.33)
 *   score < 10 → cold    (0.0)
 *
 * SessionState.trustLevel (em types.ts) é o adapter 0-1; este módulo
 * expõe ambas representações (numeric pra motor + label pra consumers
 * que precisam vocabulário ebrota).
 *
 * Persistência: cache em `users.trust_level NUMERIC(3,2)` via `TrustRepo`
 * port (concrete postgres em F1-bootstrap-db, ascendimacy-motor#40).
 * Recalcular ocorre no fim da sessão (orchestrator), persiste o resultado.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-27-statevector-primitives-inventory-f1.md §1
 * Sub-issue: ascendimacy-motor#34
 * DT-TRUST-01: producer mora aqui (puro, reusável).
 */

/** Labels canônicas (port ebrota). */
export const TRUST_LEVELS = ["cold", "warming", "warm", "trusted"] as const;
export type TrustLabel = (typeof TRUST_LEVELS)[number];

/** Thresholds da formula (score >= threshold → label). */
export const TRUST_THRESHOLD_TRUSTED = 30;
export const TRUST_THRESHOLD_WARM = 20;
export const TRUST_THRESHOLD_WARMING = 10;

/**
 * Defaults pra inputs ausentes — matches ebrota behavior.
 * Novo user (sessions=0, sem mood/engagement) → score 10 → warming (0.33).
 * Decisão deliberada: assume média neutra quando sem dados, em vez de cold absoluto.
 */
export const DEFAULT_AVG_MOOD = 5;
export const DEFAULT_AVG_ENGAGEMENT = 5;

/** Profundidade conversacional adaptada ao trust label. */
export const DEPTH_LEVELS = ["light", "medium", "deep"] as const;
export type Depth = (typeof DEPTH_LEVELS)[number];

/**
 * Inputs pra calcular trust. Todos opcionais salvo `sessions` —
 * defaults ebrota aplicados em ausentes.
 */
export interface TrustInputs {
  /** Total de sessões completadas (session_end IS NOT NULL no kids_sessions equivalente). */
  sessions: number;
  /** Média mood recente — escala 1-10. Default DEFAULT_AVG_MOOD se ausente. */
  avgMood?: number;
  /** Média engagement (turn_count médio ou métrica derivada). Default DEFAULT_AVG_ENGAGEMENT. */
  avgEngagement?: number;
}

/**
 * Score bruto da formula ebrota: (sessions × 2) + avgMood + avgEngagement.
 * Retorna número ≥ 0.
 */
export function calculateTrustScore(inputs: TrustInputs): number {
  const sessions = inputs.sessions ?? 0;
  const avgMood = inputs.avgMood ?? DEFAULT_AVG_MOOD;
  const avgEngagement = inputs.avgEngagement ?? DEFAULT_AVG_ENGAGEMENT;
  return sessions * 2 + avgMood + avgEngagement;
}

/**
 * Mapeia score numérico pra label categórica.
 * Buckets: cold (< 10), warming (10-19), warm (20-29), trusted (≥ 30).
 */
export function trustLabelFromScore(score: number): TrustLabel {
  if (score >= TRUST_THRESHOLD_TRUSTED) return "trusted";
  if (score >= TRUST_THRESHOLD_WARM) return "warm";
  if (score >= TRUST_THRESHOLD_WARMING) return "warming";
  return "cold";
}

/**
 * Adapter pra escala numérica 0.0-1.0 que motor canonical
 * `SessionState.trustLevel` espera.
 *
 * Conversão: `score / TRUST_THRESHOLD_TRUSTED`, clampado em [0, 1].
 *
 * Mapping aproximado vs labels:
 *   cold     → 0.0 - 0.32
 *   warming  → 0.33 - 0.66
 *   warm     → 0.67 - 0.99
 *   trusted  → 1.0
 */
export function calculateTrustLevel(inputs: TrustInputs): number {
  const score = calculateTrustScore(inputs);
  const ratio = score / TRUST_THRESHOLD_TRUSTED;
  if (ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  return ratio;
}

/**
 * Adapta profundidade conversacional ao trust label (port ebrota).
 *
 * - cold/warming → light (perguntas curtas, baixa demanda)
 * - warm → medium (perguntas com follow-up)
 * - trusted → deep (provocações, scaffolding pedagógico)
 */
export function adaptDepth(label: TrustLabel): Depth {
  if (label === "cold" || label === "warming") return "light";
  if (label === "warm") return "medium";
  return "deep";
}

// ─────────────────────────────────────────────────────────────────────────
// Persistência — port (interface)
//
// Concrete adapter postgres fica em F1-bootstrap-db (motor#40).
// In-memory adapter pra tests/STS em trust-repo-memory.ts.
// ─────────────────────────────────────────────────────────────────────────

/** Linha persistida do cache de trust por user. */
export interface TrustCacheEntry {
  userId: string;
  level: number;
  /** ISO 8601 — quando o cálculo rodou (pra invalidação eventual). */
  calculatedAt: string;
}

/**
 * Port de persistência do cache de trust.
 * Implementações:
 *   - InMemory (testes + STS): trust-repo-memory.ts
 *   - Postgres (produção): F1-bootstrap-db
 */
export interface TrustRepo {
  /** Lê cache de trust do user. Retorna null se nunca calculado. */
  loadCachedLevel(userId: string): Promise<TrustCacheEntry | null>;
  /** Persiste cache. Idempotente (upsert). */
  saveCachedLevel(entry: TrustCacheEntry): Promise<void>;
}
