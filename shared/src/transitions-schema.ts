/**
 * Zod schema pra validar transitions.yaml (motor#25).
 *
 * Spec: docs/handoffs/2026-04-26-cc-motor-pre-piloto-strategic-gaps.md §motor#25.
 * ARCHITECTURE.md §14.
 *
 * Filosofia: schema declarativo bloqueante. Validar carregamento upfront,
 * falhar loud na startup do planejador se YAML inválido.
 */

import { z } from "zod";

/** Match modes: "AND" (todos signals required) | "OR" (qualquer um) — v0 default OR. */
export const TransitionMatchMode = z.enum(["AND", "OR"]).default("OR");
export type TransitionMatchModeType = z.infer<typeof TransitionMatchMode>;

/** Schema de uma única transição (ex: brejo_to_baia). */
export const TransitionRuleSchema = z.object({
  /** Signals que devem estar presentes. Default OR (qualquer um basta). */
  required_signals: z.array(z.string()).min(1),
  /** Janela mínima de turns desde último estado anterior. */
  minimum_window_turns: z.number().int().nonnegative().default(0),
  /** Signals confirmatórios — não bloqueiam por default. Se confirmatory_min > 0, exige N matches. */
  confirmatory_signals: z.array(z.string()).default([]),
  /**
   * BUG-KT-01 (ops#1141): mínimo de confirmatory_signals que devem matchar
   * pra transição firar. Default 0 = backward compat (confirmatory não bloqueia).
   * Quando >0, recupera semântica do DT-A01-02 (combinar required_all + required_any).
   */
  confirmatory_min: z.number().int().nonnegative().default(0),
  /** Signals que regridem o estado (se aparecem, transição não acontece + estado pode voltar). */
  regression_to_brejo_if: z.array(z.string()).optional(),
  regression_to_baia_if: z.array(z.string()).optional(),
  /** Match mode pros required signals. Default OR pra v0. */
  match_mode: TransitionMatchMode.optional(),
  /**
   * BUG-KT-01 (ops#1141): quando definido (>=1), os required_signals devem
   * matchar em N turns CONSECUTIVOS finais (não apenas em qualquer turn da
   * janela). Recupera DT-A01-03 (regressões exigem persistência).
   * Quando set, caller deve passar signalsPerTurn pra evaluateTransition.
   */
  consecutive_turns: z.number().int().positive().optional(),
});
export type TransitionRule = z.infer<typeof TransitionRuleSchema>;

/** Schema do arquivo transitions.yaml inteiro. */
export const TransitionsConfigSchema = z.object({
  profile_id: z.string(),
  schema_version: z.string(),
  last_updated: z.string().optional(),
  transitions: z.record(z.string(), TransitionRuleSchema),
});
export type TransitionsConfig = z.infer<typeof TransitionsConfigSchema>;

/**
 * Valida config carregado de YAML. Throws com path se inválido.
 */
export function parseTransitionsConfig(raw: unknown): TransitionsConfig {
  return TransitionsConfigSchema.parse(raw);
}

/**
 * Resultado da avaliação de uma transição contra signals capturados.
 */
export interface TransitionEvaluationResult {
  /** Nome da transição (ex: "brejo_to_baia"). */
  transition_name: string;
  /** True se signals required satisfeitos + janela ok + sem regression. */
  fired: boolean;
  /** Signals que matched required. */
  required_matched: string[];
  /** Signals que matched confirmatory. */
  confirmatory_matched: string[];
  /** Signals que disparariam regressão (se algum, fired=false e estado pode voltar). */
  regression_signals_present: string[];
  /** Razão humana-legível da decisão. */
  reason: string;
  /**
   * Closed-loop v1 (ARCHITECTURE.md §S5 — "promover eixo-status ao patamar do
   * eixo-conceito"): quando feature flag TRIGGER_EVALUATOR_CLOSED_LOOP=true e
   * `fired=true`, planejador enriquece o resultado com a intenção declarativa
   * de aplicar a transição na statusMatrix. Orchestrator consome esse campo
   * pra chamar `apply_status_transition` em motor-execucao e emitir
   * `status_matrix_updated_by_trigger`.
   *
   * Sem este campo (flag OFF ou !fired) → comportamento v0 read-only preservado.
   */
  closed_loop_action?: {
    /** Dimensão alvo na matrix (ex: "emotional"). */
    dimension: string;
    /** Zone alvo derivada do nome da transição (ex: "baia"). */
    target_zone: "brejo" | "baia" | "pasto";
    /** Origem da transição — pra audit + override semantics. */
    source: "trigger_evaluator";
  };
}

