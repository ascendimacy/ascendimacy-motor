/**
 * Dreyfus level derivation — preenche `dreyfus_level_target` a partir de
 * signals existentes do ContentItem (type, sacrifice_amount, surprise,
 * rarity, verified).
 *
 * Spec ops#1015 G-01 (CASEL × Dreyfus × Gardner), Jun ratificado 2026-05-16.
 *
 * Heurística "challenge-curiosity protocol":
 * - `curiosity_hook`          → [novice, apprentice]      (introduz tópico)
 * - `cultural_diamond`        → [practitioner, proficient] (integração deeper)
 * - `challenge`               → [proficient, expert]      (active task)
 * - `card_catalog` por rarity (common→legendary mapeia novice→expert)
 * - `gtd_review`              → [practitioner, proficient] (reflection requires practice)
 * - `gtd_task` por estimated_minutes (≤10 leve, >30 pesado)
 * - `dynamic`                 → [apprentice, practitioner] (engagement intermediário)
 * - default conservative      → [novice, apprentice]      (cobre type ambíguo)
 *
 * Modifiers secundários (aplicados após baseline):
 * - sacrifice_amount ≥ 15  → tilt +1 step toward expert
 * - surprise low + verified → tilt -1 step toward novice (safety/intro)
 *
 * Função é pura e determinística: mesmo input ⇒ mesmo output. Idempotência
 * é responsabilidade do caller (migration script checa field undefined
 * antes de chamar).
 */

import {
  DREYFUS_LEVELS,
  type ContentItem,
  type DreyfusLevel,
} from "./content-item.js";

/** Threshold acima do qual sacrifice_amount conta como "high" (tilt up). */
const SACRIFICE_HIGH_THRESHOLD = 15;

/** Abaixo deste valor surprise é considerado "low" (tilt down se verified). */
const SURPRISE_LOW_THRESHOLD = 5;

/** Duração curta de gtd_task (≤ N min) ⇒ baseline novice-apprentice. */
const GTD_TASK_SHORT_MAX_MINUTES = 10;

/** Duração longa de gtd_task (> N min) ⇒ baseline proficient-expert. */
const GTD_TASK_LONG_MIN_MINUTES = 30;

function clampIndex(idx: number): number {
  if (idx < 0) return 0;
  if (idx > DREYFUS_LEVELS.length - 1) return DREYFUS_LEVELS.length - 1;
  return idx;
}

/** Move uma banda [from, to] N steps na escala Dreyfus, preservando largura. */
function shiftRange(
  range: [DreyfusLevel, DreyfusLevel],
  steps: number,
): [DreyfusLevel, DreyfusLevel] {
  const fromIdx = DREYFUS_LEVELS.indexOf(range[0]);
  const toIdx = DREYFUS_LEVELS.indexOf(range[1]);
  const newFrom = clampIndex(fromIdx + steps);
  const newTo = clampIndex(toIdx + steps);
  return [DREYFUS_LEVELS[newFrom], DREYFUS_LEVELS[newTo]];
}

/** Baseline por tipo + sub-discriminantes (rarity, estimated_minutes). */
function baselineForType(item: ContentItem): [DreyfusLevel, DreyfusLevel] {
  switch (item.type) {
    case "curiosity_hook":
      return ["novice", "apprentice"];
    case "cultural_diamond":
      return ["practitioner", "proficient"];
    case "challenge":
      return ["proficient", "expert"];
    case "card_catalog": {
      switch (item.rarity) {
        case "common":
          return ["novice", "apprentice"];
        case "rare":
          return ["apprentice", "practitioner"];
        case "epic":
          return ["practitioner", "proficient"];
        case "legendary":
          return ["proficient", "expert"];
        default:
          return ["novice", "apprentice"];
      }
    }
    case "gtd_review":
      return ["practitioner", "proficient"];
    case "gtd_task": {
      const minutes = item.estimated_minutes ?? 0;
      if (minutes <= GTD_TASK_SHORT_MAX_MINUTES) {
        return ["novice", "apprentice"];
      }
      if (minutes > GTD_TASK_LONG_MIN_MINUTES) {
        return ["proficient", "expert"];
      }
      return ["apprentice", "practitioner"];
    }
    case "dynamic":
      return ["apprentice", "practitioner"];
    default:
      // Defensive: type ambíguo / futuro não mapeado.
      return ["novice", "apprentice"];
  }
}

/**
 * Deriva dreyfus_level_target para um ContentItem.
 *
 * @param item ContentItem (qualquer subtype).
 * @returns Tuple [from, to] em DREYFUS_LEVELS.
 */
export function deriveDreyfusLevel(
  item: ContentItem,
): [DreyfusLevel, DreyfusLevel] {
  let range = baselineForType(item);

  // Modifier 1: sacrifice high ⇒ tilt +1 toward expert.
  if (
    typeof item.sacrifice_amount === "number" &&
    item.sacrifice_amount >= SACRIFICE_HIGH_THRESHOLD
  ) {
    range = shiftRange(range, +1);
  }

  // Modifier 2: surprise low + verified ⇒ tilt -1 toward novice (safety/intro).
  // Aplicado apenas se sacrifice modifier NÃO disparou — evita cancelamento.
  if (
    item.verified === true &&
    typeof item.surprise === "number" &&
    item.surprise < SURPRISE_LOW_THRESHOLD &&
    !(
      typeof item.sacrifice_amount === "number" &&
      item.sacrifice_amount >= SACRIFICE_HIGH_THRESHOLD
    )
  ) {
    range = shiftRange(range, -1);
  }

  return range;
}
