/**
 * Unit tests — menu-lookup (C-T-10-01, ops#999).
 *
 * Cobre cache + filter + decay multiplicativo + conversion shim.
 * Usa scratch dir + saveActionMenu real pra round-trip realista.
 */

import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ActionMenu, PlayedAs, Intensity } from "@ascendimacy/shared";
import { saveActionMenu } from "../src/strategist/action-menu-persistence.js";
import {
  lookupActionMenu,
  _resetMenuLookupCache,
} from "../src/strategist/menu-lookup.js";

let scratchDir: string;

beforeEach(async () => {
  _resetMenuLookupCache();
  scratchDir = await mkdtemp(path.join(tmpdir(), "menu-lookup-"));
});

afterEach(async () => {
  _resetMenuLookupCache();
  await rm(scratchDir, { recursive: true, force: true });
});

function makeMenu(args: {
  personaId?: string;
  items: Array<{
    id: string;
    type?: "curiosity" | "challenge" | "strategy" | "play" | "cultural_diamond";
    weight: number;
    expires_at?: string;
    played_as?: PlayedAs;
    intensity?: Intensity;
    is_critical?: boolean;
  }>;
  validUntil?: string;
  strategicRationale?: string;
  contextHints?: Record<string, unknown>;
}): ActionMenu {
  return {
    persona_id: args.personaId ?? "test-persona",
    schema_version: "v0.2.0",
    generated_at: "2026-05-14T10:00:00.000Z",
    valid_until: args.validUntil,
    source: {
      trust_level: 0.5,
      strategic_rationale: args.strategicRationale,
      context_hints: args.contextHints,
    },
    items: args.items.map((it) => ({
      id: it.id,
      type: it.type ?? "curiosity",
      content: `content for ${it.id}`,
      weight: it.weight,
      expires_at: it.expires_at,
      played_as: it.played_as,
      intensity: it.intensity,
      is_critical: it.is_critical,
    })),
  };
}

