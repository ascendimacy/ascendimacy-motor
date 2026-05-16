/**
 * C-T-10-01 menu lookup — lê ActionMenu persistido + retorna top-K como
 * ScoredContentItem[] (conversão shim), com fallback to scoring quando
 * menu ausente/stale.
 *
 * Spec: ops#999 (escopo ratificado Jun 2026-05-14 com decay multiplicativo).
 *
 * Comportamento:
 * 1. Cache singleton in-memory por persona_id (TTL 5min default)
 * 2. Load via `loadActionMenu` quando cache miss/stale
 * 3. Filter: dedupe `used_in_session`
 * 4. Effective weight: `item.weight × (now > expires_at ? 0.3 : 1.0)`
 *    — decay multiplicativo (Jun 2026-05-14: items expirados ainda úteis)
 * 5. Sort desc + take top-K
 * 6. Convert ActionMenuItem → ScoredContentItem (transitional shim)
 *
 * Schema mapping (transitional, decisão Tier 3 ops#999 #4):
 * - `curiosity` → `curiosity_hook` (mesma semântica)
 * - `cultural_diamond` → `cultural_diamond`
 * - `challenge` → `challenge`
 * - `strategy` → `dynamic` (proxy)
 * - `play` → `dynamic` (proxy)
 *
 * Refs: ops#999, motor#85 (persistence), motor#90 (generator), shared
 * scorer.ts (decay legacy — código morto até ops#1067 hidratar).
 */

import type {
  ActionMenu,
  ActionMenuItem,
  ActionMenuItemType,
  ContentItem,
  ContentItemType,
  ScoredContentItem,
} from "@ascendimacy/shared";

import { loadActionMenu } from "./action-menu-persistence.js";

/** Decay factor pra items expirados (Jun ratificou 2026-05-14). */
const EXPIRED_DECAY_FACTOR = 0.3;

/** Cache TTL em ms (5 min). */
const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  menu: ActionMenu | null;
  loadedAt: number;
}

const _cache = new Map<string, CacheEntry>();

/** Test helper — reset cache singleton. */
export function _resetMenuLookupCache(): void {
  _cache.clear();
}

/** Mapping type ActionMenu → ContentItem (transitional shim, ops#999 #4). */
const TYPE_MAP: Record<ActionMenuItemType, ContentItemType> = {
  curiosity: "curiosity_hook",
  cultural_diamond: "cultural_diamond",
  challenge: "challenge",
  strategy: "dynamic",
  play: "dynamic",
};

export interface MenuLookupOptions {
  /** Item ids já usados nesta sessão (motor#23 penalty). */
  usedInSession?: ReadonlyArray<string>;
  /** Top-K a retornar (default 5). */
  topK?: number;
  /** Override de "now" pra testabilidade determinística. ISO 8601. */
  nowIso?: string;
  /** Override do baseDir (testes). */
  baseDirOverride?: string;
  /** Bypass cache (testes ou refresh explícito). */
  bypassCache?: boolean;
}

export interface MenuLookupResult {
  /** Items convertidos pra ScoredContentItem com isaLabels populados. */
  items: ScoredContentItem[];
  /** Diagnóstico: por que o lookup retornou esse resultado. */
  outcome: "ok" | "menu_missing" | "menu_stale" | "no_eligible_items";
  /** Metadata pra telemetria. */
  diagnostics: {
    menuValidUntil?: string;
    itemsConsidered: number;
    itemsAfterUsedFilter: number;
    itemsAfterTopK: number;
  };
}

/**
 * Lookup completo — pega menu (cache ou disco), filtra, scora, converte.
 *
 * Retorna `outcome: "ok"` apenas quando menu existe + items elegíveis
 * sobram após filter. Caller decide fallback to scoring no `menu_missing`,
 * `menu_stale`, ou `no_eligible_items`.
 */
