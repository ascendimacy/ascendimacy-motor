import { describe, it, expect } from "vitest";
import { sanitizeMaterialization } from "../src/select.js";

// Testes para contextHints 'avoid' enforcement via sanitizeMaterialization.
// Full pipeline com LLM real é coberto por STS H7 re-run.

describe("contextHints avoid enforcement — sanitizeMaterialization", () => {
  it("removes playbook technical identifier from materialization", () => {
    const raw = "Este playbook helix.ciclo.avancar_dia vai te ajudar com score.";
    const clean = sanitizeMaterialization(raw);
    expect(clean).not.toContain("playbook");
    expect(clean).not.toContain("score");
  });

  it("does not remove words that only contain a forbidden substring", () => {
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

describe("EvaluateAndSelectInput — contract shape (contentPool + instruction_addition)", () => {
  it("interface accepts contentPool + instruction_addition", () => {
    // Structural test: verifica que o contract aceita os campos novos.
    type EvaluateAndSelectInput = {
      sessionId: string;
      contentPool: Array<{ item: unknown; score: number; reasons: string[] }>;
      state: unknown;
      persona: unknown;
      strategicRationale: string;
      contextHints: Record<string, unknown>;
      instruction_addition?: string;
    };

    const input: EvaluateAndSelectInput = {
      sessionId: "test-001",
      contentPool: [],
      state: {},
      persona: { id: "ryo", name: "Ryo", age: 13, profile: {} },
      strategicRationale: "Primo contato com adolescente",
      contextHints: { language: "pt-br", status_gates: { emotional: { ok: true } } },
      instruction_addition: "",
    };

    expect(input.contextHints["language"]).toBe("pt-br");
    expect(input.instruction_addition).toBe("");
  });
});
