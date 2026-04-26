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
  /** Signals confirmatórios — não bloqueiam, mas elevam confidence. */
  confirmatory_signals: z.array(z.string()).default([]),
  /** Signals que regridem o estado (se aparecem, transição não acontece + estado pode voltar). */
  regression_to_brejo_if: z.array(z.string()).optional(),
  regression_to_baia_if: z.array(z.string()).optional(),
  /** Match mode pros required signals. Default OR pra v0. */
  match_mode: TransitionMatchMode.optional(),
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
 */
export function evaluateTransition(
  transitionName: string,
  rule: TransitionRule,
  signalsObserved: string[],
  turnsSinceLastTransition: number,
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
  const requiredOk =
    matchMode === "AND"
      ? requiredMatched.length === rule.required_signals.length
      : requiredMatched.length > 0;

  // Janela ok?
  const windowOk = turnsSinceLastTransition >= rule.minimum_window_turns;

  // Sem regression?
  const noRegression = regressionPresent.length === 0;

  const fired = requiredOk && windowOk && noRegression;

  let reason: string;
  if (!requiredOk) {
    reason = `required_signals not matched (${matchMode}, got ${requiredMatched.length}/${rule.required_signals.length})`;
  } else if (!windowOk) {
    reason = `minimum_window_turns not reached (${turnsSinceLastTransition} < ${rule.minimum_window_turns})`;
  } else if (!noRegression) {
    reason = `regression signals present: ${regressionPresent.join(", ")}`;
  } else {
    reason = `fired — required matched (${requiredMatched.join(", ")})${
      confirmatoryMatched.length > 0
        ? ` + confirmatory (${confirmatoryMatched.join(", ")})`
        : ""
    }`;
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
