/**
 * Content item — unidade atômica de conteúdo do motor eBrota v1.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-24-materialization-strategy.md §3.2
 * Handoff #17 Bloco 1.1.
 *
 * Playbook é deploy profile (YAML). Content é unidade atômica.
 * O drota nunca inventa — sempre ancora em um item do pool scorado.
 */

export const CONTENT_ITEM_TYPES = [
  "curiosity_hook",
  "cultural_diamond",
  "card_catalog",
  "gtd_review",
  "gtd_task",
  "dynamic",
  "challenge",
] as const;

export type ContentItemType = (typeof CONTENT_ITEM_TYPES)[number];

export const CASEL_DIMENSIONS = ["SA", "SM", "SOC", "REL", "DM"] as const;
export type CaselDimension = (typeof CASEL_DIMENSIONS)[number];

export const GARDNER_CHANNELS = [
  "linguistic",
  "logical_mathematical",
  "spatial",
  "musical",
  "bodily_kinesthetic",
  "interpersonal",
  "intrapersonal",
  "naturalist",
  "existential",
] as const;
export type GardnerChannel = (typeof GARDNER_CHANNELS)[number];

export const SACRIFICE_TYPES = [
  "reflect",
  "create",
  "act",
  "share",
  "observe",
] as const;
export type SacrificeType = (typeof SACRIFICE_TYPES)[number];

export const CARD_RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type CardRarity = (typeof CARD_RARITIES)[number];

export const GTD_REVIEW_KINDS = [
  "biweekly_seed",
  "weekly_grow",
  "cycle_end",
  "quarterly",
  "express",
  "book_lens",
] as const;
export type GtdReviewKind = (typeof GTD_REVIEW_KINDS)[number];

/** Campos comuns a qualquer tipo de content item. */
export interface ContentItemBase {
  id: string;
  type: ContentItemType;
  domain: string;
  casel_target: CaselDimension[];
  gardner_channels?: GardnerChannel[];
  age_range: [number, number];
  surprise: number;
  verified: boolean;
  base_score: number;

  /** Dinâmico por criança — resultante do histórico de uso. */
  times_used?: number;
  last_used_at?: string | null;
  avg_engagement?: number | null;

  /** Pin parental — quando true, score máximo, sem decay. */
  parent_pinned?: boolean;
  pinned_until?: string | null;
}

export interface CuriosityHookItem extends ContentItemBase {
  type: "curiosity_hook";
  fact: string;
  bridge: string;
  quest: string;
  sacrifice_type: SacrificeType;
  country?: string;
}

export interface CulturalDiamondItem extends ContentItemBase {
  type: "cultural_diamond";
  fact: string;
  bridge: string;
  quest: string;
  sacrifice_type: SacrificeType;
  country?: string;
}

export interface CardCatalogItem extends ContentItemBase {
  type: "card_catalog";
  title: string;
  rarity: CardRarity;
  image_url?: string;
  qr_code_url?: string;
  trigger_conditions: string[];
  recipient_narrative_template: string;
  parent_approval_required: boolean;
}

export interface GtdReviewItem extends ContentItemBase {
  type: "gtd_review";
  review_kind: GtdReviewKind;
  trigger: string;
  template: string;
}

export interface GtdTaskItem extends ContentItemBase {
  type: "gtd_task";
  generated_for: string;
  area: string;
  project?: string;
  description: string;
  estimated_minutes: number;
  deadline?: string;
  concept_source?: string;
  book_source?: string;
  parent_visible: boolean;
  status: "pending" | "done" | "abandoned";
}

export interface DynamicItem extends ContentItemBase {
  type: "dynamic";
  title: string;
  setup: string;
  execution: string;
  closing: string;
  multi_turn: boolean;
}

export interface ChallengeItem extends ContentItemBase {
  type: "challenge";
  description: string;
  expected_outcome: string;
  estimated_minutes: number;
}

export type ContentItem =
  | CuriosityHookItem
  | CulturalDiamondItem
  | CardCatalogItem
  | GtdReviewItem
  | GtdTaskItem
  | DynamicItem
  | ChallengeItem;

/** Score resultante para um item no contexto de um turn. */
export interface ScoredContentItem {
  item: ContentItem;
  score: number;
  reasons: string[];
}

/** Validação rasa de invariantes estruturais (não-semântica). */
export function isContentItem(value: unknown): value is ContentItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (!CONTENT_ITEM_TYPES.includes(v.type as ContentItemType)) return false;
  if (typeof v.domain !== "string") return false;
  if (!Array.isArray(v.casel_target)) return false;
  for (const d of v.casel_target) {
    if (!CASEL_DIMENSIONS.includes(d as CaselDimension)) return false;
  }
  if (
    !Array.isArray(v.age_range) ||
    v.age_range.length !== 2 ||
    typeof v.age_range[0] !== "number" ||
    typeof v.age_range[1] !== "number"
  ) {
    return false;
  }
  if (typeof v.surprise !== "number") return false;
  if (typeof v.verified !== "boolean") return false;
  if (typeof v.base_score !== "number") return false;
  return true;
}
