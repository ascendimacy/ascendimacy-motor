/**
 * DrillItem — unidade atômica do subsistema B2 (Drilling).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md
 *
 * B2 é paralelo a S1-S5. Items são declarativos, curados, agrupados em banks.
 * LLM aqui não decide o item — apenas materializa variantes ao redor dele.
 */

import { z } from "zod";

export const DRILL_ITEM_TYPES = ["vocab", "fact", "pattern"] as const;
export const DrillItemTypeSchema = z.enum(DRILL_ITEM_TYPES);
export type DrillItemType = z.infer<typeof DrillItemTypeSchema>;

export const DrillDifficultySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type DrillDifficulty = z.infer<typeof DrillDifficultySchema>;

export const DRILL_REGISTERS = ["casual", "formal"] as const;
export const DrillRegisterSchema = z.enum(DRILL_REGISTERS);
export type DrillRegister = z.infer<typeof DrillRegisterSchema>;

export const DrillItemPayloadSchema = z.object({
  prompt: z.string().min(1),
  answer: z.string().min(1),
  accept_variants: z.array(z.string()).optional(),
  hint: z.string().optional(),
  audio_uri: z.string().optional(),
});
export type DrillItemPayload = z.infer<typeof DrillItemPayloadSchema>;

export const DrillItemCulturalMetadataSchema = z.object({
  register: DrillRegisterSchema,
  domain: z.string().min(1),
});
export type DrillItemCulturalMetadata = z.infer<
  typeof DrillItemCulturalMetadataSchema
>;

/**
 * Shape comum a items em banco YAML (sem `bank_id`, herdado do header).
 * `loadBank` denormaliza injetando `bank_id` em cada item resultante.
 */
export const DrillItemBaseSchema = z.object({
  id: z.string().min(1),
  type: DrillItemTypeSchema,
  axis: z.string().min(1),
  difficulty: DrillDifficultySchema,
  payload: DrillItemPayloadSchema,
  prerequisites: z.array(z.string()).optional(),
  cultural_metadata: DrillItemCulturalMetadataSchema.optional(),
});
export type DrillItemBase = z.infer<typeof DrillItemBaseSchema>;

export const DrillItemSchema = DrillItemBaseSchema.extend({
  bank_id: z.string().min(1),
});
export type DrillItem = z.infer<typeof DrillItemSchema>;

export const DrillBankSchema = z.object({
  bank_id: z.string().min(1),
  title: z.string().min(1),
  curator: z.string().min(1),
  license: z.string().min(1).optional(),
  target_personas: z.array(z.string()).optional(),
  items: z.array(DrillItemBaseSchema),
});
export type DrillBank = z.infer<typeof DrillBankSchema>;

export function parseDrillBank(raw: unknown): DrillBank {
  return DrillBankSchema.parse(raw);
}
