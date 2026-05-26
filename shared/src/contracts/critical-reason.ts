import { z } from "zod";

export const CRITICAL_REASONS = [
  "distress",
  "exit",
  "sacrifice_rejection",
  "harm_self",
  "harm_other",
  "freeze",
  "dissociation",
  "shutdown",
] as const;

export type CriticalReason = (typeof CRITICAL_REASONS)[number];
export const CriticalReasonSchema = z.enum(CRITICAL_REASONS);
