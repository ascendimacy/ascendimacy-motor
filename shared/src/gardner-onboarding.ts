/**
 * Bridge entre onboarding parental e Gardner assessment do motor.
 *
 * Spec: ascendimacy-ops/docs/fundamentos/ebrota-kids-onboarding-parental.md §2.5, §6
 *
 * Input do onboarding: `parental_perception.perceived_strengths` + `perceived_weaknesses`.
 * Output: `GardnerAssessment` consumível por `withGardnerProgram` (Bloco 2b).
 *
 * IMPORTANTE: o ranking derivado do pai é PROVISÓRIO (§6 doc: confidence ≤0.7).
 * Os 3 primeiros assessments ativos do eBerrante com a criança sobrescrevem.
 */

import type { GardnerAssessment } from "./mixins/with-gardner-program.js";
import type { GardnerChannel } from "./content-item.js";
import type { PerceivedStrength } from "./parental-profile.js";

const ALL_CHANNELS: GardnerChannel[] = [
  "linguistic",
  "logical_mathematical",
  "spatial",
  "musical",
  "bodily_kinesthetic",
  "interpersonal",
  "intrapersonal",
  "naturalist",
  "existential",
];

export interface OnboardingGardnerInput {
  perceived_strengths?: PerceivedStrength[];
  perceived_weaknesses?: PerceivedStrength[];
  /** Quantas sessões de onboarding completadas. Precisa ≥3 pra ativar programa. */
  sessions_completed: number;
}

/**
 * Converte input do onboarding parental em GardnerAssessment inicial.
 *
 * Estratégia:
 *   - Top = `perceived_strengths` na ordem dada pelos pais (rank 1 = primeiro).
 *   - Bottom = `perceived_weaknesses` na ordem dada pelos pais.
 *   - Preenche com canais não-mencionados no meio (ordem padrão).
 *   - `sessions_observed` vem direto do input.
 */
export function onboardingToGardnerAssessment(
  input: OnboardingGardnerInput,
): GardnerAssessment {
  const strengths = (input.perceived_strengths ?? []).map((s) => s.channel);
  const weaknesses = (input.perceived_weaknesses ?? []).map((s) => s.channel);

  // Top: primeiro pais declararam forças, depois resto sem weaknesses.
  const top = dedupe(strengths).slice(0, 4);
  // Bottom: pais declararam fraquezas, depois resto sem strengths.
  const bottom = dedupe(weaknesses).slice(0, 4);

  // Se pais não deram ≥1 em cada, preencher mínimo com canais não-mencionados.
  const mentioned = new Set<GardnerChannel>([...top, ...bottom]);
  const untouched = ALL_CHANNELS.filter((c) => !mentioned.has(c));
  while (top.length < 1 && untouched.length > 0) {
    top.push(untouched.shift()!);
  }
  while (bottom.length < 1 && untouched.length > 0) {
    bottom.push(untouched.pop()!);
  }

  return {
    top,
    bottom,
    sessions_observed: Math.max(0, input.sessions_completed),
  };
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
