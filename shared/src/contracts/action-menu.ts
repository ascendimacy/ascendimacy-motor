/**
 * ActionMenu schema — contrato compartilhado entre workspaces.
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
 * **Histórico de localização:**
 * - S-T-09-01 (motor#85): nascimento em `planejador/src/strategist/`.
 * - H-AC-01 (motor#87 → #89): bump v0.2 com campos ISA opcionais.
 * - S-T-09-02 + H-AC-02 (motor#88): movido para `shared/src/contracts/` —
 *   motor-drota também passa a consumir (gerador LLM), schema vira
 *   contrato cross-workspace canônico.
 *
 * Refs: ops#989 (capability C-T-09), ops#991 (Sprint 1 tracker), ops#993
 * (S-T-09-02), motor#88 (H-AC-02).
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

/**
 * Jogada da ISA pedagógica eBrota Kids instanciada por este item.
 *
 * Cinco jogadas canônicas + recovery. Refs:
 * `ascendimacy-ops/docs/specs/jogada-cases-v0.1/` (7 samples),
 * `ascendimacy-ops/docs/architecture/2026-05-12-maquina-pedagogia-norte.md` §3.2,
 * Delta §5.6 — mapeamento 5 jogadas ↔ movimentos genéricos.
 *
 * Adicionado em v0.2 (motor#87, H-AC-01). Opcional para preservar backward
 * compat com menus persistidos pré-v0.2.
 */
export const PLAYED_AS_VALUES = [
  "bridge",
  "espelho",
  "canal",
  "diamante",
  "arena",
  "recovery",
] as const;

export const PlayedAsSchema = z.enum(PLAYED_AS_VALUES);
export type PlayedAs = z.infer<typeof PlayedAsSchema>;

/**
 * Intensidade da jogada — `soft` / `medium` / `firm`. Combina com
 * `played_as` para qualificar a entrega (ex: `challenge` + `firm`
 * dispara guardrail crítico futuro em H-AC-07).
 *
 * Adicionado em v0.2 (motor#87, H-AC-01).
 */
export const INTENSITY_VALUES = ["soft", "medium", "firm"] as const;

export const IntensitySchema = z.enum(INTENSITY_VALUES);
export type Intensity = z.infer<typeof IntensitySchema>;

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
  /**
   * ISO 8601. Item ignorado pelo lookup quando `now > expires_at`.
   *
   * `.nullable().optional()` (`nullish`) — aceita ausência do campo, `null`
   * explícito, ou string ISO. Fix simétrico ao comportamento observado em
   * LLMs (Qwen3-30B emite `"expires_at": null` em vez de omitir o campo).
   * Ref: ops#TBD diagnose 2026-05-14 — schema_error_first em ~50% dos runs
   * causado por `expires_at: null` falhando Zod optional check.
   */
  expires_at: iso8601String.nullable().optional(),
  /**
   * Rotulagem ISA pedagógica (v0.2, motor#87 H-AC-01). Opcional —
   * legacy menus sem esses campos continuam válidos. População LLM
   * automática fica para H-AC-02; emissão de `move_emitted` no trace
   * para H-AC-03.
   */
  played_as: PlayedAsSchema.optional(),
  intensity: IntensitySchema.optional(),
  /**
   * `true` para movimentos críticos — `recovery` (regulate) e
   * `diamante` + `firm` (challenge.firm). Guardrail correspondente
   * fica em H-AC-07; aqui apenas o rótulo. Default omitido = `false`.
   */
  is_critical: z.boolean().optional(),
});
export type ActionMenuItem = z.infer<typeof ActionMenuItemSchema>;

/**
 * Procedência do menu — facilita audit (qual hash de profile / eixos)
 * e fallback (se trust_level baixo, lookup pode ser conservador).
 *
 * `profile_hash` / `eixos_state_hash`: `.nullable().optional()` — LLMs
 * (Qwen3-30B observado) emitem `null` em vez de omitir o campo. Mesmo
 * padrão do fix em `expires_at` (motor#98). Ref: ops#1058 diagnose
 * 2026-05-14 — schema_error_first por null em campo opt.
 */
export const ActionMenuSourceSchema = z.object({
  trust_level: z.number().min(0).max(1),
  profile_hash: z.string().nullable().optional(),
  eixos_state_hash: z.string().nullable().optional(),
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
    /**
     * Quando `now > valid_until`, o menu inteiro é considerado stale.
     * `.nullable().optional()` — simétrico aos outros campos optional ISO
     * (LLMs emitem null em vez de omitir). Ref: motor#98.
     */
    valid_until: iso8601String.nullable().optional(),
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

/**
 * Versão atual do schema serializado. Bumpa em quebras de compat.
 *
 * - v0.1.0: shape inicial (motor#85, S-T-09-01).
 * - v0.2.0: campos opcionais `played_as` / `intensity` / `is_critical`
 *   em sub-items (motor#87, H-AC-01). Não-breaking; legacy menus parseiam.
 */
export const ACTION_MENU_SCHEMA_VERSION = "v0.2.0";

/** Parse + throw em invalido. Usado em load e antes de save. */
export function parseActionMenu(raw: unknown): ActionMenu {
  return ActionMenuSchema.parse(raw);
}
