/**
 * Unit tests — generateActionMenu (S-T-09-02 + H-AC-02).
 *
 * Mock LLM client. Cobre: happy path com items rotulados ISA, retry após
 * malformação, degradação graceful (strip campos opcionais), null em
 * timeout/erro, persona_hint injetado no prompt, auto is_critical para
 * recovery e diamante+firm.
 *
 * Refs: ops#993 (S-T-09-02), motor#88 (H-AC-02), ops#991.
 */

import { beforeEach, describe, it, expect, vi } from "vitest";

// Mock pontual de logDebugEvent — permite asserções sobre o outcome
// granular emitido pelo menu-generator (D-4-TELO, ops#1056). Não afeta
// os outros testes do arquivo: logDebugEvent é no-op default (debug mode
// off), então substituir por mock preserva o comportamento observável.
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
import { RYO_HINT, KEI_HINT } from "../src/persona-hints.js";

beforeEach(() => {
  mockLogDebugEvent.mockClear();
});

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

function fullLabeledLlmJson(personaId: string): string {
  const menu = {
    persona_id: personaId,
    schema_version: ACTION_MENU_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    source: { trust_level: 0.42 },
    items: [
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
      {
        id: "br-01",
        type: "play",
        content: "Bridge via paciência longa de Djokovic em treino mental.",
        weight: 0.55,
        played_as: "bridge",
        intensity: "medium",
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
    provider: "anthropic",
    model: "claude-sonnet-4-6",
  }));
}

describe("generateActionMenu — happy path", () => {
  it("returns a Zod-valid menu when LLM returns well-formed JSON with ISA labels", async () => {
    const llm = mockLlm(fullLabeledLlmJson("ryo-ochiai"));
    const menu = await generateActionMenu(validRyoInput(), { llmCall: llm });

    expect(menu).not.toBeNull();
    expect(() => parseActionMenu(menu)).not.toThrow();
    expect(menu!.persona_id).toBe("ryo-ochiai");
    expect(menu!.schema_version).toBe(ACTION_MENU_SCHEMA_VERSION);
    expect(menu!.items.length).toBeGreaterThan(0);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("preserves played_as / intensity / is_critical labels from LLM output", async () => {
    const llm = mockLlm(fullLabeledLlmJson("ryo-ochiai"));
    const menu = await generateActionMenu(validRyoInput(), { llmCall: llm });

    const labeled = menu!.items.filter((it) => it.played_as != null);
    expect(labeled.length).toBe(menu!.items.length);
    for (const item of menu!.items) {
      expect(["bridge", "espelho", "canal", "diamante", "arena", "recovery"]).toContain(
        item.played_as,
      );
      expect(["soft", "medium", "firm"]).toContain(item.intensity);
      expect(typeof item.is_critical).toBe("boolean");
    }
  });

  it("extracts JSON from LLM response even when wrapped in code fences", async () => {
    const wrapped = "Aqui está o menu:\n```json\n" + fullLabeledLlmJson("ryo-ochiai") + "\n```\nFim.";
    const llm = mockLlm(wrapped);
    const menu = await generateActionMenu(validRyoInput(), { llmCall: llm });
    expect(menu).not.toBeNull();
    expect(menu!.items.length).toBeGreaterThan(0);
  });
});

describe("generateActionMenu — retry on Zod failure", () => {
  it("retries once when first LLM output has invalid played_as enum", async () => {
    const bad = JSON.parse(fullLabeledLlmJson("ryo-ochiai")) as ActionMenu;
    (bad.items[0] as unknown as { played_as: string }).played_as = "scaffold";
    const good = fullLabeledLlmJson("ryo-ochiai");

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
    expect(menu!.items[0]!.played_as).toBe("espelho");
  });

  it("retry prompt includes the correction instruction", async () => {
    const bad = JSON.parse(fullLabeledLlmJson("ryo-ochiai")) as ActionMenu;
    (bad.items[0] as unknown as { played_as: string }).played_as = "scaffold";

    const llm = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify(bad),
        tokens: { in: 1200, out: 380, reasoning: 0 },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        content: fullLabeledLlmJson("ryo-ochiai"),
        tokens: { in: 1300, out: 400, reasoning: 0 },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      });

    await generateActionMenu(validRyoInput(), { llmCall: llm });

    const secondCallArgs = llm.mock.calls[1]!;
    const userMsg = secondCallArgs[1] as string;
    expect(userMsg.toLowerCase()).toMatch(/json anterior|invalid|retry|corrija|inválido/);
  });
});

