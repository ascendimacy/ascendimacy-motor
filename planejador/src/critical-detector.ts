import type { CriticalReason } from "@ascendimacy/shared";

const SIGNAL_TO_REASON: Record<string, CriticalReason> = {
  distress: "distress",
  distress_marker_high: "distress",
  exit: "exit",
  exit_marker_explicit: "exit",
  exit_marker_implicit: "exit",
  sacrifice_rejection: "sacrifice_rejection",
  harm_self: "harm_self",
  harm_self_ideation: "harm_self",
  harm_other: "harm_other",
  harm_other_ideation: "harm_other",
  freeze: "freeze",
  dissociation: "dissociation",
  shutdown: "shutdown",
};

export function detectCritical(signals: string[]): {
  is_critical: boolean;
  critical_reason?: CriticalReason;
} {
  for (const signal of signals) {
    const reason = SIGNAL_TO_REASON[signal];
    if (reason !== undefined) {
      return { is_critical: true, critical_reason: reason };
    }
  }
  return { is_critical: false };
}
