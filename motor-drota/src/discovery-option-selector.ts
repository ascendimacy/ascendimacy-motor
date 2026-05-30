/**
 * Discovery option selection heuristic — v0.3-A.
 *
 * Em vez de pegar `discoveryOptions[0]` cego, escolhe a pergunta cujo `kind`
 * combina com signals do turn (e, em ausência de sinais, varia por turn pra
 * evitar repetir o mesmo enquadramento sessão inteira).
 *
 * NÃO é um ranqueador genérico: o pool de discovery já vem ranqueado pelo
 * Discovery Agent. Este selector apenas re-prioriza pela situação observada
 * neste turn.
 *
 * Mapeamento signal → kind preferido (em ordem de prioridade):
 *   frame_rejection           → agency_offer       (devolve agência)
 *   deflection_thematic       → gap_check          (sonda o não-dito)
 *   distress_marker_*         → value_observation  (ancora em valores)
 *   mood_drift_down           → value_observation
 *   gatekeeper_resistance     → agency_offer
 *   nenhum sinal + turn >= 3  → bridge_to_artifact (ancora no baralho)
 *   default                   → interest_probe
 *
 * `turn` é 0-indexed (compat com `state.turn` do motor — Turn 1 = 0,
 * Turn 4 = 3). Default=0 mantém comportamento conservador quando ausente.
 */

export type DiscoveryOptionKind =
  | "interest_probe"
  | "gap_check"
  | "agency_offer"
  | "value_observation"
  | "bridge_to_artifact";

export interface DiscoveryOption {
  kind: string;
  text: string;
  anchor: string;
}

export interface SelectDiscoveryOptionInput {
  options: DiscoveryOption[];
  /** signals extraídos no turn (vindos do assessor ou planejador). */
  signals?: string[];
  /** turno corrente (0-indexed — compat com state.turn do motor). */
  turn?: number;
}

export interface DiscoveryOptionSelection {
  chosen: DiscoveryOption;
  reason: string;
}

/**
 * Ordena kinds por prioridade dados signals + turn. Primeira opção do pool
 * cujo kind aparece nessa lista vence. Se nenhum kind do pool casa, devolve
 * options[0] com reason="fallback_no_match".
 */
export function selectDiscoveryOption(
  input: SelectDiscoveryOptionInput,
): DiscoveryOptionSelection {
  const { options, signals = [], turn = 0 } = input;

  if (!options || options.length === 0) {
    throw new Error("selectDiscoveryOption requires non-empty options");
  }

  if (options.length === 1) {
    return { chosen: options[0]!, reason: "single_option" };
  }

  const priorities: DiscoveryOptionKind[] = [];
  const reasons: string[] = [];

  const hasSignal = (s: string): boolean => signals.includes(s);

  if (hasSignal("frame_rejection") || hasSignal("gatekeeper_resistance")) {
    priorities.push("agency_offer");
    reasons.push("signal:frame_rejection→agency_offer");
  }

  if (hasSignal("deflection_thematic")) {
    priorities.push("gap_check");
    reasons.push("signal:deflection_thematic→gap_check");
  }

  if (
    hasSignal("distress_marker_low") ||
    hasSignal("distress_marker_high") ||
    hasSignal("mood_drift_down")
  ) {
    priorities.push("value_observation");
    reasons.push("signal:distress/mood→value_observation");
  }

  const signalDriven = priorities.length > 0;

  if (!signalDriven && turn >= 3) {
    priorities.push("bridge_to_artifact");
    reasons.push("late_turn→bridge_to_artifact");
  }

  priorities.push("interest_probe");
  if (reasons.length === 0) reasons.push("default:interest_probe");

  for (const kind of priorities) {
    const match = options.find((o) => o.kind === kind);
    if (match) {
      return { chosen: match, reason: reasons.join(",") };
    }
  }

  return { chosen: options[0]!, reason: "fallback_no_match" };
}
