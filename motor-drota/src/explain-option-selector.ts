/**
 * Explain option selection heuristic — v0.3-B.
 *
 * Mesma família do discovery-option-selector mas pra move_type=explain.
 * Recebe pool de framings explicativos (gerados pelo explain-agent) e
 * escolhe um deles baseado em signals + (opcional) engagement.
 *
 * Mapeamento signal → kind preferido:
 *   frame_rejection, authority_questioning → contrast        (devolve com oposto)
 *   voluntary_topic_deepening, mood_drift_up → metaphor      (sujeito em fluxo)
 *   distress_marker_*, mood_drift_down → lineage_anchor      (ancora em tradição)
 *   default                                → concrete_example (carga cognitiva baixa)
 *
 * Diferente de discover, explain NÃO tem fallback de "late_turn" — todo
 * explain turn é uma oportunidade de teach, sem variação artificial por turno.
 */

export type ExplainOptionKind =
  | "concrete_example"
  | "metaphor"
  | "contrast"
  | "lineage_anchor";

export interface ExplainOption {
  kind: string;
  text: string;
  anchor: string;
}

export interface SelectExplainOptionInput {
  options: ExplainOption[];
  signals?: string[];
}

export interface ExplainOptionSelection {
  chosen: ExplainOption;
  reason: string;
}

export function selectExplainOption(
  input: SelectExplainOptionInput,
): ExplainOptionSelection {
  const { options, signals = [] } = input;

  if (!options || options.length === 0) {
    throw new Error("selectExplainOption requires non-empty options");
  }

  if (options.length === 1) {
    return { chosen: options[0]!, reason: "single_option" };
  }

  const priorities: ExplainOptionKind[] = [];
  const reasons: string[] = [];

  const has = (s: string): boolean => signals.includes(s);

  if (has("frame_rejection") || has("authority_questioning")) {
    priorities.push("contrast");
    reasons.push("signal:frame_rejection/authority→contrast");
  }

  if (has("voluntary_topic_deepening") || has("mood_drift_up")) {
    priorities.push("metaphor");
    reasons.push("signal:engagement_up→metaphor");
  }

  if (
    has("distress_marker_low") ||
    has("distress_marker_high") ||
    has("mood_drift_down")
  ) {
    priorities.push("lineage_anchor");
    reasons.push("signal:distress/mood→lineage_anchor");
  }

  priorities.push("concrete_example");
  if (reasons.length === 0) reasons.push("default:concrete_example");

  for (const kind of priorities) {
    const match = options.find((o) => o.kind === kind);
    if (match) {
      return { chosen: match, reason: reasons.join(",") };
    }
  }

  return { chosen: options[0]!, reason: "fallback_no_match" };
}
