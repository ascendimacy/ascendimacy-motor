/**
 * Unit tests — generateActionMenu emits source.strategic_rationale +
 * source.context_hints (S-T-10-08, ops#1069).
 *
 * Cobertura:
 *
 * 1. **Round-trip happy path**: LLM mock retorna JSON com `source.strategic_rationale`
 *    + `source.context_hints` populados → `generateActionMenu` propaga ambos
 *    intactos no menu retornado.
 *
 * 2. **Backward compat — omitir**: LLM mock retorna JSON SEM os 2 campos novos
 *    (apenas `source.trust_level`) → menu retornado tem `source.strategic_rationale`
 *    e `source.context_hints` como `undefined` (não rejeita). Garante que prompt
 *    v0.4 não quebra fallback quando LLM omite por algum motivo.
 *
 * 3. **Retry preserva campos novos**: 1ª tentativa falha schema (played_as inválido),
 *    2ª tentativa válida com rationale + hints presentes → menu final preserva
 *    ambos. Confirma que retry path não descarta campos novos.
 *
 * 4. **Graceful degradation preserva source**: 2 retries falham com played_as
 *    inválido, strip ISA labels recupera. `source` (incluindo rationale + hints
 *    se presentes) sobrevive ao strip — strip atua só em `items[].played_as|intensity|is_critical`.
 *
 * Refs: ops#1069 (S-T-10-08), motor#115 (skip path consumer), schema fields
 * em `shared/src/contracts/action-menu.ts` (ActionMenuSourceSchema).
 */

import { beforeEach, describe, it, expect, vi } from "vitest";

const { mockLogDebugEvent } = vi.hoisted(() => ({
  mockLogDebugEvent: vi.fn(),
}));

vi.mock("@ascendimacy/shared", async () => {
  const actual = await vi.importActual<typeof import("@ascendimacy/shared")>(
    "@ascendimacy/shared",
  );
  return {
    ...actual,
    logDebugEvent: mockLogDebugEvent,
  };
});

import {
  ACTION_MENU_SCHEMA_VERSION,
  parseActionMenu,
  type ActionMenu,
} from "@ascendimacy/shared";
import {
  generateActionMenu,
  type GenerateActionMenuInput,
  type LlmCall,
} from "../src/menu-generator.js";
import { RYO_HINT } from "../src/persona-hints.js";

beforeEach(() => {
  mockLogDebugEvent.mockClear();
});

const RYO_RATIONALE =
  "Ryo é deflective; trust ainda baixo (0.42). Foco em curiosities visuais/concretas + ancorar em micro-gestos físicos (grip, postura) sem forçar verbalização. Evitar metacomunicação cedo na sessão.";

const RYO_HINTS = {
  language: "pt-br",
  mood: "deflective",
  urgency: "low",
  session_phase: "rapport_building",
  engagement_strategy: "concrete_physical_anchors",
};

function validRyoInput(): GenerateActionMenuInput {
  return {
    personaId: "ryo-ochiai",
    trustLevel: 0.42,
    profile: {
      preferences: {
        interests: ["tênis", "Gohan", "silêncio"],
        aversions: ["ser ignorado", "pressão"],
      },
    },
    personaHint: RYO_HINT,
  };
}

function buildLlmMenu(opts: {
  withRationale: boolean;
  withHints: boolean;
  overrideItems?: ActionMenu["items"];
}): string {
  const source: Record<string, unknown> = { trust_level: 0.42 };
  if (opts.withRationale) source.strategic_rationale = RYO_RATIONALE;
  if (opts.withHints) source.context_hints = RYO_HINTS;

  const menu = {
    persona_id: "ryo-ochiai",
    schema_version: ACTION_MENU_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    source,
    items: opts.overrideItems ?? [
      {
        id: "esp-01",
        type: "strategy",
        content: "Quando Ryo comparar tempo entre domínios, devolva como pergunta.",
        weight: 0.7,
        played_as: "espelho",
        intensity: "soft",
        is_critical: false,
      },
      {
        id: "can-01",
        type: "curiosity",
        content: "Pergunta aberta sobre Gohan no Cell Saga — canal interpessoal.",
        weight: 0.75,
        played_as: "canal",
        intensity: "soft",
        is_critical: false,
      },
    ],
  };
  return JSON.stringify(menu);
}

function mockLlm(content: string): LlmCall {
  return vi.fn(async () => ({
    content,
    tokens: { in: 1200, out: 380, reasoning: 0 },
    provider: "anthropic" as const,
    model: "claude-sonnet-4-6",
  }));
}

