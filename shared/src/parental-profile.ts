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

/**
 * Sujeito-proposto = ideal explícito do programa pedagógico.
 *
 * Spec: 2026-05-25-subject-knowledge-bridge.md §3.2.
 * Separado de parental_perception (que descreve "o que pai vê") —
 * aspirations é "para onde o programa caminha".
 */
export interface ParentalAspirations {
  /** Traços-alvo declarados livremente pelos pais. */
  proposed_traits?: string[];
  /** Virtudes-alvo ancoradas no catálogo de eixos clássicos (axis_id 1..12). */
  proposed_virtues?: Array<{ axis: number; note?: string }>;
  /** Competências aplicadas declaradas. */
  proposed_competencies?: string[];
}

/**
 * Filtro cultural — pais podem bloquear tradições inteiras do catálogo.
 * Validador deve alertar se bloqueio reduz algum eixo a <2 alternativas.
 */
export interface CulturalFilter {
  allowed_lineages?: string[];
  blocked_lineages?: string[];
}

/** Configuração de cadência de flashes culturais (verticais fora da base). */
export type FlashesSetting = "off" | "occasional" | "frequent";

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

  // --- Subject Knowledge fundação (spec 2026-05-25, fase 1 opcional) ---
  /** Norte do programa: ideal estruturado pra onde o sujeito caminha. */
  aspirations?: ParentalAspirations;
  /** Necessidades latentes percebidas pelos pais (não exigem confirm do filho —
   * motor endereça obliquamente via ponte tripla). */
  latent_needs?: string[];
  /** Interesses que os pais acham que o filho tem — PRECISAM ser confirmados
   * pelo filho em conversa antes do scorer ativar boost. */
  parent_claimed_interests?: string[];
  /** Filtro de tradições clássicas para complementos do sujeito-proposto. */
  cultural_filter?: CulturalFilter;
  /** Cadência de flashes culturais (verticais fora da base). Default 'occasional'. */
  flashes_setting?: FlashesSetting;
  /** Budget de checagens de recall por sessão. 0..2, default 1. */
  recall_check_budget_per_session?: number;
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
