/**
 * Pool builder — carrega o seed de content items e aplica elegibilidade.
 *
 * Spec: docs/handoffs/2026-04-24-cc-bloco2-plan.md §2.A v2.
 * Referência pro filtro: ebrota/src/kids/tree.js:159-169 (prioritizedNodes).
 *
 * Função pura — I/O de disco isolado em `loadSeedPool`.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentItem, ScoredContentItem } from "@ascendimacy/shared";
import {
  BUDGET_EXHAUSTED_MAX_SACRIFICE,
  isContentItem,
  isItemAllowedUnderBudgetExhaustion,
} from "@ascendimacy/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Caminho default do seed (relativo ao repo root). */
export const DEFAULT_SEED_PATH = join(
  __dirname,
  "../../content/hooks/seed.json",
);

/** Carrega pool do disco. Throws se arquivo ausente ou malformado. */
export function loadSeedPool(path?: string): ContentItem[] {
  const target = path ?? DEFAULT_SEED_PATH;
  const raw = readFileSync(target, "utf-8");
  const parsed = JSON.parse(raw) as unknown[];
  if (!Array.isArray(parsed)) {
    throw new Error(`Seed at ${target} is not an array`);
  }
  return parsed.filter(isContentItem);
}

export interface PoolFilterOptions {
  /** Idade da criança — gate duro; items fora da faixa caem fora. */
  age: number;
  /**
   * Modo da sessão. Se `joint`, só items com `group_compatible=true`.
   * v1 default é `1v1` (Bloco 6 adotará `joint`).
   */
  sessionMode?: "1v1" | "joint" | "cross_sibling";
  /**
   * Filtro de sensibilidade — v1 permite só sensitivity=free.
   * Ver plan v2 §4.11 (refusal tracking é Bloco 3+).
   */
  allowProtected?: boolean;
  /**
   * G-22 pool-builder integration (ops#1093 — follow-up motor#130).
   *
   * Quando true, aplica HARD GATE em budget exhausted: items com
   * `sacrifice_amount > BUDGET_EXHAUSTED_MAX_SACRIFICE (7)` caem fora ANTES
   * de chegar no drota. Items sem `sacrifice_amount` usam BASE_EFFORT_DEFAULT
   * (8) como fallback — passam o gate apenas se 8 ≤ 7 = false (filtrados).
   *
   * CC default Jun 2026-05-16, aguardando ratify ops#1093 sub-decisão 2:
   *   (A) Soft penalty -50 em score (não exclui — backstop)
   *   (B) Hard filter — CC default (alinhado canon DELTA §D24 "modo mínimo forçado")
   *
   * Caller responsabilidade: setar true quando `isExhausted(state)` retornar
   * true. Pool-builder não decide budget — recebe o flag pré-computado pra
   * manter função pura.
   */
  budgetExhaustedGate?: boolean;
}

/**
 * Aplica elegibilidade estática sobre o pool. NÃO scora.
 * Scoring é responsabilidade do `scoreItem` de @ascendimacy/shared.
 */
export function buildPool(
  pool: ContentItem[],
  opts: PoolFilterOptions,
): ContentItem[] {
  return pool.filter((item) => {
    // Idade — gate duro.
    if (opts.age < item.age_range[0] || opts.age > item.age_range[1]) {
      return false;
    }
    // Joint mode exige group_compatible.
    if (opts.sessionMode === "joint" && !item.group_compatible) {
      return false;
    }
    // G-22 (ops#1093): budget exhausted hard gate.
    // Reusa `isItemAllowedUnderBudgetExhaustion` de sacrifice-budget pra
    // manter single source of truth do threshold (BUDGET_EXHAUSTED_MAX_SACRIFICE=7).
    if (opts.budgetExhaustedGate && !isItemAllowedUnderBudgetExhaustion(item)) {
      return false;
    }
    // Bloco 2a v1 assume todos os items do seed são sensitivity=free implícito.
    // Refusal tracking (cooldown em nó refused) é Bloco 3+.
    return true;
  });
}