/**
 * Avalia uma transição contra signals capturados nos últimos N turns.
 *
 * Read-only: não muta state. Caller (Trigger Evaluator) decide se emite
 * event ou move state. v0: só emite event, statusMatrix continua sob controle
 * manual de inject_status.
 *
 * @param rule Regra da transição
 * @param signalsObserved Lista única de signals presentes (concatenada das últimas N turns)
 * @param turnsSinceLastTransition Janela de turns no estado atual
 * @param signalsPerTurn (opcional) Signals por turno em ordem cronológica
 *   (último é o turno mais recente). Necessário quando rule.consecutive_turns
 *   está definido. Quando ausente e a rule exige consecutive_turns, fired=false.
 */
export function evaluateTransition(
  transitionName: string,
  rule: TransitionRule,
  signalsObserved: string[],
  turnsSinceLastTransition: number,
  signalsPerTurn?: string[][],
): TransitionEvaluationResult {
  const observed = new Set(signalsObserved);
  const requiredMatched = rule.required_signals.filter((s) => observed.has(s));
  const confirmatoryMatched = rule.confirmatory_signals.filter((s) => observed.has(s));
  const regressionSignals = [
    ...(rule.regression_to_brejo_if ?? []),
    ...(rule.regression_to_baia_if ?? []),
  ];
  const regressionPresent = regressionSignals.filter((s) => observed.has(s));

  // Match required: AND vs OR
  const matchMode = rule.match_mode ?? "OR";
  const matchedInTurnSignals = (turnSignals: string[]): boolean => {
    const turnSet = new Set(turnSignals);
    const matchedInTurn = rule.required_signals.filter((s) => turnSet.has(s));
    return matchMode === "AND"
      ? matchedInTurn.length === rule.required_signals.length
      : matchedInTurn.length > 0;
  };

  // BUG-KT-01: consecutive_turns check (DT-A01-03)
  let requiredOk: boolean;
  let consecutiveReason: string | null = null;
  const consecN = rule.consecutive_turns ?? 0;
  if (consecN > 0) {
    if (!signalsPerTurn) {
      requiredOk = false;
      consecutiveReason = `consecutive_turns=${consecN} requires signalsPerTurn (not provided)`;
    } else if (signalsPerTurn.length < consecN) {
      requiredOk = false;
      consecutiveReason = `consecutive_turns=${consecN} requires at least ${consecN} turns observed (got ${signalsPerTurn.length})`;
    } else {
      const lastN = signalsPerTurn.slice(-consecN);
      requiredOk = lastN.every(matchedInTurnSignals);
      if (!requiredOk) {
        consecutiveReason = `required_signals not present in ${consecN} consecutive trailing turns`;
      }
    }
  } else {
    // Legacy: flat observed
    requiredOk =
      matchMode === "AND"
        ? requiredMatched.length === rule.required_signals.length
        : requiredMatched.length > 0;
  }

  // Janela ok?
  const windowOk = turnsSinceLastTransition >= rule.minimum_window_turns;

  // Sem regression?
  const noRegression = regressionPresent.length === 0;

  // BUG-KT-01: confirmatory_min check (DT-A01-02)
  const confMin = rule.confirmatory_min ?? 0;
  const confirmatoryOk = confirmatoryMatched.length >= confMin;

  const fired = requiredOk && windowOk && noRegression && confirmatoryOk;

  let reason: string;
  if (!requiredOk) {
    reason =
      consecutiveReason ??
      `required_signals not matched (${matchMode}, got ${requiredMatched.length}/${rule.required_signals.length})`;
  } else if (!windowOk) {
    reason = `minimum_window_turns not reached (${turnsSinceLastTransition} < ${rule.minimum_window_turns})`;
  } else if (!noRegression) {
    reason = `regression signals present: ${regressionPresent.join(", ")}`;
  } else if (!confirmatoryOk) {
    reason = `confirmatory_min not met (need ${confMin}, got ${confirmatoryMatched.length})`;
  } else {
    reason = `fired — required matched (${requiredMatched.join(", ")})${
      confirmatoryMatched.length > 0
        ? ` + confirmatory (${confirmatoryMatched.join(", ")})`
        : ""
    }${consecN > 0 ? ` × ${consecN} consecutive turns` : ""}`;
  }

  return {
    transition_name: transitionName,
    fired,
    required_matched: requiredMatched,
    confirmatory_matched: confirmatoryMatched,
    regression_signals_present: regressionPresent,
    reason,
  };
}
