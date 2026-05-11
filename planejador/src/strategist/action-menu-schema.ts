/**
 * ActionMenu schema (S-T-09-01).
 *
 * Estrutura do menu de ação pré-cozido pelo Estrategista pós-compaction:
 * cinco categorias de itens (curiosidades, desafios, estratégias, jogadas
 * oportunas, diamantes culturais), cada um com `weight` e `expires_at`
 * opcional. Per-turn lookup determinístico (C-T-10) substitui pool scoring
 * com base nesses itens — ver ops#990.
 *
 * Validação Zod é fronteira de runtime: invocada em load de fixture
 * (action-menu-persistence.ts) e antes de qualquer save. Per-turn lookup
 * NÃO revalida (assume schema-valid em memória).
 *
 * Refs: ops#989 (capability C-T-09), ops#991 (Sprint 1 tracker).
 */

import { z } from "zod";

/** Cinco categorias canônicas — mapeamento direto da spec C-T-09. */
export const ACTION_MENU_ITEM_TYPES = [
  "curiosity",
  "challenge",
  "strategy",
  "play",
  "cultural_diamond",
] as const;

export const ActionMenuItemTypeSchema = z.enum(ACTION_MENU_ITEM_TYPES);
export type ActionMenuItemType = z.infer<typeof ActionMenuItemTypeSchema>;

const ISO_8601_PREFIX = /^\d{4}-\d{2}-\d{2}T/;

const iso8601String = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)) && ISO_8601_PREFIX.test(s),
  { message: "must be ISO 8601 datetime string" },
);

export const ActionMenuItemSchema = z.object({
  id: z.string().min(1),
  type: ActionMenuItemTypeSchema,
  content: z.string().min(1),
  /** Peso de relevância normalizado em [0, 1]. */
  weight: z.number().min(0).max(1),
  /** ISO 8601. Item ignorado pelo lookup quando `now > expires_at`. */
  expires_at: iso8601String.optional(),
});
export type ActionMenuItem = z.infer<typeof ActionMenuItemSchema>;

/**
 * Procedência do menu — facilita audit (qual hash de profile / eixos)
 * e fallback (se trust_level baixo, lookup pode ser conservador).
 */
export const ActionMenuSourceSchema = z.object({
  trust_level: z.number().min(0).max(1),
  profile_hash: z.string().optional(),
  eixos_state_hash: z.string().optional(),
});
export type ActionMenuSource = z.infer<typeof ActionMenuSourceSchema>;

/**
 * Schema do menu inteiro. `superRefine` enforce unicidade de item ids
 * (lookup determinístico precisa de chave única).
 */
export const ActionMenuSchema = z
  .object({
    persona_id: z.string().min(1),
    /** Bump quando o shape muda. Consumers checam antes de parse. */
    schema_version: z.string().min(1),
    generated_at: iso8601String,
    /** Quando `now > valid_until`, o menu inteiro é considerado stale. */
    valid_until: iso8601String.optional(),
    source: ActionMenuSourceSchema,
    items: z.array(ActionMenuItemSchema),
  })
  .superRefine((menu, ctx) => {
    const seen = new Set<string>();
    for (const [i, item] of menu.items.entries()) {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate item id "${item.id}"`,
          path: ["items", i, "id"],
        });
      }
      seen.add(item.id);
    }
  });
export type ActionMenu = z.infer<typeof ActionMenuSchema>;

/** Versão atual do schema serializado. Bumpa em quebras de compat. */
export const ACTION_MENU_SCHEMA_VERSION = "v0.1.0";

/** Parse + throw em invalido. Usado em load e antes de save. */
export function parseActionMenu(raw: unknown): ActionMenu {
  return ActionMenuSchema.parse(raw);
}
