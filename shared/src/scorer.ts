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

/**
 * G-22 pool-builder integration (ops#1093 — follow-up motor#130).
 *
 * Default base effort quando item.sacrifice_amount ausente — mirror de
 * `BASE_EFFORT_DEFAULT` em sacrifice-budget.ts (não importado pra manter
 * scorer livre de dep circular; valor sincronizado documentalmente).
 */
const SACRIFICE_BASE_EFFORT_DEFAULT = 8;

/**
 * G-22 pool-builder integration (ops#1093 — follow-up motor#130).
 *
 * Coeficiente linear inverso aplicado a `(sacrificeCost - BASE_EFFORT)`.
 * CC default Jun 2026-05-16, aguardando ratify:
 *   - sacrificeCost 26 (Saki sensory+firm) → -3.6 score adjustment
 *   - sacrificeCost 5  (low effort)        → +0.6 score adjustment (boost)
 *   - sacrificeCost 8  (= base)            → 0 (neutro)
 *
 * Alternativas documentadas em ops#1093 sub-decisão 1:
 *   (A) 0.0  — sem score adjustment, só hard gate em budget exhausted
 *   (B) 0.5  — agressivo (Saki firm -9 score, quase suprime)
 *   (C) 0.2  — CC default, alinhado com `engagement_by_type` (×0.5) e
 *              menor que CASEL_FOCUS_BONUS (3); conservador.
 */
export const SACRIFICE_SCORE_WEIGHT = 0.2;

/** Half-life em dias por tipo de conteúdo. Infinity = não decai. */
export const DECAY_BY_TYPE: Record<ContentItemType, number> = {
  curiosity_hook: 14,
  cultural_diamond: 60,
  card_catalog: Infinity,
  gtd_review: 7,
  gtd_task: 3,
  dynamic: 21,
  challenge: 14,
  // B2: drill items são injetados turn-a-turn — score vem do SR urgency,
  // não de recência. Decay neutro evita penalidade redundante.
  drill_vocab: Infinity,
};

/** Score devolvido para item com pin parental válido — vence qualquer outro fator. */
export const PARENT_PINNED_SCORE = 1000;

/** Penalidade por domínio repetido nas últimas 5 interações. */
export const RECENT_DOMAIN_PENALTY = 3;

/** Bônus por match do topo da árvore com o domínio do item. */
export const TREE_TOP_DOMAIN_BONUS = 5;

/** Bônus por match do CASEL em foco com o target do item. */
export const CASEL_FOCUS_BONUS = 3;

/**
 * Sprint Pedagógico P2.1: bonus quando interest do sujeito match item.
 * Match path: persona.interests ∩ (item.gardner_channels ∪ item.domain ∪ item.id).
 * +6 escolhido pra ser ≥ surprise bonus máximo (+6 com surprise=10) — interest
 * vence surpresa quando profile tem interests definidos.
 */
export const INTEREST_MATCH_SCORE = 6;

/**
 * Subject Knowledge Fase 5 — bonus combinatorial multi-dim (spec §4.6).
 * Soma não-linear: items que integram múltiplas dimensões valem mais que
 * items que tocam várias superficialmente.
 */
export const MULTIDIM_BONUS_2 = 6; // ≥2 dimensões matched
export const MULTIDIM_BONUS_3 = 4; // adicional ≥3
export const MULTIDIM_BONUS_5 = 4; // adicional 5 (todas)
/** Peso extra quando item move sujeito-real na direção do proposto. */
export const MOVES_TOWARD_PROPOSED_BONUS = 2;
/** Pontos mínimos no ledger pra dimensão internalization_history disparar. */
export const INTERNALIZATION_HISTORY_THRESHOLD = 3;

/**
 * motor#23: penalidade forte pra items já consumidos na sessão atual.
 * Maior que qualquer bônus normal (base_score+surprise+casel ≈ 12-15) — efetivamente
 * exclui o item enquanto outros disponíveis. Não 1000 (parent_pinned) pois ainda
 * queremos permitir reuso se for última opção.
 */
