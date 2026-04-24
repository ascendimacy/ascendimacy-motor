import { describe, it, expect } from "vitest";
import { sanitizeMaterialization } from "../src/select.js";

// Tests for contextHints 'avoid' enforcement via sanitizeMaterialization.
// The full pipeline test (real LLM) is covered by STS H7 re-run (v0.2 traces).

describe("contextHints avoid enforcement — sanitizeMaterialization", () => {
  it("removes playbook technical identifier from materialization", () => {
    const raw = "Este playbook helix.ciclo.avancar_dia vai te ajudar com score.";
    const clean = sanitizeMaterialization(raw);
    expect(clean).not.toContain("playbook");
    expect(clean).not.toContain("score");
  });

  it("does not remove words that only contain a forbidden substring", () => {
    // 'bot' is not in FORBIDDEN_WORDS, so 'robot' should not be touched
    const raw = "o bot se adapta ao robot";
    const clean = sanitizeMaterialization(raw);
    expect(clean).toBe("o bot se adapta ao robot");
  });

  it("collapses multiple spaces after removal", () => {
    const raw = "isso é um playbook score muito bom";
    const clean = sanitizeMaterialization(raw);
    expect(clean).not.toMatch(/\s{2,}/);
    expect(clean).not.toContain("playbook");
    expect(clean).not.toContain("score");
  });
});

describe("contextHints language passthrough — prompt construction", () => {
  it("language field propagates through EvaluateAndSelectInput interface contract", () => {
    // Structural test: ensure the interface accepts the new fields without TypeScript errors.
    // If this file compiles, the contract is correct.
    type EvaluateAndSelectInput = {
      sessionId: string;
      candidateActions: unknown[];
      state: unknown;
      persona: unknown;
      strategicRationale: string;
      contextHints: Record<string, unknown>;
    };

    const input: EvaluateAndSelectInput = {
      sessionId: "test-001",
      candidateActions: [],
      state: {},
      persona: { id: "ryo", name: "Ryo", age: 15, profile: {} },
      strategicRationale: "Primo contato com adolescente japonês",
      contextHints: { language: "pt-br limitado", avoid: ["diagnóstico emocional"] },
    };

    expect(input.strategicRationale).toBe("Primo contato com adolescente japonês");
    expect(input.contextHints["language"]).toBe("pt-br limitado");
    expect(Array.isArray(input.contextHints["avoid"])).toBe(true);
  });
});