/** Re-export pra callers que precisam do threshold sem ir até sacrifice-budget. */
export { BUDGET_EXHAUSTED_MAX_SACRIFICE };

/** Options pra slicePoolForDrota — char budget + max items. */
export interface SliceOptions {
  /** Máximo de items que vão pro drota (default 7). */
  maxItems?: number;
  /** Budget de caracteres pra serialização inteira (default 2000). */
  maxTotalChars?: number;
  /** Se true (default), filtra items com score ≤ 0 (used_in_session penalty). */
  excludeUsedInSession?: boolean;
}

/**
 * Estima caracteres da serialização de um ScoredContentItem (apenas campos
 * relevantes pra prompt do drota). Heurística — não precisa ser exato.
 */
function estimateItemChars(scored: ScoredContentItem): number {
  const item = scored.item;
  let n = 0;
  n += item.id.length + 16;            // "id:" + separadores
  n += item.type.length + 8;
  n += item.domain.length + 8;
  n += JSON.stringify(item.casel_target).length + 16;
  n += (item.gardner_channels ? JSON.stringify(item.gardner_channels).length : 0) + 16;
  // Curiosity hook fields (presentes em todos os 85 items do seed atual)
  const fact = (item as { fact?: string }).fact ?? "";
  const bridge = (item as { bridge?: string }).bridge ?? "";
  const quest = (item as { quest?: string }).quest ?? "";
  n += fact.length + bridge.length + quest.length;
  return n;
}

/**
 * motor#25 (handoff #24 Tarefa 1): slim pool antes de mandar pro drota.
 *
 * Razão: análise smoke-3d mostrou content_pool ~4400 chars no prompt drota,
 * ~1100 tokens consumidos só de pool, 12 calls × ~1100 = recurring waste.
 *
 * Workflow:
 *   1. Filtra items com score ≤ 0 (used_in_session penalty já marcou)
 *   2. Slice top-K (default 7)
 *   3. Se serialização excede maxTotalChars, trunca campos (fact/bridge/quest)
 *      item-por-item até bater orçamento. Mantém id+type+casel+gardner intactos.
 *
 * **Por que no planejador, não no drota**: drota é executor, não ranker.
 * Planejador tem contexto pra decidir quem entra. Pool slim que chega no drota
 * é o que vale.
 *
 * Spec: docs/handoffs/2026-04-25-cc-motor-19-followup.md Tarefa 1.
 */
export function slicePoolForDrota(
  pool: ScoredContentItem[],
  options: SliceOptions = {},
): ScoredContentItem[] {
  const maxItems = options.maxItems ?? 7;
  const maxTotalChars = options.maxTotalChars ?? 2000;
  const excludeUsedInSession = options.excludeUsedInSession ?? true;

  // 1. Filtra items penalizados (score ≤ 0).
  let filtered = excludeUsedInSession ? pool.filter((s) => s.score > 0) : pool;
  // 2. Slice top-K.
  filtered = filtered.slice(0, maxItems);
  // 3. Char budget: se excede, trunca progressivamente.
  let total = filtered.reduce((acc, s) => acc + estimateItemChars(s), 0);
  if (total <= maxTotalChars) return filtered;

  // Trunca campos longos preservando id/type/casel/gardner intactos.
  // Estratégia: trunca fact (maior tipicamente), depois bridge, depois quest.
  // Itera dos últimos pros primeiros — itens top-rank sofrem menos.
  const result = filtered.map((s) => ({ ...s, item: { ...s.item } }));
  const limits: Array<{ name: "fact" | "bridge" | "quest"; max: number }> = [
    { name: "fact", max: 100 },
    { name: "bridge", max: 80 },
    { name: "quest", max: 60 },
  ];
  for (let i = result.length - 1; i >= 0 && total > maxTotalChars; i--) {
    const it = result[i]!.item as { fact?: string; bridge?: string; quest?: string };
    for (const { name, max } of limits) {
      if (total <= maxTotalChars) break;
      const original = it[name];
      if (original && original.length > max) {
        total -= original.length;
        it[name] = original.slice(0, max) + "...";
        total += it[name]!.length;
      }
    }
  }
  return result;
}
