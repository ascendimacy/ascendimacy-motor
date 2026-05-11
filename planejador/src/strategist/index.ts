/**
 * Strategist — gera e persiste o ActionMenu pós-compaction.
 *
 * PR1 (S-T-09-01 + S-T-09-05): schema + persistência.
 * PRs futuros: generation LLM-backed (S-T-09-02), triggers (S-T-09-03/04),
 * telemetria (S-T-09-07), LLM-LOCAL integration (S-T-09-06).
 *
 * Refs: ops#989, ops#991.
 */

export {
  ACTION_MENU_ITEM_TYPES,
  ACTION_MENU_SCHEMA_VERSION,
  ActionMenuItemSchema,
  ActionMenuItemTypeSchema,
  ActionMenuSchema,
  ActionMenuSourceSchema,
  parseActionMenu,
  type ActionMenu,
  type ActionMenuItem,
  type ActionMenuItemType,
  type ActionMenuSource,
} from "./action-menu-schema.js";

export {
  actionMenuFilename,
  actionMenuPath,
  loadActionMenu,
  saveActionMenu,
} from "./action-menu-persistence.js";