describe("generateActionMenu — emits source.strategic_rationale + context_hints (S-T-10-08)", () => {
  it("propagates strategic_rationale + context_hints when LLM emits both", async () => {
    const llm = mockLlm(buildLlmMenu({ withRationale: true, withHints: true }));
    const menu = await generateActionMenu(validRyoInput(), { llmCall: llm });

    expect(menu).not.toBeNull();
    expect(() => parseActionMenu(menu)).not.toThrow();

    // Round-trip: campos novos no source preservados
    expect(menu!.source.strategic_rationale).toBe(RYO_RATIONALE);
    expect(menu!.source.context_hints).toEqual(RYO_HINTS);

    // Sanity — outros campos intactos
    expect(menu!.source.trust_level).toBe(0.42);
    expect(menu!.items.length).toBeGreaterThan(0);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("preserves rationale chars literal (no truncation, no rewriting)", async () => {
    const llm = mockLlm(buildLlmMenu({ withRationale: true, withHints: false }));
    const menu = await generateActionMenu(validRyoInput(), { llmCall: llm });

    expect(menu!.source.strategic_rationale).toBe(RYO_RATIONALE);
    // length match — garante zero modificação
    expect(menu!.source.strategic_rationale!.length).toBe(RYO_RATIONALE.length);
  });

  it("preserves context_hints object shape verbatim (keys + values)", async () => {
    const llm = mockLlm(buildLlmMenu({ withRationale: false, withHints: true }));
    const menu = await generateActionMenu(validRyoInput(), { llmCall: llm });

    const hints = menu!.source.context_hints as Record<string, unknown>;
    expect(hints).toBeDefined();
    expect(hints.language).toBe("pt-br");
    expect(hints.mood).toBe("deflective");
    expect(hints.urgency).toBe("low");
    expect(hints.session_phase).toBe("rapport_building");
    expect(hints.engagement_strategy).toBe("concrete_physical_anchors");
    // exact key set
    expect(Object.keys(hints).sort()).toEqual(
      ["engagement_strategy", "language", "mood", "session_phase", "urgency"],
    );
  });
});

describe("generateActionMenu — backward compat when LLM omits new fields", () => {
  it("returns menu sem strategic_rationale/context_hints quando LLM omite (não rejeita)", async () => {
    const llm = mockLlm(buildLlmMenu({ withRationale: false, withHints: false }));
    const menu = await generateActionMenu(validRyoInput(), { llmCall: llm });

    expect(menu).not.toBeNull();
    expect(() => parseActionMenu(menu)).not.toThrow();

    // Fallback graceful — ausência aceita pelo schema (.nullable().optional())
    expect(menu!.source.strategic_rationale).toBeUndefined();
    expect(menu!.source.context_hints).toBeUndefined();

    // Trust level + items intactos — menu ainda utilizável
    expect(menu!.source.trust_level).toBe(0.42);
    expect(menu!.items.length).toBeGreaterThan(0);
  });

  it("aceita null explícito em ambos os campos (LLM pode emitir null em vez de omitir)", async () => {
    const sourceJson = {
      trust_level: 0.42,
      strategic_rationale: null,
      context_hints: null,
    };
    const menuJson = {
      persona_id: "ryo-ochiai",
      schema_version: ACTION_MENU_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      source: sourceJson,
      items: [
        {
          id: "esp-01",
          type: "strategy",
          content: "Item sample.",
          weight: 0.5,
          played_as: "espelho",
          intensity: "soft",
          is_critical: false,
        },
      ],
    };

    const llm = mockLlm(JSON.stringify(menuJson));
    const menu = await generateActionMenu(validRyoInput(), { llmCall: llm });

    expect(menu).not.toBeNull();
    // Zod .nullable().optional() preserva null literal
    expect(menu!.source.strategic_rationale).toBeNull();
    expect(menu!.source.context_hints).toBeNull();
  });
});

describe("generateActionMenu — retry preserva strategic_rationale + context_hints", () => {
  it("preserves new source fields when retry recovers (1ª falha schema, 2ª válida)", async () => {
    const bad = JSON.parse(
      buildLlmMenu({ withRationale: true, withHints: true }),
    ) as ActionMenu;
    (bad.items[0] as unknown as { played_as: string }).played_as = "scaffold";

    const good = buildLlmMenu({ withRationale: true, withHints: true });

    const llm = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify(bad),
        tokens: { in: 1200, out: 380, reasoning: 0 },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        content: good,
        tokens: { in: 1300, out: 400, reasoning: 0 },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      });

    const menu = await generateActionMenu(validRyoInput(), { llmCall: llm });
    expect(menu).not.toBeNull();
    expect(llm).toHaveBeenCalledTimes(2);

    // Retry path não descarta campos novos
    expect(menu!.source.strategic_rationale).toBe(RYO_RATIONALE);
    expect(menu!.source.context_hints).toEqual(RYO_HINTS);
  });
});

describe("generateActionMenu — graceful degradation preserva source", () => {
  it("strip ISA labels em items NÃO afeta source.strategic_rationale/context_hints", async () => {
    // 2 retries falham por played_as inválido em items; strip recupera.
    // source com rationale + hints DEVE sobreviver — strip só atua em items.
    const bad1 = JSON.parse(
      buildLlmMenu({ withRationale: true, withHints: true }),
    ) as ActionMenu;
    (bad1.items[0] as unknown as { played_as: string }).played_as = "scaffold";
    const bad2 = JSON.parse(
      buildLlmMenu({ withRationale: true, withHints: true }),
    ) as ActionMenu;
    (bad2.items[0] as unknown as { intensity: string }).intensity = "savage";

    const llm = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify(bad1),
        tokens: { in: 1200, out: 380, reasoning: 0 },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        content: JSON.stringify(bad2),
        tokens: { in: 1300, out: 400, reasoning: 0 },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      });

    const warnings: string[] = [];
    const menu = await generateActionMenu(validRyoInput(), {
      llmCall: llm,
      onWarning: (w) => warnings.push(w.code),
    });

    expect(menu).not.toBeNull();
    expect(warnings).toContain("isa_labels_stripped");

    // ISA labels removidos dos items
    for (const item of menu!.items) {
      expect(item.played_as).toBeUndefined();
      expect(item.intensity).toBeUndefined();
    }

    // MAS source preserva rationale + context_hints (strip não toca em source)
    expect(menu!.source.strategic_rationale).toBe(RYO_RATIONALE);
    expect(menu!.source.context_hints).toEqual(RYO_HINTS);
  });
});
