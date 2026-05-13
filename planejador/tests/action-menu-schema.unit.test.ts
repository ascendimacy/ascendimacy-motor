/**
 * Unit tests — ActionMenu Zod schema (S-T-09-01).
 *
 * Cobre casos positivos (menu válido completo / mínimo / todos os tipos)
 * e negativos (id vazio, weight fora de [0,1], tipo desconhecido, data
 * inválida, ids duplicados). Validação determinística, zero rede.
 *
 * Refs: ops#991, ops#989 (capability C-T-09).
 */

import { describe, it, expect } from "vitest";
import {
  ACTION_MENU_ITEM_TYPES,
  ACTION_MENU_SCHEMA_VERSION,
  ActionMenuSchema,
  INTENSITY_VALUES,
  PLAYED_AS_VALUES,
  parseActionMenu,
  type ActionMenu,
  type ActionMenuItem,
} from "../src/strategist/action-menu-schema.js";

function baseValidMenu(): ActionMenu {
  return {
    persona_id: "ryo-ochiai",
    schema_version: ACTION_MENU_SCHEMA_VERSION,
    generated_at: "2026-05-11T13:00:00.000Z",
    source: { trust_level: 0.42 },
    items: [
      {
        id: "curio-01",
        type: "curiosity",
        content: "Por que o backhand cross-court engana o adversário?",
        weight: 0.8,
      },
    ],
  };
}

describe("ActionMenuSchema — positive cases", () => {
  it("accepts a fully populated menu with all optional fields", () => {
    const menu: ActionMenu = {
      persona_id: "kei-ochiai",
      schema_version: ACTION_MENU_SCHEMA_VERSION,
      generated_at: "2026-05-11T13:00:00.000Z",
      valid_until: "2026-05-18T13:00:00.000Z",
      source: {
        trust_level: 0.67,
        profile_hash: "sha256:abcdef",
        eixos_state_hash: "sha256:123456",
      },
      items: ACTION_MENU_ITEM_TYPES.map((type, i) => ({
        id: `item-${i}`,
        type,
        content: `seed content for ${type}`,
        weight: 0.5,
        expires_at: "2026-05-18T13:00:00.000Z",
      })),
    };
    expect(() => parseActionMenu(menu)).not.toThrow();
  });

  it("accepts a minimal menu without optional fields", () => {
    expect(() => parseActionMenu(baseValidMenu())).not.toThrow();
  });

  it("accepts an empty items array", () => {
    const menu = baseValidMenu();
    menu.items = [];
    expect(() => parseActionMenu(menu)).not.toThrow();
  });

  it("accepts weight at boundaries 0 and 1", () => {
    const menu = baseValidMenu();
    menu.items = [
      { id: "a", type: "challenge", content: "min", weight: 0 },
      { id: "b", type: "strategy", content: "max", weight: 1 },
    ];
    expect(() => parseActionMenu(menu)).not.toThrow();
  });

  it("exposes all five item types in the canonical enum", () => {
    expect(new Set(ACTION_MENU_ITEM_TYPES)).toEqual(
      new Set([
        "curiosity",
        "challenge",
        "strategy",
        "play",
        "cultural_diamond",
      ]),
    );
  });
});

describe("ActionMenuSchema — negative cases", () => {
  it("rejects empty persona_id", () => {
    const menu = baseValidMenu();
    menu.persona_id = "";
    expect(() => parseActionMenu(menu)).toThrow();
  });

  it("rejects weight > 1", () => {
    const menu = baseValidMenu();
    menu.items[0]!.weight = 1.1;
    expect(() => parseActionMenu(menu)).toThrow();
  });

  it("rejects weight < 0", () => {
    const menu = baseValidMenu();
    menu.items[0]!.weight = -0.01;
    expect(() => parseActionMenu(menu)).toThrow();
  });

  it("rejects unknown item type", () => {
    const menu = baseValidMenu();
    (menu.items[0] as unknown as { type: string }).type = "metaphor";
    expect(() => parseActionMenu(menu)).toThrow();
  });

  it("rejects non-ISO generated_at", () => {
    const menu = baseValidMenu();
    menu.generated_at = "11/05/2026";
    expect(() => parseActionMenu(menu)).toThrow();
  });

  it("rejects duplicate item ids", () => {
    const menu = baseValidMenu();
    const dup: ActionMenuItem = {
      id: "curio-01",
      type: "challenge",
      content: "duplicate id",
      weight: 0.5,
    };
    menu.items.push(dup);
    expect(() => parseActionMenu(menu)).toThrow(/duplicate item id/);
  });

  it("rejects trust_level > 1", () => {
    const menu = baseValidMenu();
    menu.source.trust_level = 1.5;
    expect(() => parseActionMenu(menu)).toThrow();
  });

  it("returns a SafeParse error result without throwing when using safeParse", () => {
    const menu = baseValidMenu();
    menu.persona_id = "";
    const result = ActionMenuSchema.safeParse(menu);
    expect(result.success).toBe(false);
  });
});

