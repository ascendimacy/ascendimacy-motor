/**
 * Evaluate — Bloco 2a.
 *
 * Planejador já scorou o pool. Motor-drota recebe `contentPool` pronto,
 * precisa apenas selecionar (selectFromPool) e materializar linguisticamente.
 *
 * Nota: a lógica antiga `scoreActions` (multiplicava por trustWeight etc)
 * saiu. Scoring é responsabilidade única do planejador agora.
 */

import type { ScoredContentItem } from "@ascendimacy/shared";

/**
 * Reordena só por garantia — planejador já devolve ordenado, mas o
 * pool pode ter sido mutado pelo MCP serialization.
 */
export function rankPool(pool: ScoredContentItem[]): ScoredContentItem[] {
  return [...pool].sort((a, b) => b.score - a.score);
}