export const USED_IN_SESSION_PENALTY = 100;

/**
 * Expose gate — items com sacrifice_type=expose pedem ao sujeito que mostre
 * vulnerabilidade ("você já se sentiu assim?"). Disparam mal quando ele
 * está fechado: trust baixa, mood ruim, ou sinais explícitos de recusa
 * (frame_rejection, deflection_thematic).
 *
 * Observado no smoke tracer-helix-3sessions-ryo: bio_caterpillar_dissolve
 * dominou 3 sessões consecutivas; Ryo disse "por que você quer tanto ficar
 * falando de lágrima? é estranho" na S3T4. Penalty -8 derruba expose pra
 * baixo dos hooks neutros (base_score~5-10) sem excluí-los completamente.
 */
export const EXPOSE_GATE_PENALTY = 8;
/** Threshold de trust abaixo do qual expose dispara penalty. */
export const EXPOSE_GATE_TRUST_THRESHOLD = 0.5;
/** Threshold de mood abaixo do qual expose dispara penalty. */
export const EXPOSE_GATE_MOOD_THRESHOLD = 6;
/** Sinais que indicam recusa de frame — expose vira inapropriado. */
export const EXPOSE_GATE_BLOCKING_SIGNALS: readonly string[] = [
  "frame_rejection",
  "deflection_thematic",
];

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

  /**
   * Sprint Pedagógico P2.1: interesses livres do sujeito (tênis, mecânica,
   * dragon_ball, etc). Match com item.gardner_channels OR substring de
   * item.domain/item.id (case-insensitive) → INTEREST_MATCH_SCORE boost.
   * Vindo de persona.profile.interests via personaToChildProfile.
   */
  interests?: string[];

  /**
   * Dia no ciclo helix de 18 dias (1-18). Bloco 2a adiciona o slot;
   * scorer v1 não consome. Referência: BRIDGING_PLAYBOOK.MD linhas 2700-2715
   * (distribuição de técnicas por fase). Plan §2.A v2, A.1.2.
   */
  cycle_day?: number;

  /**
   * Fase derivada do cycle_day. Bloco 3 pode modular pesos por fase.
   *   rapport (1-3), building (4-7), peak (8-10), consolidation (11-14), buffer (15-18)
   */
  cycle_phase?: "rapport" | "building" | "peak" | "consolidation" | "buffer";

  // ─── Subject Knowledge Fase 5 (multi-dim combinatorial) ───────────
  /**
   * Necessidades latentes declaradas pelos pais (parental_profile.latent_needs).
   * Dimensão `need` do scoring multi-dim: item match quando alguma string
   * aparece em item.domain/id/keywords/extracted_keywords.
   */
  latent_needs?: string[];
  /**
   * Sujeito-proposto materializado (ideal parental + complementos clássicos).
   * Dimensões `lineage` e `moves_toward_proposed` do multi-dim usam.
   * Caller (planejador) hidrata via subject-proposed table.
   */
  subject_proposed?: {
    axes_active: number[];
    complements_per_axis: Record<number, string[]>;
  };
  /**
   * Pontos acumulados por axis_id no ledger (presented_concept + recall_check_positive).
   * Dimensão `internalization_history`: items que tocam eixos com histórico ganham bonus.
   * Map axis_id → pontos totais.
   */
  internalization_axis_points?: Record<number, number>;

  /**
   * Confiança acumulada [0..1]. Cross-session, vinda do subject_knowledge
   * ledger ou heurística do BFF. Usado pelo expose gate: items vulneráveis
   * desabilitados quando trust < EXPOSE_GATE_TRUST_THRESHOLD.
   * Ausente → tratado como 1.0 (sem gate).
   */
  trust?: number;
}

