import { describe, it, expect, beforeAll } from "vitest";
import type { SubjectInventory } from "@ascendimacy/shared";
import {
  generateInventoryProbeQuestions,
  type InventoryProbeInput,
} from "../src/inventory-probe-agent.js";

const BASE_INPUT: InventoryProbeInput = {
  recentTurns: [],
  subjectName: "Kei",
  subjectAge: 11,
};

describe("generateInventoryProbeQuestions — fallback (mock mode)", () => {
  beforeAll(() => {
    process.env["USE_MOCK_LLM"] = "true";
  });

  it("retorna 5 perguntas quando partial_inventory ausente", async () => {
    const qs = await generateInventoryProbeQuestions(BASE_INPUT);
    expect(qs).toHaveLength(5);
  });

  it("cobre exatamente os 5 kinds esperados", async () => {
    const qs = await generateInventoryProbeQuestions(BASE_INPUT);
    const kinds = qs.map((q) => q.kind).sort();
    expect(kinds).toEqual([
      "aspirational",
      "budget_capacity",
      "family_presence",
      "materials_around",
      "time_window",
    ]);
  });

  it("cada pergunta tem texto não-vazio", async () => {
    const qs = await generateInventoryProbeQuestions(BASE_INPUT);
    for (const q of qs) {
      expect(q.text.length).toBeGreaterThan(5);
    }
  });

  it("expected_extraction_target consistente por kind", async () => {
    const qs = await generateInventoryProbeQuestions(BASE_INPUT);
    const map = Object.fromEntries(
      qs.map((q) => [q.kind, q.expected_extraction_target]),
    );
    expect(map["materials_around"]).toBe("available_materials");
    expect(map["time_window"]).toBe("available_time_minutes");
    expect(map["family_presence"]).toBe("family_present");
    expect(map["budget_capacity"]).toBe("available_budget_cents");
    expect(map["aspirational"]).toBe("aspirational_wishlist");
  });

  it("pula dimensões já preenchidas no partial_inventory", async () => {
    const partial: Partial<SubjectInventory> = {
      available_time_minutes: 60,
      available_materials: ["farinha"],
    };
    const qs = await generateInventoryProbeQuestions({
      ...BASE_INPUT,
      partial_inventory: partial,
    });
    const kinds = qs.map((q) => q.kind);
    expect(kinds).not.toContain("time_window");
    expect(kinds).not.toContain("materials_around");
    expect(kinds).toContain("family_presence");
    expect(kinds).toContain("budget_capacity");
    expect(kinds).toContain("aspirational");
    expect(qs).toHaveLength(3);
  });

  it("retorna array vazio quando inventário completo", async () => {
    const complete: SubjectInventory = {
      collected_at: "2026-05-30T14:00:00Z",
      available_materials: ["x"],
      available_time_minutes: 60,
      available_budget_cents: 1000,
      family_present: ["pai"],
      aspirational_wishlist: ["bolo"],
      confidence: 2,
    };
    const qs = await generateInventoryProbeQuestions({
      ...BASE_INPUT,
      partial_inventory: complete,
    });
    expect(qs).toEqual([]);
  });

  it("trata partial vazio como vazio (não pula nada)", async () => {
    const qs = await generateInventoryProbeQuestions({
      ...BASE_INPUT,
      partial_inventory: {
        available_materials: [],
        available_time_minutes: 0,
        family_present: [],
        available_budget_cents: 0,
        aspirational_wishlist: [],
      },
    });
    expect(qs).toHaveLength(5);
  });

  it("variante lúdica para sujeitos < 10 anos", async () => {
    const qs = await generateInventoryProbeQuestions({
      ...BASE_INPUT,
      subjectAge: 8,
    });
    const materialsQ = qs.find((q) => q.kind === "materials_around")!;
    // Texto lúdico contém "legal" ou "mexer com a mão"
    expect(materialsQ.text.toLowerCase()).toMatch(/legal|mexer com a mão/);
  });

  it("variante direta para sujeitos 10+", async () => {
    const qs = await generateInventoryProbeQuestions({
      ...BASE_INPUT,
      subjectAge: 13,
    });
    const materialsQ = qs.find((q) => q.kind === "materials_around")!;
    expect(materialsQ.text.toLowerCase()).toContain("construir");
  });

  it("nome do sujeito aparece em pergunta materials_around", async () => {
    const qs = await generateInventoryProbeQuestions({
      ...BASE_INPUT,
      subjectName: "Ryo",
    });
    const materialsQ = qs.find((q) => q.kind === "materials_around")!;
    expect(materialsQ.text).toContain("Ryo");
  });

  it("partial com só time_window definido pula apenas essa dimensão", async () => {
    const qs = await generateInventoryProbeQuestions({
      ...BASE_INPUT,
      partial_inventory: { available_time_minutes: 90 },
    });
    expect(qs).toHaveLength(4);
    expect(qs.map((q) => q.kind)).not.toContain("time_window");
  });
});

describe("generateInventoryProbeQuestions — input edge cases", () => {
  beforeAll(() => {
    process.env["USE_MOCK_LLM"] = "true";
  });

  it("recentTurns vazio não quebra", async () => {
    const qs = await generateInventoryProbeQuestions({
      ...BASE_INPUT,
      recentTurns: [],
    });
    expect(qs.length).toBeGreaterThan(0);
  });

  it("sem subjectAge default é direto (não lúdico)", async () => {
    const { subjectAge: _unused, ...inputNoAge } = BASE_INPUT;
    const qs = await generateInventoryProbeQuestions(inputNoAge);
    const materialsQ = qs.find((q) => q.kind === "materials_around")!;
    expect(materialsQ.text.toLowerCase()).toContain("construir");
  });
});