describe("ActionMenuSchema — ISA pedagogical labels (H-AC-01)", () => {
  it("accepts item labeled with played_as + intensity + is_critical", () => {
    const menu = baseValidMenu();
    menu.items[0] = {
      id: "curio-01",
      type: "curiosity",
      content: "labeled item",
      weight: 0.8,
      played_as: "bridge",
      intensity: "medium",
      is_critical: false,
    };
    expect(() => parseActionMenu(menu)).not.toThrow();
  });

  it("accepts item without any of the 3 new fields (backward compat)", () => {
    const menu = baseValidMenu();
    expect(menu.items[0]).not.toHaveProperty("played_as");
    expect(menu.items[0]).not.toHaveProperty("intensity");
    expect(menu.items[0]).not.toHaveProperty("is_critical");
    expect(() => parseActionMenu(menu)).not.toThrow();
  });

  it("accepts a menu mixing labeled and unlabeled items", () => {
    const menu = baseValidMenu();
    menu.items.push({
      id: "play-01",
      type: "play",
      content: "labeled play",
      weight: 0.55,
      played_as: "diamante",
      intensity: "firm",
      is_critical: true,
    });
    expect(() => parseActionMenu(menu)).not.toThrow();
  });

  it("accepts all played_as enum values", () => {
    const menu = baseValidMenu();
    menu.items = PLAYED_AS_VALUES.map((played_as, i) => ({
      id: `it-${i}`,
      type: "play" as const,
      content: `seed for ${played_as}`,
      weight: 0.5,
      played_as,
    }));
    expect(() => parseActionMenu(menu)).not.toThrow();
  });

  it("accepts all intensity enum values", () => {
    const menu = baseValidMenu();
    menu.items = INTENSITY_VALUES.map((intensity, i) => ({
      id: `it-${i}`,
      type: "challenge" as const,
      content: `seed for ${intensity}`,
      weight: 0.5,
      intensity,
    }));
    expect(() => parseActionMenu(menu)).not.toThrow();
  });

  it("rejects played_as outside the canonical enum", () => {
    const menu = baseValidMenu();
    (menu.items[0] as unknown as { played_as: string }).played_as = "scaffold";
    expect(() => parseActionMenu(menu)).toThrow();
  });

  it("rejects intensity outside the canonical enum", () => {
    const menu = baseValidMenu();
    (menu.items[0] as unknown as { intensity: string }).intensity = "savage";
    expect(() => parseActionMenu(menu)).toThrow();
  });

  it("rejects non-boolean is_critical", () => {
    const menu = baseValidMenu();
    (menu.items[0] as unknown as { is_critical: unknown }).is_critical = "yes";
    expect(() => parseActionMenu(menu)).toThrow();
  });

  it("exposes the canonical played_as enum (bridge/espelho/canal/diamante/arena/recovery)", () => {
    expect(new Set(PLAYED_AS_VALUES)).toEqual(
      new Set([
        "bridge",
        "espelho",
        "canal",
        "diamante",
        "arena",
        "recovery",
      ]),
    );
  });

  it("exposes the canonical intensity enum (soft/medium/firm)", () => {
    expect(new Set(INTENSITY_VALUES)).toEqual(
      new Set(["soft", "medium", "firm"]),
    );
  });

  it("schema_version is bumped to v0.2 (minor, non-breaking)", () => {
    expect(ACTION_MENU_SCHEMA_VERSION).toMatch(/^v0\.2(\.|$)/);
  });

  it("parses the canonical exemplo-menu fixture (legacy, no ISA fields)", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const fixturePath = path.resolve(
      __dirname,
      "..",
      "..",
      "fixtures",
      "profiles",
      "exemplo-menu.json",
    );
    const raw = JSON.parse(await readFile(fixturePath, "utf-8")) as Record<
      string,
      unknown
    >;
    // Fixture predates v0.2 bump — patch version locally so parse focuses on
    // the items-level backward compat guarantee. (Migration of fixture
    // versions is out-of-scope per issue motor#87.)
    raw.schema_version = ACTION_MENU_SCHEMA_VERSION;
    expect(() => parseActionMenu(raw)).not.toThrow();
  });
});