export interface ScoringContext {
  /** Topo da árvore viva — key frequentemente contém o domínio. */
  top_tree_node?: { key: string; score: number; mode?: string };
  /** Dimensão CASEL em foco neste turn (emerge do status matrix). */
  casel_focus?: CaselDimension;
  /** Instante do turn (ISO). Injeção explícita → testes determinísticos. */
  now: string;
  /**
   * motor#23: items já selecionados nesta sessão (extraídos do event_log).
   * Penalidade pesada (-100) pra evitar repetir mesma fala — descoberta no
   * smoke-3d onde 12 chamadas drota selecionaram bio_dolphin_names todas.
   */
  used_in_session?: string[];

  /**
   * G-22 pool-builder integration (ops#1093). Map item.id → sacrifice cost
   * computado por `computeChallengeCost` (sacrifice-budget). Quando presente,
   * scorer aplica `SACRIFICE_SCORE_WEIGHT × (BASE_EFFORT_DEFAULT - cost)` —
   * items caros são penalizados, items baratos boostados.
   *
   * Hidratação responsabilidade do caller (planejador). Ausente → sem ajuste
   * (backward compat). Items SEM entry no map (e.g., sem sacrifice_amount)
   * usam fallback `SACRIFICE_BASE_EFFORT_DEFAULT (8)` → 0 adjustment.
   */
  sacrifice_cost_by_id?: Record<string, number>;

  /**
   * Mood corrente do sujeito [0..10] vindo do unified-assessor. Usado pelo
   * expose gate: items vulneráveis desabilitados quando mood < threshold.
   * Ausente → mood neutro (sem gate).
   */
  current_mood?: number;

  /**
   * Signals extraídos do turn corrente OU dos N turns recentes (caller decide).
   * Expose gate dispara penalty quando contém `frame_rejection` ou
   * `deflection_thematic` — sujeito recusou frame, vulnerabilidade não cabe.
   */
  recent_signals?: string[];
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

