/**
 * Adaptador PersonaDef + SessionState → ChildScoringProfile.
 *
 * Spec: docs/handoffs/2026-04-24-cc-bloco2-plan.md §2.A v2.
 *
 * v1 é conservador: usa campos do perfil estático quando presentes,
 * preenche defaults sem inventar. engagement_by_type e recent_hook_domains
 * serão populados em Bloco 3 (trace schema completo).
 */

import type {
  ChildScoringProfile,
  PersonaDef,
  SessionState,
} from "@ascendimacy/shared";

/**
 * Deriva profile de scoring a partir dos dados disponíveis.
 * turn=0 → tudo vazio (cold start). turn>=1 → começa a popular via state/history.
 */
export function personaToChildProfile(
  persona: PersonaDef,
  _state: SessionState,
): ChildScoringProfile {
  const profile = (persona.profile ?? {}) as Record<string, unknown>;

  // domain_ranking pode vir do profile estático se fixture declarar.
  const rawRanking = profile["domain_ranking"];
  const domainRanking =
    rawRanking && typeof rawRanking === "object"
      ? (rawRanking as Record<string, { score: number }>)
      : undefined;

  // recent_hook_domains derivamos do eventLog em Bloco 3 (trace schema).
  // Por ora, vazio — cold start seguro.
  const recentHookDomains: string[] = [];

  const cycleDay = typeof profile["cycle_day"] === "number"
    ? (profile["cycle_day"] as number)
    : undefined;

  return {
    age: persona.age,
    domain_ranking: domainRanking,
    recent_hook_domains: recentHookDomains,
    cycle_day: cycleDay,
    cycle_phase: cyclePhaseFor(cycleDay),
  };
}

/** Mapeia cycle_day → cycle_phase conforme BRIDGING_PLAYBOOK linhas 2700-2715. */
export function cyclePhaseFor(
  day: number | undefined,
): ChildScoringProfile["cycle_phase"] | undefined {
  if (typeof day !== "number") return undefined;
  if (day >= 1 && day <= 3) return "rapport";
  if (day >= 4 && day <= 7) return "building";
  if (day >= 8 && day <= 10) return "peak";
  if (day >= 11 && day <= 14) return "consolidation";
  if (day >= 15 && day <= 18) return "buffer";
  return undefined;
}
