import { z } from "zod";
import { Iso8601DateTime } from "./iso8601.js";

export const MilestoneEventTypeSchema = z.enum([
  "first_avowal",
  "fear_named",
  "conflict_resolved",
  "value_articulated",
  "virtue_practiced",
  "regression_recognized",
  "sacrifice_chosen",
  "repair_initiated",
]);

export const MILESTONE_EVENT_TYPES = MilestoneEventTypeSchema.options;
export type MilestoneEventType = z.infer<typeof MilestoneEventTypeSchema>;

export const MilestoneEventSchema = z.object({
  type: MilestoneEventTypeSchema,
  axis: z.string().min(1),
  evidence: z.string().min(1),
  persona: z.string().min(1),
  timestamp: Iso8601DateTime,
});

export type MilestoneEvent = z.infer<typeof MilestoneEventSchema>;