describe("generateActionMenu — graceful degradation", () => {
  it("strips optional ISA fields and persists base items when 2 retries fail (Zod-invalid labels twice)", async () => {
    const bad1 = JSON.parse(fullLabeledLlmJson("ryo-ochiai")) as ActionMenu;
    (bad1.items[0] as unknown as { played_as: string }).played_as = "scaffold";
    const bad2 = JSON.parse(fullLabeledLlmJson("ryo-ochiai")) as ActionMenu;
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
    expect(llm).toHaveBeenCalledTimes(2);
    expect(menu!.items.length).toBeGreaterThan(0);
    // Stripped — items don't carry ISA labels anymore
    for (const item of menu!.items) {
      expect(item.played_as).toBeUndefined();
      expect(item.intensity).toBeUndefined();
    }
    expect(warnings).toContain("isa_labels_stripped");
  });
});

describe("generateActionMenu — null on hard failure", () => {
  it("returns null + warning when LLM throws on first attempt and retry also throws", async () => {
    const llm = vi
      .fn()
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockRejectedValueOnce(new Error("network timeout retry"));

    const warnings: string[] = [];
    const menu = await generateActionMenu(validRyoInput(), {
      llmCall: llm,
      onWarning: (w) => warnings.push(w.code),
    });

    expect(menu).toBeNull();
    expect(warnings).toContain("llm_error");
  });

  it("returns null when LLM returns plain garbage (no JSON extractable) twice", async () => {
    const llm = vi
      .fn()
      .mockResolvedValueOnce({
        content: "this is not JSON at all, just a chat reply",
        tokens: { in: 100, out: 20, reasoning: 0 },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        content: "still not JSON",
        tokens: { in: 100, out: 10, reasoning: 0 },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      });

    const warnings: string[] = [];
    const menu = await generateActionMenu(validRyoInput(), {
      llmCall: llm,
      onWarning: (w) => warnings.push(w.code),
    });

    expect(menu).toBeNull();
    expect(warnings.some((w) => w.startsWith("parse"))).toBe(true);
  });
});

describe("generateActionMenu — auto is_critical logic", () => {
  it("auto-sets is_critical=true for recovery items even if LLM omits it", async () => {
    const menu = JSON.parse(fullLabeledLlmJson("ryo-ochiai")) as ActionMenu;
    menu.items.push({
      id: "rec-01",
      type: "strategy",
      content: "Regulação afetiva — pausar pedagogia.",
      weight: 0.4,
      played_as: "recovery",
      intensity: "soft",
      // is_critical OMITTED on purpose
    } as unknown as ActionMenu["items"][number]);

    const llm = mockLlm(JSON.stringify(menu));
    const out = await generateActionMenu(validRyoInput(), { llmCall: llm });
    const rec = out!.items.find((it) => it.played_as === "recovery");
    expect(rec).toBeDefined();
    expect(rec!.is_critical).toBe(true);
  });

  it("auto-sets is_critical=true for diamante + firm even if LLM omits it", async () => {
    const menu = JSON.parse(fullLabeledLlmJson("ryo-ochiai")) as ActionMenu;
    menu.items.push({
      id: "di-firm-01",
      type: "challenge",
      content: "Desafio cultural firme via cerimônia de chá.",
      weight: 0.65,
      played_as: "diamante",
      intensity: "firm",
    } as unknown as ActionMenu["items"][number]);

    const llm = mockLlm(JSON.stringify(menu));
    const out = await generateActionMenu(validRyoInput(), { llmCall: llm });
    const di = out!.items.find(
      (it) => it.played_as === "diamante" && it.intensity === "firm",
    );
    expect(di).toBeDefined();
    expect(di!.is_critical).toBe(true);
  });

  it("does NOT auto-set is_critical for diamante + soft (lower intensity stays non-critical)", async () => {
    const menu = JSON.parse(fullLabeledLlmJson("ryo-ochiai")) as ActionMenu;
    menu.items.push({
      id: "di-soft-01",
      type: "challenge",
      content: "Desafio cultural soft.",
      weight: 0.5,
      played_as: "diamante",
      intensity: "soft",
    } as unknown as ActionMenu["items"][number]);

    const llm = mockLlm(JSON.stringify(menu));
    const out = await generateActionMenu(validRyoInput(), { llmCall: llm });
    const di = out!.items.find(
      (it) => it.played_as === "diamante" && it.intensity === "soft",
    );
    expect(di).toBeDefined();
    expect(di!.is_critical ?? false).toBe(false);
  });
});

