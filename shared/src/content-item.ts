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

/**
 * Sacrifice type — categoria pedagógica do que o item pede da criança.
 *
 * Distinção semântica (ratificada Jun 2026-05-16 via ops#371 audit dos 3 hooks
 * "expose": `bio_dolphin_names`, `bio_caterpillar_dissolve`, `myth_kintsugi_philosophy`):
 *
 *  - `reflect` — pensar/processar internamente. Sacrifice cognitivo.
 *  - `create` — produzir algo novo (texto, desenho, ação criativa). Sacrifice produtivo.
 *  - `act` — executar uma ação física/comportamental. Sacrifice de movimento.
 *  - `share` — oferecer algo (conhecimento, recurso, opinião) ao outro. Sacrifice social-leve.
 *  - `observe` — prestar atenção sem agir. Sacrifice perceptual.
 *  - `expose` — revelar vulnerabilidade pessoal (luto, ferida, dissolução interior).
 *                Sacrifice profundo / auto-exposição emocional.
 *
 *  `expose` ≠ `share`: share é generoso (oferece algo positivo); expose é
 *  vulnerável (revela ferida). Items `expose` típicos têm `sacrifice_amount`
 *  alto (12-16 vs 5-10 default) por refletir profundidade.
 *
 *  Ratificação: ops#371 E-080 audit + Jun 2026-05-16 escolha Option A
 *  (expand enum vs substitute, optando por preservar signal pedagógico).
 */
export const SACRIFICE_TYPES = [
  "reflect",
  "create",
  "act",
  "share",
  "observe",
  "expose",
] as const;
export type SacrificeType = (typeof SACRIFICE_TYPES)[number];

/**
 * Dreyfus skill acquisition model levels — ordered from novice to expert.
 *
 * Used by ContentItem.dreyfus_level_target as a `[from, to]` range expressing
 * the band of skill in which an item is pedagogically appropriate. A criança
 * progredindo through this range remains served by the item; below `from` é
 * cedo demais, acima de `to` é repetitivo/sem desafio.
 *
 * Spec ops#1015 G-01 (CASEL × Dreyfus × Gardner), Jun ratificado 2026-05-16.
 */
export const DREYFUS_LEVELS = [
  "novice",
  "apprentice",
  "practitioner",
  "proficient",
  "expert",
] as const;
export type DreyfusLevel = (typeof DREYFUS_LEVELS)[number];

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

  /**
   * Elegibilidade para joint/dyad sessions (Bloco 6 #17).
   * Bloco 2a adiciona o campo com default `false` para evitar migration
   * futura no schema. Pool-builder v1 não filtra por isso — consumo é
   * Bloco 6+. Plan §2.A v2, A.1.1.
   */
  group_compatible?: boolean;

  /**
   * Quantidade de "sacrifício" (esforço/exposição) que o item pede.
   * Range típico: 5-25. Items com valor ≥ SACRIFICE_HIGH_THRESHOLD (15)
   * disparam signal `sacrifice_high` em detectAchievement quando
   * selecionados. Bloco 7 prep — antes era hardcoded 0.
   */
  sacrifice_amount?: number;

  /** Dinâmico por criança — resultante do histórico de uso. */
  times_used?: number;
  last_used_at?: string | null;
  avg_engagement?: number | null;

  /** Pin parental — quando true, score máximo, sem decay. */
  parent_pinned?: boolean;
  pinned_until?: string | null;

  /**
   * Banda Dreyfus em que o item é pedagogicamente apropriado, expressa como
   * tuple `[from, to]` (mirror semantics de `age_range`). Item serve criança
   * cuja mastery está dentro do range — abaixo de `from` é cedo demais,
   * acima de `to` o item perde valor (repetitivo / sem desafio).
   *
   * Derivado automaticamente via `deriveDreyfusLevel()` a partir de signals
   * existentes (type, sacrifice_amount, surprise, rarity, verified). Field
   * opcional pra backward compat — quando ausente, consumers devem aplicar
   * derivação defensiva em runtime (planejador/motor-drota fallback).
   *
   * Spec ops#1015 G-01 (CASEL × Dreyfus × Gardner), Jun ratificado 2026-05-16.
   */
  dreyfus_level_target?: [DreyfusLevel, DreyfusLevel];

  /**
   * Subject Knowledge Fase 3 — tags pra ponte tripla + ledger de conceitos.
   * Quando os 4 campos abaixo estão presentes, ConceptLedgerWriter emite
   * `presented_concept` (+1pt) no SubjectKnowledge após o item ser materializado.
   *
   * Campos opcionais por compatibilidade — items legados sem tags
   * continuam funcionando, apenas não geram entry no ledger.
   *
   * Spec: 2026-05-25-subject-knowledge-bridge.md §3 + §4.4.
   */
  axis_id?: number; // 1..12
  family?: "carater" | "disposicao" | "cognicao_si";
  /** "tradicao/complemento" — ex: "estoica/dicotomia_controle". */
  lineage_anchor?: string;
  /** Palavras-chave do conceito pra futura detecção de recall. */
  extracted_keywords?: string[];
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
  /**
   * Rotulagem ISA pedagógica propagada quando item veio de lookup
   * determinístico do ActionMenu (C-T-10-01, ops#999). Ausente quando
   * scoring clássico (pool seed) — backward compat preservada.
   *
   * Convergência futura de schemas ContentItem ↔ ActionMenuItem fica
   * pra Tier 3 (ops#999 ponto #4). Por enquanto, transitional shim.
   */
  isaLabels?: {
    played_as?: "bridge" | "espelho" | "canal" | "diamante" | "arena" | "recovery";
    intensity?: "soft" | "medium" | "firm";
    is_critical?: boolean;
  };
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
  if (v.dreyfus_level_target !== undefined) {
    if (
      !Array.isArray(v.dreyfus_level_target) ||
      v.dreyfus_level_target.length !== 2 ||
      !DREYFUS_LEVELS.includes(v.dreyfus_level_target[0] as DreyfusLevel) ||
      !DREYFUS_LEVELS.includes(v.dreyfus_level_target[1] as DreyfusLevel)
    ) {
      return false;
    }
  }
  // ops#371: validate sacrifice_type enum strict quando presente.
  // Previne regressão futura (e.g., re-introdução de "expose" pre-ratification).
  if (v.sacrifice_type !== undefined) {
    if (!SACRIFICE_TYPES.includes(v.sacrifice_type as SacrificeType)) return false;
  }
  return true;
}
