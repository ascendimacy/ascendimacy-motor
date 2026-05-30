import { describe, it, expect, beforeAll } from "vitest";
import {
  EmergentPlaybookSchema,
  type SubjectInventory,
  type PlaybookComposerInput,
} from "@ascendimacy/shared";
import { composePlaybook } from "../src/strategist/playbook-composer.js";

const BASE_INVENTORY: SubjectInventory = {
  collected_at: "2026-05-30T14:00:00Z",
  available_materials: ["farinha", "ovo", "açúcar", "leite", "fermento"],
  available_time_minutes: 120,
  available_budget_cents: 3000,
  family_present: ["pai"],
  aspirational_wishlist: ["fazer um bolo"],
  confidence: 2,
};

const BASE_INPUT: PlaybookComposerInput = {
  inventory: BASE_INVENTORY,
  active_axes: ["carater", "cognicao_si"],
  current_objectives: [{ axis: "carater", virtue: "persistencia" }],
  subject_name: "Ryo",
  subject_age: 11,
};

describe("composePlaybook — v0 fallback path (mock mode)", () => {
  beforeAll(() => {
    process.env["USE_MOCK_LLM"] = "true";
  });

  it("retorna EmergentPlaybook válido (passa zod)", async () => {
    const result = await composePlaybook(BASE_INPUT);
    const validated = EmergentPlaybookSchema.safeParse(result);
    expect(validated.success).toBe(true);
  });

  it("playbook_id é único e contém nome do sujeito", async () => {
    const r1 = await composePlaybook(BASE_INPUT);
    // small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await composePlaybook(BASE_INPUT);
    expect(r1.playbook_id).toContain("Ryo");
    expect(r1.playbook_id).not.toBe(r2.playbook_id);
  });

  it("source_inventory copiado do input", async () => {
    const r = await composePlaybook(BASE_INPUT);
    expect(r.source_inventory).toEqual(BASE_INVENTORY);
  });

  it("primary_objective = primeiro objective do input", async () => {
    const r = await composePlaybook(BASE_INPUT);
    expect(r.primary_objective).toEqual({
      axis: "carater",
      virtue: "persistencia",
    });
  });

  it("primary_objective fallback quando input sem objectives", async () => {
    const r = await composePlaybook({ ...BASE_INPUT, current_objectives: [] });
    expect(r.primary_objective.axis).toBe("carater");
    expect(r.primary_objective.virtue).toBe("persistencia");
  });

  it("secondary_objectives derivados de objectives extras (skip primary)", async () => {
    const r = await composePlaybook({
      ...BASE_INPUT,
      current_objectives: [
        { axis: "carater", virtue: "persistencia" },
        { axis: "cognicao_si", virtue: "sequenciar" },
        { axis: "carater", virtue: "honestidade" },
      ],
    });
    expect(r.secondary_objectives).toHaveLength(2);
    expect(r.secondary_objectives[0]!.virtue).toBe("sequenciar");
  });

  it("4-6 steps gerados", async () => {
    const r = await composePlaybook(BASE_INPUT);
    expect(r.steps.length).toBeGreaterThanOrEqual(4);
    expect(r.steps.length).toBeLessThanOrEqual(6);
  });

  it("total_duration_minutes ≤ available_time_minutes", async () => {
    const r = await composePlaybook(BASE_INPUT);
    expect(r.total_duration_minutes).toBeLessThanOrEqual(
      BASE_INVENTORY.available_time_minutes,
    );
  });

  it("budget_range_cents.max ≤ available_budget_cents", async () => {
    const r = await composePlaybook(BASE_INPUT);
    expect(r.budget_range_cents.max).toBeLessThanOrEqual(
      BASE_INVENTORY.available_budget_cents,
    );
  });

  it("philosophical_dilemmas atreladas a steps existentes", async () => {
    const r = await composePlaybook(BASE_INPUT);
    const stepIds = new Set(r.steps.map((s) => s.step_id));
    for (const d of r.philosophical_dilemmas) {
      expect(stepIds.has(d.attached_to_step)).toBe(true);
    }
  });

  it("composition_rationale presente e não-vazio", async () => {
    const r = await composePlaybook(BASE_INPUT);
    expect(r.composition_rationale.length).toBeGreaterThan(0);
  });

  it("dilemmas têm evaluation_focus válido", async () => {
    const r = await composePlaybook(BASE_INPUT);
    const validFocus = new Set([
      "raciocinio",
      "consistencia_com_valor_declarado",
      "consideracao_do_outro",
    ]);
    for (const d of r.philosophical_dilemmas) {
      expect(validFocus.has(d.evaluation_focus)).toBe(true);
    }
  });

  it("composition_rationale indica fallback (sinal observável pra trace)", async () => {
    const r = await composePlaybook(BASE_INPUT);
    expect(r.composition_rationale.toLowerCase()).toContain("fallback");
  });
});

describe("composePlaybook — input edge cases", () => {
  beforeAll(() => {
    process.env["USE_MOCK_LLM"] = "true";
  });

  it("inventário com confidence=0 (guess) ainda compõe", async () => {
    const r = await composePlaybook({
      ...BASE_INPUT,
      inventory: { ...BASE_INVENTORY, confidence: 0 },
    });
    expect(EmergentPlaybookSchema.safeParse(r).success).toBe(true);
  });

  it("inventário com lista vazia de materiais retorna playbook válido", async () => {
    const r = await composePlaybook({
      ...BASE_INPUT,
      inventory: { ...BASE_INVENTORY, available_materials: [] },
    });
    expect(EmergentPlaybookSchema.safeParse(r).success).toBe(true);
  });

  it("previous_playbook_ids passado não quebra", async () => {
    const r = await composePlaybook({
      ...BASE_INPUT,
      previous_playbook_ids: ["piloto-Ryo-12345", "piloto-Ryo-99999"],
    });
    expect(r.playbook_id).toBeTruthy();
  });

  it("subject sem age ainda compõe", async () => {
    const { subject_age: _ignored, ...inputNoAge } = BASE_INPUT;
    const r = await composePlaybook(inputNoAge);
    expect(EmergentPlaybookSchema.safeParse(r).success).toBe(true);
  });
});