  // Sprint Pedagógico P2.1: interest match boost.
  // persona.interests vs item.gardner_channels/domain/id. Case-insensitive,
  // substring match. Múltiplos matches contam UMA vez (boost fixo, não somado)
  // pra evitar items "genéricos" dominarem por casarem com vários interests.
  if (child.interests && child.interests.length > 0) {
    const itemHaystack = [
      item.domain,
      item.id,
      ...(item.gardner_channels ?? []),
    ]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
    const matched = child.interests.find((interest) => {
      const needle = interest.toLowerCase().trim();
      if (needle.length === 0) return false;
      return itemHaystack.some(
        (hay) => hay.includes(needle) || needle.includes(hay),
      );
    });
    if (matched !== undefined) {
      score += INTEREST_MATCH_SCORE;
      reasons.push(`interest_match=+${INTEREST_MATCH_SCORE} ('${matched}')`);
    }
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

  // G-22 pool-builder integration (ops#1093 — follow-up motor#130).
  // Items caros (sacrifice cost > base_effort) penalizados; items baratos
  // boostados. Linear inverse: adj = SACRIFICE_SCORE_WEIGHT × (base - cost).
  // Aplicado ANTES do used_in_session pra deixar o motor#23 -100 sempre
  // dominante (drota não reusa item da sessão mesmo se cheap). Ordem aqui
  // é só pra clarity nas reasons; matemática é additiva.
  if (context.sacrifice_cost_by_id) {
    const cost = context.sacrifice_cost_by_id[item.id];
    if (typeof cost === "number") {
      const adjustment = SACRIFICE_SCORE_WEIGHT * (SACRIFICE_BASE_EFFORT_DEFAULT - cost);
      if (adjustment !== 0) {
        score += adjustment;
        const sign = adjustment >= 0 ? "+" : "";
        reasons.push(`sacrifice_cost_adj=${sign}${adjustment.toFixed(2)} (cost=${cost.toFixed(2)})`);
      }
    }
  }

  // ── Subject Knowledge Fase 5: bonus combinatorial multi-dim (spec §4.6) ──
  // Soma não-linear: items que integram múltiplas dimensões ganham mais.
  // 5 dimensões: interest, need, lineage, moves_toward_proposed, internalization_history.
  // Bonus dispara só quando ≥2 dims batem. Dim 'moves_toward_proposed' tem
  // peso extra adicional (alinhamento estratégico ao norte).
  const dimsMatched = evaluateMultiDimMatches(item, child);
  const matchedCount =
    (dimsMatched.interest ? 1 : 0) +
    (dimsMatched.need ? 1 : 0) +
    (dimsMatched.lineage ? 1 : 0) +
    (dimsMatched.moves_toward_proposed ? 1 : 0) +
    (dimsMatched.internalization_history ? 1 : 0);
  if (matchedCount >= 2) {
    let multiBonus = MULTIDIM_BONUS_2;
    if (matchedCount >= 3) multiBonus += MULTIDIM_BONUS_3;
    if (matchedCount === 5) multiBonus += MULTIDIM_BONUS_5;
    if (dimsMatched.moves_toward_proposed) multiBonus += MOVES_TOWARD_PROPOSED_BONUS;
    score += multiBonus;
    const dimList = Object.entries(dimsMatched)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(",");
    reasons.push(`multidim_bonus=+${multiBonus} (${matchedCount} dims: ${dimList})`);
  }

  // Expose gate: items que pedem vulnerabilidade sofrem penalty quando o
  // sujeito está fechado. Aplicado APÓS multi-dim (não bloqueia, só baixa
  // ranking) e ANTES de used_in_session (este último vence sempre).
  // `sacrifice_type` só existe em curiosity_hook + cultural_diamond.
  if ("sacrifice_type" in item && item.sacrifice_type === "expose") {
    const trustLow =
      typeof child.trust === "number" && child.trust < EXPOSE_GATE_TRUST_THRESHOLD;
    const moodLow =
      typeof context.current_mood === "number" &&
      context.current_mood < EXPOSE_GATE_MOOD_THRESHOLD;
    const signalBlock =
      context.recent_signals?.some((s) =>
        EXPOSE_GATE_BLOCKING_SIGNALS.includes(s),
      ) ?? false;
    if (trustLow || moodLow || signalBlock) {
      score -= EXPOSE_GATE_PENALTY;
      const triggers: string[] = [];
      if (trustLow) triggers.push(`trust=${child.trust?.toFixed(2)}`);
      if (moodLow) triggers.push(`mood=${context.current_mood}`);
      if (signalBlock) {
        const blocked = context.recent_signals?.filter((s) =>
          EXPOSE_GATE_BLOCKING_SIGNALS.includes(s),
        );
        triggers.push(`signals=[${blocked?.join(",")}]`);
      }
      reasons.push(
        `expose_gate_penalty=-${EXPOSE_GATE_PENALTY} (${triggers.join(", ")})`,
      );
    }
  }

  // motor#23: penalidade forte para items já usados nesta sessão.
  // Antes desta fix, drota selecionava o mesmo item turn após turn (smoke-3d:
  // 12 calls × bio_dolphin_names) porque scorer não considerava reuso intra-session.
  // Penalidade de 100 pontos efetivamente exclui o item enquanto houver outros
  // disponíveis (base_scores típicos = 5-10).
  if (context.used_in_session?.includes(item.id)) {
    score -= USED_IN_SESSION_PENALTY;
    reasons.push(`used_in_session_penalty=-${USED_IN_SESSION_PENALTY}`);
  }

  return { item, score, reasons };
}

/**
 * Avalia as 5 dimensões do scoring multi-dim (spec §4.6).
 * Exportado pra testes e debug — mas só `scoreItem` chama em produção.
 */
export interface MultiDimMatches {
  interest: boolean;
  need: boolean;
  lineage: boolean;
  moves_toward_proposed: boolean;
  internalization_history: boolean;
}

/**
 * Stopwords PT-BR pequenas — filtradas ao tokenizar latent_needs/interests
 * pra evitar match espúrio em palavras irrelevantes.
 */
const TOKENIZE_STOPWORDS: ReadonlySet<string> = new Set([
  "de", "da", "do", "das", "dos", "em", "para", "com", "sem", "por",
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "no", "na", "nos", "nas",
  "que", "se", "e", "ou", "mas",
]);

/**
 * Tokenize string longa em palavras significativas (>3 chars, sem stopwords).
 * Usado pra match de latent_needs ("expressão emocional" → ["expressão","emocional"])
 * contra haystack curto (keywords/domain).
 */
function tokenizeForMatch(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3 && !TOKENIZE_STOPWORDS.has(t));
}

