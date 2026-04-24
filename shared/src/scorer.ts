/**
 * Scorer — função pura que pontua content items para um turn.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-24-materialization-strategy.md §3.3
 * Handoff #17 Bloco 1.2.
 *
 * Testable em isolamento, sem I/O, sem dependência de clock global
 * (o `now` é injetado para determinismo nos testes).
 */

import type {
  CaselDimension,
  ContentItem,
  ContentItemType,
  ScoredContentItem,
} from "./content-item.js";

/** Half-life em dias por tipo de conteúdo. Infinity = não decai. */
export const DECAY_BY_TYPE: Record<ContentItemType, number> = {
  curiosity_hook: 14,
  cultural_diamond: 60,
  card_catalog: Infinity,
  gtd_review: 7,
  gtd_task: 3,
  dynamic: 21,
  challenge: 14,
};

/** Score devolvido para item com pin parental válido — vence qualquer outro fator. */
export const PARENT_PINNED_SCORE = 1000;

/** Penalidade por domínio repetido nas últimas 5 interações. */
export const RECENT_DOMAIN_PENALTY = 3;

/** Bônus por match do topo da árvore com o domínio do item. */
export const TREE_TOP_DOMAIN_BONUS = 5;

/** Bônus por match do CASEL em foco com o target do item. */
export const CASEL_FOCUS_BONUS = 3;

export interface DomainRankEntry {
  score: number;
}

/**
 * Perfil da criança consumido pelo scorer.
 * Apenas campos realmente usados — sem acoplar ao schema de sessão.
 */
export interface ChildScoringProfile {
  age: number;
  domain_ranking?: Record<string, DomainRankEntry>;
  recent_hook_domains?: string[];
  engagement_by_type?: Partial<Record<ContentItemType, number>>;
}

export interface ScoringContext {
  /** Topo da árvore viva — key frequentemente contém o domínio. */
  top_tree_node?: { key: string; score: number; mode?: string };
  /** Dimensão CASEL em foco neste turn (emerge do status matrix). */
  casel_focus?: CaselDimension;
  /** Instante do turn (ISO). Injeção explícita → testes determinísticos. */
  now: string;
}

function daysBetween(laterIso: string, earlierIso: string): number {
  const ms = new Date(laterIso).getTime() - new Date(earlierIso).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function notExpired(pinnedUntil: string | null | undefined, now: string): boolean {
  if (!pinnedUntil) return true;
  return new Date(pinnedUntil).getTime() >= new Date(now).getTime();
}

/**
 * Score de um item de conteúdo para uma criança num contexto.
 * Devolve `{ score, reasons }` — ou score negativo/zero para inelegível.
 */
export function scoreItem(
  item: ContentItem,
  child: ChildScoringProfile,
  context: ScoringContext,
): ScoredContentItem {
  const reasons: string[] = [];

  // Idade — fora da faixa, item não é elegível (score 0).
  if (child.age < item.age_range[0] || child.age > item.age_range[1]) {
    return {
      item,
      score: 0,
      reasons: [`age_out_of_range (${item.age_range[0]}-${item.age_range[1]})`],
    };
  }

  // Pin parental — vence tudo.
  if (item.parent_pinned && notExpired(item.pinned_until, context.now)) {
    return {
      item,
      score: PARENT_PINNED_SCORE,
      reasons: ["parent_pinned"],
    };
  }

  let score = item.base_score;
  reasons.push(`base_score=${item.base_score}`);

  // Interesse da criança no domínio.
  const domainEntry = child.domain_ranking?.[item.domain];
  if (domainEntry && domainEntry.score !== 0) {
    score += domainEntry.score;
    reasons.push(`domain_interest=+${domainEntry.score}`);
  }

  // Surprise bonus — diamantes ganham peso.
  const surpriseBonus = (item.surprise - 7) * 2;
  if (surpriseBonus !== 0) {
    score += surpriseBonus;
    reasons.push(`surprise_bonus=${surpriseBonus >= 0 ? "+" : ""}${surpriseBonus}`);
  }

  // Decay temporal por tipo.
  if (item.last_used_at) {
    const halfLife = DECAY_BY_TYPE[item.type];
    if (Number.isFinite(halfLife)) {
      const daysSince = daysBetween(context.now, item.last_used_at);
      const factor = Math.pow(0.5, daysSince / halfLife);
      score *= factor;
      reasons.push(`decay=x${factor.toFixed(3)} (${daysSince.toFixed(1)}d, hl=${halfLife}d)`);
    } else {
      reasons.push("no_decay (half_life=Infinity)");
    }
  }

  // Saturação — mesmo domínio nas últimas 5 interações de hook.
  const recent = child.recent_hook_domains?.slice(0, 5) ?? [];
  if (recent.includes(item.domain)) {
    score -= RECENT_DOMAIN_PENALTY;
    reasons.push(`recent_domain_penalty=-${RECENT_DOMAIN_PENALTY}`);
  }

  // Relevância ao turn — top tree node inclui domínio.
  if (
    context.top_tree_node?.key &&
    context.top_tree_node.key.toLowerCase().includes(item.domain.toLowerCase())
  ) {
    score += TREE_TOP_DOMAIN_BONUS;
    reasons.push(`tree_top_domain=+${TREE_TOP_DOMAIN_BONUS}`);
  }

  // CASEL focus match.
  if (context.casel_focus && item.casel_target.includes(context.casel_focus)) {
    score += CASEL_FOCUS_BONUS;
    reasons.push(`casel_focus=+${CASEL_FOCUS_BONUS}`);
  }

  // Engagement histórico com o tipo.
  const engagement = child.engagement_by_type?.[item.type];
  if (typeof engagement === "number" && engagement !== 0) {
    const engagementBonus = engagement * 0.5;
    score += engagementBonus;
    reasons.push(`engagement_by_type=+${engagementBonus.toFixed(2)}`);
  }

  return { item, score, reasons };
}

/**
 * Scora um pool inteiro e devolve ordenado por score desc.
 * Não filtra — quem filtra por inelegibilidade é o chamador (score ≤ 0).
 */
export function scorePool(
  pool: ContentItem[],
  child: ChildScoringProfile,
  context: ScoringContext,
): ScoredContentItem[] {
  return pool
    .map((item) => scoreItem(item, child, context))
    .sort((a, b) => b.score - a.score);
}