describe("generateActionMenu — persona hint injection", () => {
  it("injects RYO_HINT block into prompt when input.personaHint is RYO_HINT", async () => {
    const llm = mockLlm(fullLabeledLlmJson("ryo-ochiai"));
    await generateActionMenu(validRyoInput(), { llmCall: llm });

    const args = llm.mock.calls[0]!;
    const prompt = (args[0] as string) + "\n" + (args[1] as string);
    expect(prompt.toLowerCase()).toMatch(/ryo|deflective|espelho|canal/);
  });

  it("injects KEI_HINT block into prompt when input.personaHint is KEI_HINT", async () => {
    const llm = mockLlm(fullLabeledLlmJson("kei-ochiai"));
    const input: GenerateActionMenuInput = {
      ...validRyoInput(),
      personaId: "kei-ochiai",
      personaHint: KEI_HINT,
    };
    await generateActionMenu(input, { llmCall: llm });

    const args = llm.mock.calls[0]!;
    const prompt = (args[0] as string) + "\n" + (args[1] as string);
    expect(prompt.toLowerCase()).toMatch(/kei|philosophical|diamante|bridge/);
  });

  it("includes the played_as / intensity enums in the prompt regardless of hint", async () => {
    const llm = mockLlm(fullLabeledLlmJson("ryo-ochiai"));
    await generateActionMenu(validRyoInput(), { llmCall: llm });

    const args = llm.mock.calls[0]!;
    const prompt = args[0] as string;
    for (const v of ["bridge", "espelho", "canal", "diamante", "arena", "recovery"]) {
      expect(prompt).toContain(v);
    }
    for (const v of ["soft", "medium", "firm"]) {
      expect(prompt).toContain(v);
    }
  });
});

describe("generateActionMenu — input validation", () => {
  it("returns null when personaId is empty", async () => {
    const llm = mockLlm(fullLabeledLlmJson(""));
    const warnings: string[] = [];
    const menu = await generateActionMenu(
      { ...validRyoInput(), personaId: "" },
      { llmCall: llm, onWarning: (w) => warnings.push(w.code) },
    );
    expect(menu).toBeNull();
    expect(warnings).toContain("invalid_input");
    expect(llm).not.toHaveBeenCalled();
  });

  it("returns null when trustLevel is out of [0, 1]", async () => {
    const llm = mockLlm(fullLabeledLlmJson("ryo-ochiai"));
    const warnings: string[] = [];
    const menu = await generateActionMenu(
      { ...validRyoInput(), trustLevel: 1.5 },
      { llmCall: llm, onWarning: (w) => warnings.push(w.code) },
    );
    expect(menu).toBeNull();
    expect(warnings).toContain("invalid_input");
  });
});

// D-4-TELO (ops#1056): outcome granular emitido para logDebugEvent.
describe("generateActionMenu — telemetria outcome granular", () => {
  it("emite outcome=\"ok\" no happy path (sucesso na 1a tentativa)", async () => {
    const llm = mockLlm(fullLabeledLlmJson("ryo-ochiai"));
    await generateActionMenu(validRyoInput(), { llmCall: llm });

    // Pega o último evento emitido (handle de mock cumulative durante o test)
    const calls = mockLogDebugEvent.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastEvent = calls[calls.length - 1]![0] as { outcome: string; step: string };
    expect(lastEvent.step).toBe("menu_generation");
    expect(lastEvent.outcome).toBe("ok");
  });

  it("emite outcome=\"ok-retry\" quando 1o output falha schema e retry recupera", async () => {
    const bad = JSON.parse(fullLabeledLlmJson("ryo-ochiai")) as ActionMenu;
    (bad.items[0] as unknown as { played_as: string }).played_as = "scaffold";
    const good = fullLabeledLlmJson("ryo-ochiai");

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

    await generateActionMenu(validRyoInput(), { llmCall: llm });
    const calls = mockLogDebugEvent.mock.calls;
    const lastEvent = calls[calls.length - 1]![0] as { outcome: string };
    expect(lastEvent.outcome).toBe("ok-retry");
  });

  it("emite outcome=\"degraded\" quando 2 retries falham e ISA labels são stripped", async () => {
    const bad1 = JSON.parse(fullLabeledLlmJson("ryo-ochiai")) as ActionMenu;
    (bad1.items[0] as unknown as { played_as: string }).played_as = "scaffold";
    const bad2 = JSON.parse(fullLabeledLlmJson("ryo-ochiai")) as ActionMenu;
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

    await generateActionMenu(validRyoInput(), { llmCall: llm });
    const calls = mockLogDebugEvent.mock.calls;
    const lastEvent = calls[calls.length - 1]![0] as { outcome: string };
    expect(lastEvent.outcome).toBe("degraded");
  });

  it("emite outcome=\"error\" quando ambas as tentativas retornam garbage", async () => {
    const llm = vi
      .fn()
      .mockResolvedValueOnce({
        content: "not JSON",
        tokens: { in: 100, out: 20, reasoning: 0 },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        content: "still not JSON",
        tokens: { in: 100, out: 10, reasoning: 0 },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      });

    const menu = await generateActionMenu(validRyoInput(), { llmCall: llm });
    expect(menu).toBeNull();
    const calls = mockLogDebugEvent.mock.calls;
    const lastEvent = calls[calls.length - 1]![0] as { outcome: string };
    expect(lastEvent.outcome).toBe("error");
  });
});
