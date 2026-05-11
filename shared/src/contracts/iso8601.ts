import { z } from "zod";

// ISO 8601 datetime — refinement compartilhado pelos contratos do Plano Tático.
// Pattern herdado de shared/src/mood.ts (MoodReadingSchema.at).
export const Iso8601DateTime = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s),
  { message: "must be ISO 8601 datetime string" },
);
