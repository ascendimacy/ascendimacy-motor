/**
 * Tutor Clássico v0 — Contrato de movimento tutorial por turn.
 *
 * Ver: docs/specs/2026-05-28-loop-tutorial-v0.md
 */

export type TutorialMove =
  | "discover"
  | "explain"
  | "check"
  | "correct"
  | "apply"
  | "recall"
  | "close"
  /**
   * compose_playbook (v0 emergent physical world challenge — fatia 4):
   * dispara quando `contextHints.compose_playbook_request === true`. Bot
   * coleta inventário do sujeito + compõe EmergentPlaybook via Strategist.
   * Saída em contextHints: inventory_probe_options + emergent_playbook.
   * Integração motor-drota é fatia futura — por ora só wiring planejador.
   */
  | "compose_playbook";

export type TutorialAdvancePolicy =
  | "hold_until_attempted"
  | "hold_until_correct"
  | "can_move_on";

export type TutorialFailurePolicy = "re_explain" | "simplify" | "recheck_later";

export interface TutorialMasteryRef {
  kind: "concept" | "item" | "axis";
  id: string;
}

/**
 * CP6 / move_alternatives — observabilidade de decisão.
 * Lista move_types cujas condições foram satisfeitas mas perderam
 * por prioridade. Permite trace/replay UI mostrar "podia ter sido X".
 * Não consumido pelo materializer.
 */
export interface TutorialMoveAlternative {
  move_type: TutorialMove;
  reason: string;
}

export interface TutorialContext {
  /** Objetivo formativo curto do turn (≤ 80 chars) */
  teaching_goal: string;

  /** Tipo de movimento tutorial que este turn deve executar */
  move_type: TutorialMove;

  /** Referência ao que está sendo trabalhado (opcional em v0.1) */
  mastery_ref?: TutorialMasteryRef;

  /** CP6 / Item 9 — política de avanço */
  advance_policy?: TutorialAdvancePolicy;

  /** CP6 / Item 9 — política de falha */
  failure_policy?: TutorialFailurePolicy;

  /** CP6 / Item 11 — turn em que esse conceito DEVE ser revisitado (se aplicável) */
  must_revisit_by_turn?: number;

  /** CP6 / move_alternatives — observabilidade da decisão */
  move_alternatives?: TutorialMoveAlternative[];
}
