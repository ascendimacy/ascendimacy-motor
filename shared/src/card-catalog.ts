/**
 * Card emission schema — Bloco 5a (#17).
 *
 * Runtime-generated cards, NÃO catálogo fixo. Arquétipos são scaffolds
 * placeholder até Bloco 5b (Content Engine charter em docs/specs/).
 *
 * Spec:
 *   - paper §8.2 — Cartas
 *   - fundamentos/ebrota-kids-artefatos.md §2
 *   - Handoff #17 Bloco 5a (runtime generation, sem catálogo)
 *
 * Conceitos:
 *   - Archetype = scaffold (template de card); v1 tem 3-5 placeholders
 *   - CardSpec = proposta do planejador antes de triagem parental
 *   - EmittedCard = instância final persistida (com front/back/HMAC/QR)
 */

import type { CaselDimension, GardnerChannel, CardRarity } from "./content-item.js";

/** Template do verso — v1 só um. */
export const CARD_BACK_TEMPLATES = ["v1-default"] as const;
export type CardBackTemplate = (typeof CARD_BACK_TEMPLATES)[number];

/**
 * Scaffold de arquétipo — placeholder editorial.
 * Real (curated) entra via content-engine em Bloco 5b.
 * `is_scaffold: true` é o guard-flag que bloqueia emissão em produção.
 */
export interface CardArchetype {
  id: string;
  name: string;
  narrative_template: string;
  casel_dimension: CaselDimension;
  gardner_channel: GardnerChannel;
  rarity: CardRarity;
  /** CRITICAL: se true, emitCard lança em env !== 'test'. */
  is_scaffold: boolean;
}

/** Frente do card — lado visível "bonito". */
export interface CardFront {
  image_url: string;
  narrative: string;
  archetype_id: string;
}

/** Verso do card — dados semânticos pra leitura humana + validação. */
export interface CardBack {
  template: CardBackTemplate;
  gardner_channel_icon: string;
  casel_dimension: CaselDimension;
  /** 3 palavras-chave separadas por ' · ' — ver `generateCheatCode`. */
  cheat_code: string;
  /** Formato: `#{childId}-{sequence:3}` (3 dígitos). */
  serial_number: string;
  /** URL completa com HMAC; pode ser embutida em QR. */
  qr_payload: string;
}

/**
 * CardSpec = proposta gerada pelo eBerrante antes de triagem+aprovação.
 * Carrega contexto bruto usado pra compor front/back no final.
 */
export interface CardSpec {
  archetype: CardArchetype;
  child_id: string;
  session_id: string;
  context_word: string;
  casel_dimension: CaselDimension;
  gardner_channel: GardnerChannel;
  /** Quando a conquista aconteceu (detectada no trace). */
  issued_at: string;
  /** Evidência — resumo do que o eBerrante observou. */
  achievement_summary: string;
  /** Sequência monotônica por criança (caller provê — ex: count de cards emitidos+1). */
  sequence: number;
}

/**
 * EmittedCard = instância persistida após aprovação e emissão in-game.
 * 3 marcas temporais (d):
 *   - issued_at: evento de conquista no trace
 *   - approved_at: pais aprovaram
 *   - emitted_at: drota narrou pra criança
 */
export interface EmittedCard {
  card_id: string;
  child_id: string;
  session_id: string;
  archetype_id: string;
  front: CardFront;
  back: CardBack;
  spec_snapshot: CardSpec;
  signature: string;
  issued_at: string;
  approved_at: string;
  emitted_at: string;
}

/** Gardner channel → icon/ideograma usado no verso + cheat code. */
export const GARDNER_CHANNEL_ICON: Record<GardnerChannel, string> = {
  linguistic: "✍️",
  logical_mathematical: "💡",
  spatial: "🧭",
  musical: "🎵",
  bodily_kinesthetic: "🏃",
  interpersonal: "🫂",
  intrapersonal: "🔮",
  naturalist: "🌿",
  existential: "🌌",
};

export function gardnerIcon(channel: GardnerChannel): string {
  return GARDNER_CHANNEL_ICON[channel];
}

/** Formata serial: `#{childId}-{sequence:3}` (3 dígitos zero-padded). */
export function formatSerialNumber(childId: string, sequence: number): string {
  const padded = String(sequence).padStart(3, "0");
  return `#${childId}-${padded}`;
}
