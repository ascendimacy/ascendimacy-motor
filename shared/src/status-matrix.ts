/**
 * Status matrix — dimensões × valores (brejo/baia/pasto).
 *
 * Persistência (DT-STATUS-01, Jun 2026-04-27): tabela própria `status_matrix`
 * (override sobre comentário anterior que sugeria zone=status em tree_nodes).
 *
 * Invariantes:
 *   - Nunca pular brejo → pasto direto (precisa passar por baia).
 *   - emotional=brejo bloqueia emit de challenge em qualquer outra dimensão.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-27-statevector-primitives-inventory-f1.md §5
 * Referência: ebrota/src/kids/tree.js (padrão), FOUNDATION §17 (conceito).
 */

export const STATUS_VALUES = ["brejo", "baia", "pasto"] as const;
export type StatusValue = (typeof STATUS_VALUES)[number];

/**
 * Matrix é Record<dimension-key, StatusValue>. Dimension-keys são
 * strings semânticas (ver CANONICAL_DIMENSIONS) — não fixamos tipo
 * porque cognitive_<subject> e linguistic_<lang> são abertas.
 */
export type StatusMatrix = Record<string, StatusValue>;

/** Dimensões canônicas v1 — ordem define prioridade de CASEL focus. */
export const CANONICAL_DIMENSIONS = [
  "emotional",
  "social_with_ebrota",
  "social_with_parent",
  "social_with_sibling",
  // cognitive_<subject> e linguistic_<lang> são abertas; exemplo só:
  "cognitive_math",
  "cognitive_science",
  "linguistic_ja",
  "linguistic_pt_br",
] as const;

export function isStatusValue(v: unknown): v is StatusValue {
  return typeof v === "string" && STATUS_VALUES.includes(v as StatusValue);
}

/** Matrix default (tudo baia) — usado em turn 1 sem onboarding. */
export function defaultMatrix(): StatusMatrix {
  const m: StatusMatrix = {};
  for (const dim of CANONICAL_DIMENSIONS) {
    m[dim] = "baia";
  }
  return m;
}

/** Retorna `true` se todas as entradas da matrix são StatusValue válidas. */
export function isStatusMatrix(v: unknown): v is StatusMatrix {
  if (!v || typeof v !== "object") return false;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length === 0) return false;
    if (!isStatusValue(val)) return false;
  }
  return true;
}

/**
 * Resultado de uma tentativa de transição.
 * - applied: o valor efetivamente aplicado (pode divergir do target se inválido)
 * - accepted: true se o target foi aceito; false se foi ajustado pela invariante
 * - reason: string legível (para logs e trace)
 */
export interface TransitionResult {
  applied: StatusValue;
  accepted: boolean;
  reason: string;
}

/**
 * Aplica uma transição respeitando a invariante brejo → baia → pasto.
 *
 * Regras:
 *   - undefined (primeira medição) → target aceito.
 *   - target === current → no-op aceito.
 *   - brejo → pasto: rejeitado, força baia.
 *   - pasto → brejo: rejeitado, força baia (mesma invariante reversa —
 *     fica mais forte pela sugestão da spec: transições não pulam).
 *   - demais transições (baia→brejo, baia→pasto, brejo→baia, pasto→baia): aceitas.
 */
export function transition(
  current: StatusValue | undefined,
  target: StatusValue,
): TransitionResult {
  if (current === undefined) {
    return { applied: target, accepted: true, reason: "first_set" };
  }
  if (current === target) {
    return { applied: target, accepted: true, reason: "no_op" };
  }
  const pair = `${current}->${target}`;
  if (pair === "brejo->pasto" || pair === "pasto->brejo") {
    return {
      applied: "baia",
      accepted: false,
      reason: `invariant_skip (${pair}) — forced baia`,
    };
  }
  return { applied: target, accepted: true, reason: `transition ${pair}` };
}

export interface GateResult {
  ok: boolean;
  reason?: string;
}

/**
 * Pode emitir challenge para `dimension` dado o estado atual da matrix?
 *
 * Invariantes:
 *   - emotional=brejo → bloqueia TODAS as dimensões não-emotional.
 *   - dimension=brejo → desafio suave only (ok=false com reason).
 *   - dimension=baia → ok.
 *   - dimension=pasto → ok.
 *   - dimension ausente na matrix → tratado como default(baia) → ok.
 */
export function canEmitChallenge(
  matrix: StatusMatrix,
  dimension: string,
): GateResult {
  const emotional = matrix["emotional"];
  if (emotional === "brejo" && dimension !== "emotional") {
    return { ok: false, reason: "emotional_brejo_blocks_all" };
  }
  const current = matrix[dimension] ?? "baia";
  if (current === "brejo") {
    return { ok: false, reason: `${dimension}_brejo_needs_repair` };
  }
  return { ok: true };
}

/**
 * Devolve status_gates map para injetar em contextHints.
 * Chave: dimension. Valor: GateResult.
 */