/**
 * Match via tokens (sempre): needle longa quebrada em tokens >3 chars
 * (sem stopwords) que vão match individualmente contra haystack.
 *
 * Evita que stopword na needle (ex: "coisa importante de verdade")
 * matche trivialmente via substring.
 */
function fuzzyMatch(needle: string, haystack: string[]): boolean {
  const tokens = tokenizeForMatch(needle);
  if (tokens.length === 0) return false;
  // Match bidirecional só quando ambos lados têm length >3 — evita
  // "de" (haystack curto) matchear como substring de "verdade" (tok longo).
  return tokens.some((tok) =>
    haystack.some((h) => h.length > 3 && (h.includes(tok) || tok.includes(h))),
  );
}

export function evaluateMultiDimMatches(
  item: ContentItem,
  child: ChildScoringProfile,
): MultiDimMatches {
  // Reutiliza haystack do item pra match textual.
  const haystack = [
    item.domain,
    item.id,
    ...(item.gardner_channels ?? []),
    ...(item.extracted_keywords ?? []),
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());

  // interest: persona.interests OU fallback pra domain_ranking quando vazio
  const interestSource =
    child.interests && child.interests.length > 0
      ? child.interests
      : Object.keys(child.domain_ranking ?? {});
  const interest = interestSource.some((i) => fuzzyMatch(i, haystack));

  // need: tokenize latent_needs longos (ex: "expressão emocional")
  const need = (child.latent_needs ?? []).some((n) => fuzzyMatch(n, haystack));

  let lineage = false;
  let movesTowardProposed = false;
  if (child.subject_proposed) {
    if (typeof item.axis_id === "number") {
      lineage = child.subject_proposed.axes_active.includes(item.axis_id);
      if (lineage && typeof item.lineage_anchor === "string") {
        const tradition = item.lineage_anchor.split("/")[0];
        const complement = item.lineage_anchor.split("/")[1];
        const accepted = child.subject_proposed.complements_per_axis[item.axis_id] ?? [];
        // moves_toward_proposed: item tem complement aceito no eixo E o
        // eixo está no proposto (lineage true por construção).
        if (complement && accepted.includes(complement)) {
          movesTowardProposed = true;
        } else if (accepted.length === 0 && lineage) {
          // Eixo ativo mas sem complementos específicos selecionados pelos pais
          // ainda — movimento conta apenas pela ativação do eixo.
          movesTowardProposed = true;
          // mantém variável tradition referenciada pra evitar warning de unused
          if (tradition === undefined) {
            // unreachable
          }
        }
      }
    }
  }

  const internalizationHistory =
    typeof item.axis_id === "number" &&
    typeof child.internalization_axis_points?.[item.axis_id] === "number" &&
    (child.internalization_axis_points?.[item.axis_id] ?? 0) >= INTERNALIZATION_HISTORY_THRESHOLD;

  return {
    interest,
    need,
    lineage,
    moves_toward_proposed: movesTowardProposed,
    internalization_history: internalizationHistory,
  };
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
