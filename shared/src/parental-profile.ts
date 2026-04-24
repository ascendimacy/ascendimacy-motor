/**
 * ParentalProfile — perfil dos pais coletado via onboarding parental.
 *
 * Spec: ascendimacy-ops/docs/fundamentos/ebrota-kids-onboarding-parental.md §2.
 * Fonte no motor: persona.profile.parental_profile (fixture pattern v1).
 *
 * Bloco 4 do #17 implementa só as seções 2.2, 2.4, 2.5 (Milestone 1-3 do doc):
 *   - family_values + forbidden_zones + budget_constraints
 *   - parental_availability + scale_tolerance
 *   - gardner parental observation (input pra populate GardnerAssessment)
 */

import type { GardnerChannel } from "./content-item.js";

export interface FamilyValues {
  principles: string[];
  cultural_axis?: string;
  religious_tradition?:
    | "shinto_buddhist"
    | "christian"
    | "secular"
    | "other";
  political_sensitivity?: "low" | "moderate" | "high";
}

export interface ForbiddenZone {
  topic: string;
  reason: string;
}

export interface BudgetConstraints {
  materials_monthly_ceiling_jpy?: number;
  screen_time_daily_max_minutes?: number;
  screen_time_weekly_soft_ceiling?: number;
}

export interface ParentalAvailability {
  supervision_available_hours_per_week?: number;
  supervision_for_which_kinds_of_challenges?: string[];
  scale_tolerance?: {
    micro?: "yes" | "no" | "yes_with_review";
    pequeno?: "yes" | "no" | "yes_with_review";
    medio?: "yes" | "no" | "yes_with_review";
    grande?: "yes" | "no" | "yes_with_review" | "yes_with_full_review_meeting";
    monumental?: "yes" | "no" | "yes_with_review" | "yes_with_full_review_meeting";
  };
  ready_for_dyad_sessions?: boolean;
  ready_for_joint_sessions?: boolean;
}

export interface PerceivedStrength {
  channel: GardnerChannel;
  note?: string;
}

export interface ParentalPerception {
  perceived_aspiration?: string;
  perceived_strengths?: PerceivedStrength[];
  perceived_weaknesses?: PerceivedStrength[];
  concerns_current?: string[];
  hopes_for_next_3_months?: string[];
}

/**
 * Decision profile determina como o pai responde:
 *  - consultive: consulta outro responsável antes; demora mais
 *  - decider: decide rápido e firme
 *  - risk_averse: nega com frequência itens grandes
 *  - permissive: aprova quase tudo, foca em valores
 */
export type ParentDecisionProfile =
  | "consultative_risk_averse"
  | "consultative_permissive"
  | "decider_risk_averse"
  | "decider_permissive";

export interface ParentalProfile {
  id: string;
  role: "primary" | "secondary";
  decision_profile: ParentDecisionProfile;
  family_values: FamilyValues;
  forbidden_zones: ForbiddenZone[];
  budget_constraints: BudgetConstraints;
  parental_availability: ParentalAvailability;
  parental_perception?: ParentalPerception;
  /** Valor opcional: minutos desde onboarding; serve pra re-onboarding trimestral. */
  onboarding_completed_at?: string;
}

/** `true` se o perfil tem o mínimo pra Milestone 1 (§9 doc). */
export function isParentalProfileMinimal(p: ParentalProfile | undefined): boolean {
  if (!p) return false;
  if (!p.family_values || !Array.isArray(p.family_values.principles)) return false;
  if (p.family_values.principles.length === 0) return false;
  if (!p.forbidden_zones) return false;
  if (!p.budget_constraints) return false;
  if (!p.parental_availability) return false;
  return true;
}
