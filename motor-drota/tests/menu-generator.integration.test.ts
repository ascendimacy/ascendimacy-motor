/**
 * Integration tests — generateActionMenu + fixture profiles + persistence.
 *
 * Mock LLM (não chama Kimi K2.5 real — isso fica no smoke script + LLM-LOCAL
 * graceful-skip test). Carrega fixture real `fixtures/profiles/ryo-ochiai.
 * pre-phase2.json`, roda o gerador, persiste via `saveActionMenu` da
 * planejador, e re-lê com `loadActionMenu` para validar round-trip.
 *
 * Refs: ops#993 (S-T-09-02), motor#88 (H-AC-02).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTION_MENU_SCHEMA_VERSION,
  parseActionMenu,
  type ActionMenu,
} from "@ascendimacy/shared";

import {
  generateActionMenu,
  type GenerateActionMenuInput,
} from "../src/menu-generator.js";
import { KEI_HINT, RYO_HINT } from "../src/persona-hints.js";

/** Persistência inline pra evitar workspace cross-dep em test. */
async function saveActionMenu(menu: ActionMenu, baseDir: string): Promise<string> {
  const validated = parseActionMenu(menu);
  const target = path.join(baseDir, `${validated.persona_id}-menu.json`);
  await writeFile(target, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
  return target;
}

async function loadActionMenu(personaId: string, baseDir: string): Promise<ActionMenu | null> {
  const target = path.join(baseDir, `${personaId}-menu.json`);
  try {
    const raw = await readFile(target, "utf-8");
    return parseActionMenu(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await mkdtemp(path.join(tmpdir(), "menu-gen-int-"));
});

afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

async function loadFixtureProfile(name: string): Promise<unknown> {
  const fixturePath = path.join(REPO_ROOT, "fixtures", "profiles", name);
  const raw = await readFile(fixturePath, "utf-8");
  return JSON.parse(raw);
}

function syntheticLlmReply(personaId: string): string {
  return JSON.stringify({
    persona_id: personaId,
    schema_version: ACTION_MENU_SCHEMA_VERSION,
    generated_at: "2026-05-13T19:30:00.000Z",
    valid_until: "2026-05-20T19:30:00.000Z",
    source: { trust_level: 0.42 },
    items: [
      {
        id: "esp-tempo",
        type: "strategy",
        content:
          "Tipo, quando ele falar do tempo de uma coisa em meses e de outra em horas, devolve só a observação.",
        weight: 0.78,
        played_as: "espelho",
        intensity: "soft",
      },
      {
        id: "can-gohan",
        type: "curiosity",
        content:
          "Tipo, o que rolou na cena do Gohan no Cell que mexeu contigo?",
        weight: 0.72,
        played_as: "canal",
        intensity: "soft",
      },
      {
        id: "rec-pausa",
        type: "strategy",
        content: "Se o silêncio pesar, deixa rolar. Pedagogia pausa.",
        weight: 0.4,
        played_as: "recovery",
        intensity: "soft",
      },
      {
        id: "br-djoko",
        type: "play",
        content:
          "Djokovic perde set e leva 2min pra resetar. Como ele faz isso?",
        weight: 0.55,
        played_as: "bridge",
        intensity: "medium",
      },
      {
        id: "di-tea",
        type: "challenge",
        content:
          "Na cerimônia de chá, errar é parte do gesto. O que isso muda pra você?",
        weight: 0.6,
        played_as: "diamante",
        intensity: "medium",
      },
    ],
  });
}

describe("generateActionMenu — integration: Ryo fixture profile", () => {
  it("produces a Zod-valid menu from real Ryo profile + persists round-trip", async () => {
    const profile = await loadFixtureProfile("ryo-ochiai.pre-phase2.json");

    const input: GenerateActionMenuInput = {
      personaId: "ryo-ochiai",
      trustLevel: 0.42,
      profile,
      personaHint: RYO_HINT,
    };

    const llm = vi.fn(async () => ({
      content: syntheticLlmReply("ryo-ochiai"),
      tokens: { in: 2200, out: 420, reasoning: 0 },
      provider: "anthropic" as const,
      model: "claude-sonnet-4-6",
    }));

    const menu = await generateActionMenu(input, { llmCall: llm });
    expect(menu).not.toBeNull();
    expect(() => parseActionMenu(menu)).not.toThrow();

    const persistedPath = await saveActionMenu(menu!, scratchDir);
    expect(persistedPath).toContain("ryo-ochiai-menu.json");

    const reloaded = await loadActionMenu("ryo-ochiai", scratchDir);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.persona_id).toBe("ryo-ochiai");
    expect(reloaded!.items.length).toBe(menu!.items.length);

    // Auto is_critical aplicado mesmo após round-trip de persistência
    const recovery = reloaded!.items.find((it) => it.played_as === "recovery");
    expect(recovery?.is_critical).toBe(true);
  });

  it("Ryo hint biases prompt content toward espelho/canal in system prompt", async () => {
    const profile = await loadFixtureProfile("ryo-ochiai.pre-phase2.json");
    const llm = vi.fn(async () => ({
      content: syntheticLlmReply("ryo-ochiai"),
      tokens: { in: 2200, out: 420, reasoning: 0 },
      provider: "anthropic" as const,
      model: "claude-sonnet-4-6",
    }));

    await generateActionMenu(
      {
        personaId: "ryo-ochiai",
        trustLevel: 0.42,
        profile,
        personaHint: RYO_HINT,
      },
      { llmCall: llm },
    );

    const sysPrompt = llm.mock.calls[0]![0] as string;
    // Heurística: pesos de espelho/canal aparecem mais acima do que diamante.
    const espIdx = sysPrompt.indexOf("espelho:");
    const canIdx = sysPrompt.indexOf("canal:");
    const diaIdx = sysPrompt.indexOf("diamante:");
    expect(espIdx).toBeGreaterThan(-1);
    expect(canIdx).toBeGreaterThan(-1);
    expect(diaIdx).toBeGreaterThan(-1);
    // No bias block ordering — Ryo's bias array is sorted by weight desc.
    expect(espIdx).toBeLessThan(diaIdx);
    expect(canIdx).toBeLessThan(diaIdx);
  });
});

describe("generateActionMenu — integration: Kei fixture profile", () => {
  it("produces a Zod-valid menu from real Kei profile with diamante+bridge bias", async () => {
    const profile = await loadFixtureProfile("kei-ochiai.pre-phase2.json");
    const llm = vi.fn(async () => ({
      content: syntheticLlmReply("kei-ochiai"),
      tokens: { in: 2300, out: 410, reasoning: 0 },
      provider: "anthropic" as const,
      model: "claude-sonnet-4-6",
    }));

    const menu = await generateActionMenu(
      {
        personaId: "kei-ochiai",
        trustLevel: 0.5,
        profile,
        personaHint: KEI_HINT,
      },
      { llmCall: llm },
    );

    expect(menu).not.toBeNull();
    expect(menu!.persona_id).toBe("kei-ochiai");

    const sysPrompt = llm.mock.calls[0]![0] as string;
    // Kei bias: diamante and bridge precede espelho.
    const diaIdx = sysPrompt.indexOf("diamante:");
    const brIdx = sysPrompt.indexOf("bridge:");
    const espIdx = sysPrompt.indexOf("espelho:");
    expect(diaIdx).toBeLessThan(espIdx);
    expect(brIdx).toBeLessThan(espIdx);
  });
});

describe("generateActionMenu — integration: schema version + auto critical", () => {
  it("emits menu with schema_version v0.2 (ISA fields supported)", async () => {
    const profile = await loadFixtureProfile("ryo-ochiai.pre-phase2.json");
    const llm = vi.fn(async () => ({
      content: syntheticLlmReply("ryo-ochiai"),
      tokens: { in: 2200, out: 420, reasoning: 0 },
      provider: "anthropic" as const,
      model: "claude-sonnet-4-6",
    }));

    const menu = await generateActionMenu(
      {
        personaId: "ryo-ochiai",
        trustLevel: 0.42,
        profile,
        personaHint: RYO_HINT,
      },
      { llmCall: llm },
    );

    expect(menu!.schema_version).toMatch(/^v0\.2/);
  });

  it("at least one item gets auto is_critical (recovery in synthetic reply)", async () => {
    const profile = await loadFixtureProfile("ryo-ochiai.pre-phase2.json");
    const llm = vi.fn(async () => ({
      content: syntheticLlmReply("ryo-ochiai"),
      tokens: { in: 2200, out: 420, reasoning: 0 },
      provider: "anthropic" as const,
      model: "claude-sonnet-4-6",
    }));

    const menu = await generateActionMenu(
      {
        personaId: "ryo-ochiai",
        trustLevel: 0.42,
        profile,
        personaHint: RYO_HINT,
      },
      { llmCall: llm },
    );

    const criticals = menu!.items.filter((it) => it.is_critical === true);
    expect(criticals.length).toBeGreaterThan(0);
  });
});
