/**
 * drill-fuzzy-match — validação de resposta para items B2 (Drilling).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md
 *
 * Strictness default (Jun ratify 2026-05-26):
 *  - Normaliza lowercase + remove acentos.
 *  - Match contra `payload.answer` + `payload.accept_variants`.
 *  - `slow_correct` quando latency > threshold (default 5s).
 *
 * Sem dependência de LLM — match local, determinístico.
 *
 * Vive em `shared` pra ser consumido tanto por motor-drota (validação
 * durante o pipeline) quanto por orchestrator (matching pós-turn da
 * resposta do sujeito ao drill emitido no turn anterior).
 */

import type { DrillItem } from "./contracts/index.js";

export interface FuzzyMatchResult {
  correct: boolean;
  latency_ms: number;
  response_type: "correct" | "slow_correct" | "incorrect";
}

export interface FuzzyMatchOpts {
  /** Acima deste limite, `correct` vira `slow_correct`. Default 5000ms. */
  slowThresholdMs?: number;
}

const DEFAULT_SLOW_THRESHOLD_MS = 5000;

/**
 * Lowercase + strip Latin diacritics + collapse spaces.
 *
 * NFC re-compose ao final preserva caracteres não-latinos cujo NFD decompõe
 * para `base + combining-mark` fora da faixa U+0300–U+036F (ex.: dakuten
 * japonês U+3099 em `ご`).
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchDrillAnswer(
  item: DrillItem,
  userResponse: string,
  latencyMs: number,
  opts: FuzzyMatchOpts = {},
): FuzzyMatchResult {
  const slow = opts.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS;
  const normUser = normalize(userResponse);
  const candidates = [
    item.payload.answer,
    ...(item.payload.accept_variants ?? []),
  ];
  const correct = candidates.some((c) => normalize(c) === normUser);

  if (!correct) {
    return {
      correct: false,
      latency_ms: latencyMs,
      response_type: "incorrect",
    };
  }
  return {
    correct: true,
    latency_ms: latencyMs,
    response_type: latencyMs > slow ? "slow_correct" : "correct",
  };
}