export async function lookupActionMenu(
  personaId: string,
  baseDir: string,
  options: MenuLookupOptions = {},
): Promise<MenuLookupResult> {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const topK = options.topK ?? 5;
  const usedInSession = new Set(options.usedInSession ?? []);

  // 1. Cache check
  let menu: ActionMenu | null;
  const cacheKey = `${personaId}::${baseDir}`;
  if (!options.bypassCache) {
    const cached = _cache.get(cacheKey);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      menu = cached.menu;
    } else {
      menu = await loadActionMenu(personaId, options.baseDirOverride ?? baseDir);
      _cache.set(cacheKey, { menu, loadedAt: Date.now() });
    }
  } else {
    menu = await loadActionMenu(personaId, options.baseDirOverride ?? baseDir);
  }

  if (menu === null) {
    return {
      items: [],
      outcome: "menu_missing",
      diagnostics: {
        itemsConsidered: 0,
        itemsAfterUsedFilter: 0,
        itemsAfterTopK: 0,
      },
    };
  }

  // 2. Menu stale (top-level valid_until)
  if (menu.valid_until && Date.parse(menu.valid_until) < nowMs) {
    return {
      items: [],
      outcome: "menu_stale",
      diagnostics: {
        menuValidUntil: menu.valid_until,
        itemsConsidered: menu.items.length,
        itemsAfterUsedFilter: 0,
        itemsAfterTopK: 0,
      },
    };
  }

  // 3. Filter + score
  const itemsConsidered = menu.items.length;
  const afterUsedFilter = menu.items.filter((it) => !usedInSession.has(it.id));
  const itemsAfterUsedFilter = afterUsedFilter.length;

  if (afterUsedFilter.length === 0) {
    return {
      items: [],
      outcome: "no_eligible_items",
      diagnostics: {
        menuValidUntil: menu.valid_until ?? undefined,
        itemsConsidered,
        itemsAfterUsedFilter: 0,
        itemsAfterTopK: 0,
      },
    };
  }

  // 4. Effective weight + sort
  const scored = afterUsedFilter.map((it) => {
    const expired =
      it.expires_at != null && Date.parse(it.expires_at) < nowMs;
    const effectiveWeight = expired
      ? it.weight * EXPIRED_DECAY_FACTOR
      : it.weight;
    return { item: it, effectiveWeight, expired };
  });
  scored.sort((a, b) => b.effectiveWeight - a.effectiveWeight);

  // 5. Top-K + shim conversion
  const topItems = scored.slice(0, topK);
  const items: ScoredContentItem[] = topItems.map(
    ({ item, effectiveWeight, expired }) =>
      convertToScoredContentItem(item, effectiveWeight, expired),
  );

  return {
    items,
    outcome: "ok",
    diagnostics: {
      menuValidUntil: menu.valid_until ?? undefined,
      itemsConsidered,
      itemsAfterUsedFilter,
      itemsAfterTopK: items.length,
    },
  };
}

/**
 * Shim conversion ActionMenuItem → ScoredContentItem.
 *
 * Mantém `isaLabels` populado pra downstream consumir; type mapping
 * usa proxies (TYPE_MAP) pra atender contract.
 *
 * Campos do ContentItemBase não-existentes em ActionMenuItem ficam com
 * defaults conservadores (Tier 3 schema convergence depois resolve).
 */
function convertToScoredContentItem(
  item: ActionMenuItem,
  effectiveWeight: number,
  expired: boolean,
): ScoredContentItem {
  const contentType = TYPE_MAP[item.type];
  // Defaults pros campos required do ContentItemBase ausentes em ActionMenuItem.
  // Tipo discriminado depende de contentType — pegamos a forma genérica via cast.
  const baseFields = {
    id: item.id,
    type: contentType,
    domain: "action_menu",
    casel_target: [] as never,
    age_range: [7, 17] as [number, number],
    surprise: Math.round(item.weight * 10),
    verified: true,
    base_score: Math.round(item.weight * 10),
  };

  // Type-specific fields — minimos pra cada discriminator
  let typedItem: ContentItem;
  switch (contentType) {
    case "curiosity_hook":
      typedItem = {
        ...baseFields,
        type: "curiosity_hook",
        fact: item.content,
        bridge: "",
        quest: "",
        sacrifice_type: "reflect",
      } as ContentItem;
      break;
    case "cultural_diamond":
      typedItem = {
        ...baseFields,
        type: "cultural_diamond",
        fact: item.content,
        bridge: "",
        quest: "",
        sacrifice_type: "reflect",
      } as ContentItem;
      break;
    case "challenge":
      typedItem = {
        ...baseFields,
        type: "challenge",
        description: item.content,
        expected_outcome: "",
        estimated_minutes: 10,
      } as ContentItem;
      break;
    case "dynamic":
      typedItem = {
        ...baseFields,
        type: "dynamic",
        title: item.id,
        setup: item.content,
        execution: "",
        closing: "",
        multi_turn: false,
      } as ContentItem;
      break;
    default:
      // Fallback impossível dado TYPE_MAP exhaustivo — guard pro compiler.
      typedItem = baseFields as unknown as ContentItem;
  }

  const reasons = [
    `from_action_menu (effective_weight=${effectiveWeight.toFixed(2)})`,
  ];
  if (expired) {
    reasons.push(`decay_applied (expired, factor=${EXPIRED_DECAY_FACTOR})`);
  }

  return {
    item: typedItem,
    score: effectiveWeight * 10, // scale to scoring conventions (~[0,10])
    reasons,
    isaLabels: {
      played_as: item.played_as,
      intensity: item.intensity,
      is_critical: item.is_critical,
    },
  };
}