describe("lookupActionMenu — outcomes", () => {
  it("menu_missing quando arquivo não existe", async () => {
    const result = await lookupActionMenu("never-saved", scratchDir, {
      bypassCache: true,
    });
    expect(result.outcome).toBe("menu_missing");
    expect(result.items.length).toBe(0);
  });

  it("menu_stale quando valid_until < now", async () => {
    const menu = makeMenu({
      personaId: "ryo-stale",
      validUntil: "2026-05-01T00:00:00.000Z", // passado
      items: [{ id: "a", weight: 0.5 }],
    });
    await saveActionMenu(menu, scratchDir);

    const result = await lookupActionMenu("ryo-stale", scratchDir, {
      bypassCache: true,
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    expect(result.outcome).toBe("menu_stale");
    expect(result.diagnostics.menuValidUntil).toBe("2026-05-01T00:00:00.000Z");
  });

  it("no_eligible_items quando todos items estão em used_in_session", async () => {
    const menu = makeMenu({
      personaId: "ryo-used",
      items: [
        { id: "a", weight: 0.5 },
        { id: "b", weight: 0.3 },
      ],
    });
    await saveActionMenu(menu, scratchDir);

    const result = await lookupActionMenu("ryo-used", scratchDir, {
      bypassCache: true,
      usedInSession: ["a", "b"],
    });
    expect(result.outcome).toBe("no_eligible_items");
  });

  it("ok quando menu válido + items elegíveis", async () => {
    const menu = makeMenu({
      personaId: "ryo-ok",
      validUntil: "2027-01-01T00:00:00.000Z", // futuro
      items: [
        { id: "a", weight: 0.5, played_as: "espelho", intensity: "soft" },
        { id: "b", weight: 0.3, played_as: "canal" },
      ],
    });
    await saveActionMenu(menu, scratchDir);

    const result = await lookupActionMenu("ryo-ok", scratchDir, {
      bypassCache: true,
    });
    expect(result.outcome).toBe("ok");
    expect(result.items.length).toBe(2);
  });
});

describe("lookupActionMenu — decay multiplicativo (Jun 2026-05-14)", () => {
  it("items expirados sobrevivem com effective_weight × 0.3", async () => {
    const menu = makeMenu({
      personaId: "ryo-decay",
      items: [
        // Expirado: weight 1.0 × 0.3 = 0.3
        { id: "expired", weight: 1.0, expires_at: "2026-01-01T00:00:00.000Z" },
        // Ativo: weight 0.5 × 1.0 = 0.5
        { id: "active", weight: 0.5 },
      ],
    });
    await saveActionMenu(menu, scratchDir);

    const result = await lookupActionMenu("ryo-decay", scratchDir, {
      bypassCache: true,
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    expect(result.outcome).toBe("ok");
    expect(result.items.length).toBe(2);
    // Active (0.5) deve vir antes do expired (0.3 effective)
    expect(result.items[0]!.item.id).toBe("active");
    expect(result.items[1]!.item.id).toBe("expired");
    expect(result.items[1]!.reasons.some((r) => r.includes("decay_applied"))).toBe(true);
  });

  it("items expirados desaparecem se decay torna effective < items ativos no top-K", async () => {
    const menu = makeMenu({
      personaId: "ryo-decay-2",
      items: [
        // 3 ativos com weight > 0.3 — expired (decayed) fica fora do top-3
        { id: "active-1", weight: 0.9 },
        { id: "active-2", weight: 0.7 },
        { id: "active-3", weight: 0.5 },
        // Expirado: 1.0 × 0.3 = 0.3 — fica fora do top-3
        { id: "expired", weight: 1.0, expires_at: "2026-01-01T00:00:00.000Z" },
      ],
    });
    await saveActionMenu(menu, scratchDir);

    const result = await lookupActionMenu("ryo-decay-2", scratchDir, {
      bypassCache: true,
      nowIso: "2026-05-14T10:00:00.000Z",
      topK: 3,
    });
    expect(result.outcome).toBe("ok");
    expect(result.items.length).toBe(3);
    const ids = result.items.map((it) => it.item.id);
    expect(ids).toEqual(["active-1", "active-2", "active-3"]);
    expect(ids).not.toContain("expired");
  });
});

describe("lookupActionMenu — used_in_session filter", () => {
  it("filtra items em used_in_session antes do scoring", async () => {
    const menu = makeMenu({
      personaId: "ryo-used-filter",
      items: [
        { id: "a", weight: 0.9 }, // será filtered
        { id: "b", weight: 0.5 },
        { id: "c", weight: 0.3 },
      ],
    });
    await saveActionMenu(menu, scratchDir);

    const result = await lookupActionMenu("ryo-used-filter", scratchDir, {
      bypassCache: true,
      usedInSession: ["a"],
    });
    expect(result.outcome).toBe("ok");
    expect(result.items.length).toBe(2);
    expect(result.items.map((it) => it.item.id)).toEqual(["b", "c"]);
  });
});

describe("lookupActionMenu — shim conversion ActionMenuItem → ScoredContentItem", () => {
  it("preserva ISA labels em isaLabels field", async () => {
    const menu = makeMenu({
      personaId: "ryo-labels",
      items: [
        {
          id: "labeled",
          weight: 0.5,
          played_as: "diamante",
          intensity: "firm",
          is_critical: true,
        },
      ],
    });
    await saveActionMenu(menu, scratchDir);

    const result = await lookupActionMenu("ryo-labels", scratchDir, {
      bypassCache: true,
    });
    expect(result.items[0]!.isaLabels).toEqual({
      played_as: "diamante",
      intensity: "firm",
      is_critical: true,
    });
  });

  it("mapeia type ActionMenu → ContentItem (curiosity → curiosity_hook)", async () => {
    const menu = makeMenu({
      personaId: "ryo-types",
      items: [
        { id: "c", type: "curiosity", weight: 0.5 },
        { id: "d", type: "cultural_diamond", weight: 0.5 },
        { id: "ch", type: "challenge", weight: 0.5 },
        { id: "s", type: "strategy", weight: 0.5 },
        { id: "p", type: "play", weight: 0.5 },
      ],
    });
    await saveActionMenu(menu, scratchDir);

    const result = await lookupActionMenu("ryo-types", scratchDir, {
      bypassCache: true,
      topK: 10,
    });
    const types = result.items.map((it) => it.item.type);
    expect(types).toContain("curiosity_hook");
    expect(types).toContain("cultural_diamond");
    expect(types).toContain("challenge");
    expect(types.filter((t) => t === "dynamic").length).toBe(2); // strategy + play
  });
});

describe("lookupActionMenu — cache singleton", () => {
  it("segunda chamada com mesmo persona retorna cached (sem re-leitura disco)", async () => {
    const menu = makeMenu({
      personaId: "ryo-cache",
      items: [{ id: "a", weight: 0.5 }],
    });
    await saveActionMenu(menu, scratchDir);

    const r1 = await lookupActionMenu("ryo-cache", scratchDir);
    expect(r1.outcome).toBe("ok");

    // Apaga o arquivo — segunda call deve usar cache, ainda OK
    await rm(path.join(scratchDir, "ryo-cache-menu.json"));

    const r2 = await lookupActionMenu("ryo-cache", scratchDir);
    expect(r2.outcome).toBe("ok"); // cached, sobreviveu ao delete
  });

  it("bypassCache=true força re-leitura disco", async () => {
    const menu = makeMenu({
      personaId: "ryo-bypass",
      items: [{ id: "a", weight: 0.5 }],
    });
    await saveActionMenu(menu, scratchDir);

    const r1 = await lookupActionMenu("ryo-bypass", scratchDir);
    expect(r1.outcome).toBe("ok");

    await rm(path.join(scratchDir, "ryo-bypass-menu.json"));

    const r2 = await lookupActionMenu("ryo-bypass", scratchDir, {
      bypassCache: true,
    });
    expect(r2.outcome).toBe("menu_missing");
  });
});

describe("lookupActionMenu — source exposure (ops#1069 S-T-10-08)", () => {
  it("expõe source.strategic_rationale + context_hints quando outcome=ok", async () => {
    const menu = makeMenu({
      personaId: "ryo-src",
      strategicRationale: "Foco em ancoragem física, evitar metacomunicação cedo.",
      contextHints: { language: "pt-br", mood: "deflective" },
      items: [{ id: "a", weight: 0.5 }],
    });
    await saveActionMenu(menu, scratchDir);

    const result = await lookupActionMenu("ryo-src", scratchDir, { bypassCache: true });
    expect(result.outcome).toBe("ok");
    expect(result.source?.strategic_rationale).toBe("Foco em ancoragem física, evitar metacomunicação cedo.");
    expect(result.source?.context_hints).toEqual({ language: "pt-br", mood: "deflective" });
    expect(result.source?.trust_level).toBe(0.5);
  });

  it("source.strategic_rationale=null quando menu não tem rationale baked", async () => {
    const menu = makeMenu({
      personaId: "ryo-norat",
      items: [{ id: "a", weight: 0.5 }],
    });
    await saveActionMenu(menu, scratchDir);

    const result = await lookupActionMenu("ryo-norat", scratchDir, { bypassCache: true });
    expect(result.outcome).toBe("ok");
    expect(result.source?.strategic_rationale).toBeNull();
    expect(result.source?.context_hints).toBeNull();
    expect(result.source?.trust_level).toBe(0.5);
  });

  it("source ausente quando outcome != ok (menu_missing)", async () => {
    const result = await lookupActionMenu("not-saved-yet", scratchDir, { bypassCache: true });
    expect(result.outcome).toBe("menu_missing");
    expect(result.source).toBeUndefined();
  });
});