export function allGates(matrix: StatusMatrix): Record<string, GateResult> {
  const out: Record<string, GateResult> = {};
  for (const dim of Object.keys(matrix)) {
    out[dim] = canEmitChallenge(matrix, dim);
  }
  return out;
}

/**
 * Escolhe a dimensão de CASEL focus.
 *
 * Ordem de prioridade (v2, plano §4.9):
 *   1. Qualquer dimensão em brejo (mais crítico primeiro).
 *   2. Qualquer dimensão em baia.
 *   3. Pasto (último recurso — tudo fluindo).
 *
 * Dentro do mesmo status, a ordem segue CANONICAL_DIMENSIONS:
 *   emotional → social_with_ebrota → social_with_parent → social_with_sibling
 *     → cognitive_* → linguistic_*
 *
 * Retorna string (key) ou undefined se matrix vazia.
 */
export function pickFocusDimension(matrix: StatusMatrix): string | undefined {
  const entries = Object.entries(matrix);
  if (entries.length === 0) return undefined;

  const byPriority = [...entries].sort(([aKey, aVal], [bKey, bVal]) => {
    const order: Record<StatusValue, number> = { brejo: 0, baia: 1, pasto: 2 };
    const diff = order[aVal] - order[bVal];
    if (diff !== 0) return diff;
    return canonicalOrder(aKey) - canonicalOrder(bKey);
  });

  return byPriority[0]?.[0];
}

function canonicalOrder(key: string): number {
  const idx = (CANONICAL_DIMENSIONS as readonly string[]).indexOf(key);
  if (idx >= 0) return idx;
  // Keys abertas (cognitive_<x>, linguistic_<x>) vão para o final.
  if (key.startsWith("cognitive_")) return 100;
  if (key.startsWith("linguistic_")) return 200;
  return 500;
}

// ─────────────────────────────────────────────────────────────────────────
// Persistência — port (interface) + funções de hidratação/persistência
//
// Concrete adapter postgres fica em F1-bootstrap-db (sub-issue separada).
// In-memory adapter pra tests/STS vive em status-matrix-repo-memory.ts.
// ─────────────────────────────────────────────────────────────────────────

/** Linha persistida da tabela `status_matrix`. */
export interface StatusMatrixEntry {
  userId: string;
  dimension: string;
  status: StatusValue;
  /** ISO 8601 timestamp da última transição registrada. */
  lastTransitionAt: string;
}

/**
 * Port de persistência. Implementações concretas:
 *   - InMemory (testes + STS): status-matrix-repo-memory.ts
 *   - Postgres (produção): F1-bootstrap-db (a criar)
 */
export interface StatusMatrixRepo {
  /** Carrega todas as entries de um user. Vazio se sem registros. */
  loadAll(userId: string): Promise<StatusMatrixEntry[]>;
  /** Insere ou atualiza. Chave composta (userId, dimension). */
  upsert(entry: StatusMatrixEntry): Promise<void>;
}

/**
 * Hidrata `StatusMatrix` lendo todas as rows de um user no repo.
 * Retorna matrix vazia se user não tem registros (orchestrator de sessão
 * decide se aplica `defaultMatrix()` por cima).
 */
export async function hydrateFromDb(
  userId: string,
  repo: StatusMatrixRepo,
): Promise<StatusMatrix> {
  const rows = await repo.loadAll(userId);
  const matrix: StatusMatrix = {};
  for (const row of rows) {
    matrix[row.dimension] = row.status;
  }
  return matrix;
}

/**
 * Aplica + persiste uma transição respeitando a invariante
 * brejo → baia → pasto. Persiste o que `transition()` decidiu aplicar
 * (que pode divergir do target solicitado se inválido).
 *
 * Retorna o `TransitionResult` pra inspeção/log do chamador.
 */
export async function persistTransition(
  userId: string,
  dimension: string,
  target: StatusValue,
  repo: StatusMatrixRepo,
  options: { now?: () => string } = {},
): Promise<TransitionResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const existing = await repo.loadAll(userId);
  const current = existing.find((e) => e.dimension === dimension)?.status;
  const result = transition(current, target);
  await repo.upsert({
    userId,
    dimension,
    status: result.applied,
    lastTransitionAt: now(),
  });
  return result;
}

/** Mapa dimensão → CASEL dimension(s) (plano §4.9 v2). */
export const CASEL_FROM_DIMENSION: Record<string, string[]> = {
  emotional: ["SA", "SM"],
  social_with_ebrota: ["REL"],
  social_with_parent: ["SOC", "REL"],
  social_with_sibling: ["SOC", "REL"],
};

/**
 * Devolve as CASEL dimensions associadas a uma dimension key.
 * cognitive_* → DM; linguistic_* → REL.
 */
export function caselTargetsFor(dimension: string): string[] {
  if (CASEL_FROM_DIMENSION[dimension]) return CASEL_FROM_DIMENSION[dimension];
  if (dimension.startsWith("cognitive_")) return ["DM"];
  if (dimension.startsWith("linguistic_")) return ["REL"];
  return [];
}
