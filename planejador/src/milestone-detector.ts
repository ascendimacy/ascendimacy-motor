import type { MilestoneEvent, MilestoneEventType } from "@ascendimacy/shared";

interface Rule {
  type: MilestoneEventType;
  axis: string;
  /** Lowercase Portuguese phrases to match in message. */
  phrases: string[];
  /** Semantic signal keys that also trigger this milestone (checked in signals[]). */
  signalKeys?: string[];
}

// Rules ordered from most specific to most generic to avoid false positives.
// repair_initiated and regression_recognized must precede virtue_practiced
// because generic phrases like "fiz" and "consegui" appear in repair/regression
// contexts too.
const RULES: Rule[] = [
  {
    type: "first_avowal",
    axis: "autoconhecimento",
    phrases: ["eu sei", "eu aprendi", "eu entendo agora"],
  },
  {
    type: "fear_named",
    axis: "coragem",
    phrases: ["tenho medo", "me assusta", "fico com medo"],
  },
  {
    type: "conflict_resolved",
    axis: "justiça",
    phrases: ["resolvemos", "chegamos a um acordo", "ficou resolvido"],
    signalKeys: ["resolution", "agreement", "conflict_resolved"],
  },
  {
    type: "value_articulated",
    axis: "honestidade",
    phrases: ["é importante", "eu acredito", "o que mais importa"],
  },
  {
    type: "regression_recognized",
    axis: "prudência",
    phrases: ["errei de novo", "voltei a", "não consegui"],
  },
  {
    type: "sacrifice_chosen",
    axis: "temperança",
    phrases: ["prefiro", "escolho", "mesmo que seja difícil"],
  },
  {
    type: "repair_initiated",
    axis: "justiça",
    phrases: ["desculpa", "quero consertar", "fiz errado e"],
  },
  {
    type: "virtue_practiced",
    axis: "temperança",
    phrases: ["consegui", "fiz", "terminei"],
  },
];

export function detectMilestone(
  message: string,
  signals: string[],
  persona: string,
): MilestoneEvent | null {
  const lower = message.toLowerCase();

  for (const rule of RULES) {
    const phraseMatch = rule.phrases.some((p) => lower.includes(p));
    const signalMatch =
      rule.signalKeys !== undefined &&
      signals.some((s) => rule.signalKeys!.includes(s));

    if (phraseMatch || signalMatch) {
      return {
        type: rule.type,
        axis: rule.axis,
        evidence: message.slice(0, 200),
        persona,
        timestamp: new Date().toISOString(),
      };
    }
  }

  return null;
}
