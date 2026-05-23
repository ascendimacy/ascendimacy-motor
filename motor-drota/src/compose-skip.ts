/**
 * S-T-10-09 (ops#1070): skip drota LLM composition quando item.content
 * (do menu) é rich enough pra servir direto como linguisticMaterialization.
 *
 * Precedente metodológico: motor#115 (S-T-10-08 rationale skip).
 *
 * Gating condicional (default OFF — opt-in via env):
 *   1. ASC_SKIP_DROTA_COMPOSITION === "true" (feature flag)
 *   2. item.domain === "action_menu" (veio do menu lookup, não fallback)
 *   3. extractMenuContent(item) length >= MIN_CONTENT_LEN (default 80)
 *   4. !item.is_critical (sub-decisão Jun: critical items merecem drota fresh)
 *
 * Quando todas as condições passam, server.ts bypass callLlm e emite
 * `linguisticMaterialization = extractMenuContent(item)` direto, salvando
 * 1 LLM call per-turn em hit path.
 *
 * Trade-off (Jun ratificou GO em motor#134):
 *   - Perde adaptação persona-specific contextual (ex: drota citaria
 *     "Kei + raquete + treino" pra Ryo). Aceitável dado producer S-T-10-08
 *     já emite items ancorados ao perfil.
 *   - Ganha -100% LLM calls em turn que hita menu.
 */

import type { ContentItem } from "@ascendimacy/shared";

/** Default mínimo de chars do content pra qualificar pra skip. */
export const DEFAULT_MIN_CONTENT_LEN = 80;

/** Field do ContentItem que carrega o item.content do menu (varia por type). */
export function extractMenuContent(item: ContentItem): string | null {
  switch (item.type) {
    case "curiosity_hook":
    case "cultural_diamond":
      return item.fact || null;
    case "challenge":
      return item.description || null;
    case "dynamic":
      return item.setup || null;
    default:
      return null;
  }
}

export interface SkipDecision {
  shouldSkip: boolean;
  reason: string;
  content?: string;
}

/**
 * Avalia se composition pode ser skipped. Pure function — testável sem mocks.
 *
 * @param item ContentItem selecionado pelo drota (após selectFromPool)
 * @param env env vars (process.env normalmente; injetável pra test)
 * @param minContentLen threshold de length (default DEFAULT_MIN_CONTENT_LEN)
 */
export function canSkipDrotaComposition(
  item: ContentItem,
  env: Record<string, string | undefined>,
  minContentLen: number = DEFAULT_MIN_CONTENT_LEN,
): SkipDecision {
  if (env["ASC_SKIP_DROTA_COMPOSITION"] !== "true") {
    return { shouldSkip: false, reason: "feature_flag_off" };
  }
  if (item.domain !== "action_menu") {
    return { shouldSkip: false, reason: "not_from_action_menu" };
  }
  // is_critical opcional (forward-compat; planejador propaga via reasons no
  // futuro — Sprint 3). Por ora, check field opcional se presente.
  const isCritical = (item as { is_critical?: boolean }).is_critical === true;
  if (isCritical) {
    return { shouldSkip: false, reason: "item_is_critical" };
  }
  const content = extractMenuContent(item);
  if (!content) {
    return { shouldSkip: false, reason: "no_extractable_content" };
  }
  if (content.length < minContentLen) {
    return {
      shouldSkip: false,
      reason: `content_too_short (${content.length} < ${minContentLen})`,
    };
  }
  return { shouldSkip: true, reason: "skip_eligible", content };
}
