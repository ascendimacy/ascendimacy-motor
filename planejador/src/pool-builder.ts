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
import type { ContentItem } from "@ascendimacy/shared";
import { isContentItem } from "@ascendimacy/shared";

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
    // Bloco 2a v1 assume todos os items do seed são sensitivity=free implícito.
    // Refusal tracking (cooldown em nó refused) é Bloco 3+.
    return true;
  });
}
