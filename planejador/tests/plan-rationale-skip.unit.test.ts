/**
 * Unit tests — plan.ts rationale skip via menu (ops#1069 S-T-10-08).
 *
 * Cobre 3 caminhos:
 *  - Skip: menu_hit + rationale presente + sem brejo → strategicRationale === menu.source.strategic_rationale
 *  - Fallback: menu_hit + rationale ausente → cai pro mock LLM
 *  - Brejo override: menu_hit + rationale presente MAS statusMatrix paused → cai pro mock LLM
 *
 * USE_MOCK_LLM=true setado no top — mock retorna strategicRationale fixo
 * "Mock: contexto inicial, foco em receptividade." (de planejador/src/llm-client.ts).
 * Permite distinguir skip path (rationale = menu's) vs fallback path (rationale = mock).
 */

import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ActionMenu, StatusMatrix } from "@ascendimacy/shared";

import { saveActionMenu } from "../src/strategist/action-menu-persistence.js";
import { _resetMenuLookupCache } from "../src/strategist/menu-lookup.js";
import { planTurn } from "../src/plan.js";

process.env["USE_MOCK_LLM"] = "true";

const MOCK_RATIONALE_PREFIX = "Mock:";
const BAKED_RATIONALE = "Pre-baked rationale: focus on physical anchors";

let scratchDir: string;

beforeEach(async () => {
  _resetMenuLookupCache();
  scratchDir = await mkdtemp(path.join(tmpdir(), "plan-skip-"));
  process.env["ASC_USE_ACTION_MENU"] = "true";
  process.env["ASC_ACTION_MENU_BASE_DIR"] = scratchDir;
});

afterEach(async () => {
  _resetMenuLookupCache();
  await rm(scratchDir, { recursive: true, force: true });
  delete process.env["ASC_USE_ACTION_MENU"];
  delete process.env["ASC_ACTION_MENU_BASE_DIR"];
});

function buildMenu(personaId: string, withRationale: boolean): ActionMenu {
  return {
    persona_id: personaId,
    schema_version: "v0.2.0",
    generated_at: "2026-05-16T10:00:00.000Z",
    valid_until: "2027-01-01T00:00:00.000Z",
    source: {
      trust_level: 0.5,
      ...(withRationale
        ? {
            strategic_rationale: BAKED_RATIONALE,
            context_hints: { language: "pt-br", mood: "deflective" },
          }
        : {}),
    },
    items: [
      {
        id: "item-a",
        type: "curiosity",
        content: "Item curiosity content",
        weight: 0.8,
      },
    ],
  };
}

const adquirente = { id: "jun", name: "Jun", defaults: { style: "direto", language: "pt-br" } };
const inventory = [
  { id: "kids.helix.session", title: "Helix", category: "kids", estimatedSacrifice: 1, estimatedConfidenceGain: 4 },
];

function persona(id: string) {
  return { id, name: id, age: 13, profile: { interests: ["dragon_ball"] } };
}

function baseState() {
  return {
    sessionId: `test-skip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    trustLevel: 0.3,
    budgetRemaining: 100,
    turn: 0,
    eventLog: [],
  };
}

describe("plan.ts rationale skip via menu (S-T-10-08)", () => {
  it("SKIP: menu hit + rationale + sem brejo → strategicRationale = baked", async () => {
    const personaId = "ryo-skip";
    await saveActionMenu(buildMenu(personaId, true), scratchDir);

    const out = await planTurn({
      persona: persona(personaId),
      adquirente,
      inventory,
      state: baseState(),
      incomingMessage: "oi",
    });
    expect(out.strategicRationale).toBe(BAKED_RATIONALE);
    expect(out.strategicRationale).not.toContain(MOCK_RATIONALE_PREFIX);
  });

  it("FALLBACK: menu hit + rationale ausente → strategicRationale = mock LLM", async () => {
    const personaId = "ryo-fallback";
    await saveActionMenu(buildMenu(personaId, false), scratchDir);

    const out = await planTurn({
      persona: persona(personaId),
      adquirente,
      inventory,
      state: baseState(),
      incomingMessage: "oi",
    });
    expect(out.strategicRationale).toContain(MOCK_RATIONALE_PREFIX);
    expect(out.strategicRationale).not.toBe(BAKED_RATIONALE);
  });

  it("BREJO OVERRIDE: menu hit + rationale presente + brejo → mock LLM (não usa baked)", async () => {
    const personaId = "ryo-brejo";
    await saveActionMenu(buildMenu(personaId, true), scratchDir);

    // statusMatrix com emotional="brejo" → shouldPauseProgram retorna paused=true
    const brejoMatrix: StatusMatrix = {
      emotional: "brejo",
      cognitive_math: "baia",
      cognitive_verbal: "baia",
      bodily: "baia",
      social: "baia",
    };
    const out = await planTurn({
      persona: persona(personaId),
      adquirente,
      inventory,
      state: { ...baseState(), statusMatrix: brejoMatrix },
      incomingMessage: "oi",
    });
    expect(out.strategicRationale).toContain(MOCK_RATIONALE_PREFIX);
    expect(out.strategicRationale).not.toBe(BAKED_RATIONALE);
  });

  it("SEM MENU FLAG: ASC_USE_ACTION_MENU desativo → mock LLM", async () => {
    delete process.env["ASC_USE_ACTION_MENU"];
    const personaId = "ryo-nomenu";
    await saveActionMenu(buildMenu(personaId, true), scratchDir);

    const out = await planTurn({
      persona: persona(personaId),
      adquirente,
      inventory,
      state: baseState(),
      incomingMessage: "oi",
    });
    expect(out.strategicRationale).toContain(MOCK_RATIONALE_PREFIX);
  });

  it("MENU MISSING: persona sem fixture → mock LLM (scoring path)", async () => {
    const personaId = "persona-without-fixture";
    // NÃO salva fixture
    const out = await planTurn({
      persona: persona(personaId),
      adquirente,
      inventory,
      state: baseState(),
      incomingMessage: "oi",
    });
    expect(out.strategicRationale).toContain(MOCK_RATIONALE_PREFIX);
  });
});
