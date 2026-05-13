/**
 * Strategist — gera e persiste o ActionMenu pós-compaction.
 *
 * - PR1 (S-T-09-01 + S-T-09-05): schema + persistência.
 * - PR2 (S-T-09-02 + H-AC-02, motor#88): schema movido para
 *   `@ascendimacy/shared/contracts/action-menu` (cross-workspace);
 *   generator vive em motor-drota. Persistência permanece aqui (única
 *   consumer da fronteira disco).
 *
 * Re-export dos símbolos canônicos via shared para preservar a API
 * pública anterior (consumers ainda importam de `@ascendimacy/planejador`
 * por compatibilidade, embora shared seja a fonte canônica).
 *
 * Refs: ops#989, ops#991, ops#993, motor#88.
 */

export {
  ACTION_MENU_ITEM_TYPES,
  ACTION_MENU_SCHEMA_VERSION,
  ActionMenuItemSchema,
  ActionMenuItemTypeSchema,
  ActionMenuSchema,
  ActionMenuSourceSchema,
  INTENSITY_VALUES,
  IntensitySchema,
  parseActionMenu,
  PLAYED_AS_VALUES,
  PlayedAsSchema,
  type ActionMenu,
  type ActionMenuItem,
  type ActionMenuItemType,
  type ActionMenuSource,
  type Intensity,
  type PlayedAs,
} from "@ascendimacy/shared";

export {
  actionMenuFilename,
  actionMenuPath,
  loadActionMenu,
  saveActionMenu,
} from "./action-menu-persistence.js";
