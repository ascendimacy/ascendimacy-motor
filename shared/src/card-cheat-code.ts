/**
 * Cheat code — 3 palavras-chave determinísticas.
 *
 * Spec: Handoff #17 Bloco 5a (d).
 *
 * Componentes (sep: ' · '):
 *   1. Word evocativa — slug do contexto (context_word do CardSpec)
 *   2. Data relativa — 'hoje' | 'ontem' | 'semana' | 'mês' | ISO date
 *   3. Emoji/ideograma do canal Gardner
 *
 * Determinístico: dado (context_word, issued_at, now, gardner_channel) idênticos,
 * produz a mesma string. Chamada em test com `now` injetado.
 */

import type { GardnerChannel } from "./content-item.js";
import { gardnerIcon } from "./card-catalog.js";

const DAY_MS = 1000 * 60 * 60 * 24;

export interface CheatCodeInput {
  context_word: string;
  issued_at: string;
  gardner_channel: GardnerChannel;
  /** Relógio injetado pra determinismo nos testes. */
  now: string;
}

/** Slug de uma word — lowercase, espaços → _, preserva unicode sem acentos. */
export function slugify(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, 32);
}

/** Converte diferença temporal em label pt-BR. */
export function relativeDateLabel(issuedAt: string, now: string): string {
  const deltaMs = new Date(now).getTime() - new Date(issuedAt).getTime();
  if (deltaMs < 0) return "futuro";
  const days = deltaMs / DAY_MS;
  if (days < 1) return "hoje";
  if (days < 2) return "ontem";
  if (days < 7) return "semana";
  if (days < 30) return "mês";
  // Para mais antigo, devolve ISO date (determinístico).
  return new Date(issuedAt).toISOString().slice(0, 10);
}

/** Gera o cheat code de 3 partes. */
export function generateCheatCode(input: CheatCodeInput): string {
  const word = slugify(input.context_word) || "conquista";
  const dateLabel = relativeDateLabel(input.issued_at, input.now);
  const icon = gardnerIcon(input.gardner_channel);
  return `${word} · ${dateLabel} · ${icon}`;
}
