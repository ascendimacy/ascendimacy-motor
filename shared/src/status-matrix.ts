/**
 * Status matrix — dimensões × valores (brejo/baia/pasto).
 *
 * Persistência: tabela `tree_nodes` com `zone='status'` e `key=<dimension>`
 * (override Jun 2026-04-24 sobre plano §4.7 v1 — ver plano v2 §2.C).
 *
 * Invariantes:
 *   - Nunca pular brejo → pasto direto (precisa passar por baia).
 *   - emotional=brejo bloqueia emit de challenge em qualquer outra dimensão.
 *
 * Spec: docs/handoffs/2026-04-24-cc-bloco2-plan.md §2.C + §4 (v2).
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
