/**
 * Unit tests — ActionMenu persistence helpers (S-T-09-05).
 *
 * Cobre round-trip save→load, filename canônico {persona_id}-menu.json,
 * load de arquivo ausente retorna null, e validação no read (rejeita JSON
 * malformado contra o schema). Usa diretório temporário por teste pra
 * isolar IO de fixtures/ reais.
 *
 * Refs: ops#991, ops#989 (capability C-T-09).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  actionMenuFilename,
  actionMenuPath,
  loadActionMenu,
  saveActionMenu,
} from "../src/strategist/action-menu-persistence.js";
import {
  ACTION_MENU_SCHEMA_VERSION,
  type ActionMenu,
} from "../src/strategist/action-menu-schema.js";

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await mkdtemp(path.join(tmpdir(), "action-menu-persist-"));
});

afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

function makeMenu(personaId = "ryo-ochiai"): ActionMenu {
  return {
    persona_id: personaId,
    schema_version: ACTION_MENU_SCHEMA_VERSION,
    generated_at: "2026-05-11T13:00:00.000Z",
    source: { trust_level: 0.5, profile_hash: "sha256:deadbeef" },
    items: [
      {
        id: "challenge-01",
        type: "challenge",
        content: "Tente aprimorar o cross-court hoje",
        weight: 0.75,
      },
      {
        id: "diamond-01",
        type: "cultural_diamond",
        content: "Suzuki Daisetz — relação mestre/discípulo no kendo",
        weight: 0.4,
      },
    ],
  };
}

describe("actionMenuFilename / actionMenuPath", () => {
  it("builds canonical filename {persona_id}-menu.json", () => {
    expect(actionMenuFilename("ryo-ochiai")).toBe("ryo-ochiai-menu.json");
  });

  it("builds path under given baseDir", () => {
    const p = actionMenuPath("kei-ochiai", "/tmp/profiles");
    expect(p).toBe(path.join("/tmp/profiles", "kei-ochiai-menu.json"));
  });
});

describe("saveActionMenu / loadActionMenu — round-trip", () => {
  it("save then load returns deep-equal menu", async () => {
    const menu = makeMenu();
    const target = await saveActionMenu(menu, scratchDir);
    expect(target).toBe(actionMenuPath(menu.persona_id, scratchDir));
    const loaded = await loadActionMenu(menu.persona_id, scratchDir);
    expect(loaded).toEqual(menu);
  });

  it("save creates the file at the canonical path", async () => {
    const menu = makeMenu("kei-ochiai");
    await saveActionMenu(menu, scratchDir);
    const expected = path.join(scratchDir, "kei-ochiai-menu.json");
    const info = await stat(expected);
    expect(info.isFile()).toBe(true);
  });

  it("save creates baseDir if missing", async () => {
    const nested = path.join(scratchDir, "nested", "profiles");
    const menu = makeMenu();
    await saveActionMenu(menu, nested);
    const loaded = await loadActionMenu(menu.persona_id, nested);
    expect(loaded?.persona_id).toBe(menu.persona_id);
  });

  it("save rejects an invalid menu before writing", async () => {
    const bad = makeMenu();
    (bad as unknown as { persona_id: string }).persona_id = "";
    await expect(saveActionMenu(bad, scratchDir)).rejects.toThrow();
  });
});

describe("loadActionMenu — edge cases", () => {
  it("returns null when the file does not exist", async () => {
    const loaded = await loadActionMenu("ghost-persona", scratchDir);
    expect(loaded).toBeNull();
  });

  it("rejects malformed JSON on disk with a parse error", async () => {
    const target = actionMenuPath("ryo-ochiai", scratchDir);
    await writeFile(target, "{ not valid json", "utf-8");
    await expect(loadActionMenu("ryo-ochiai", scratchDir)).rejects.toThrow();
  });

  it("rejects JSON that violates the schema", async () => {
    const target = actionMenuPath("ryo-ochiai", scratchDir);
    const invalid = { persona_id: "", items: [] };
    await writeFile(target, JSON.stringify(invalid), "utf-8");
    await expect(loadActionMenu("ryo-ochiai", scratchDir)).rejects.toThrow();
  });

  it("writes deterministic JSON (pretty-printed, trailing newline)", async () => {
    const menu = makeMenu();
    await saveActionMenu(menu, scratchDir);
    const raw = await readFile(actionMenuPath(menu.persona_id, scratchDir), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain("\n  ");
  });
});
