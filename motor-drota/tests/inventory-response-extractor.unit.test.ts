import { describe, it, expect, beforeAll } from "vitest";
import { extractInventoryFromResponse } from "../src/inventory-response-extractor.js";

describe("extractInventoryFromResponse — heurística (mock mode)", () => {
  beforeAll(() => {
    process.env["USE_MOCK_LLM"] = "true";
  });

  describe("materials_around", () => {
    it("extrai lista por vírgula", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "materials_around",
        subject_response: "tenho ovos, farinha, leite e açúcar",
      });
      expect(r.available_materials).toBeTruthy();
      expect(r.available_materials).toContain("ovos");
      expect(r.available_materials).toContain("farinha");
      expect(r.available_materials).toContain("leite");
      expect(r.available_materials).toContain("açúcar");
    });

    it("retorna {} quando resposta é negativa", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "materials_around",
        subject_response: "não tenho nada",
      });
      expect(r).toEqual({});
    });

    it("dedupa entradas iguais", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "materials_around",
        subject_response: "ovos, ovos, farinha",
      });
      expect(r.available_materials!.length).toBe(2);
    });

    it("limita a 8 items", async () => {
      const many = Array(15).fill(0).map((_, i) => `item${i}`).join(", ");
      const r = await extractInventoryFromResponse({
        probe_kind: "materials_around",
        subject_response: many,
      });
      expect(r.available_materials!.length).toBe(8);
    });
  });

  describe("time_window", () => {
    it("extrai horas → minutos", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "time_window",
        subject_response: "tenho umas 2 horas livres",
      });
      expect(r.available_time_minutes).toBe(120);
    });

    it("extrai minutos diretamente", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "time_window",
        subject_response: "tipo 90 minutos",
      });
      expect(r.available_time_minutes).toBe(90);
    });

    it("aceita 'h' como sufixo", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "time_window",
        subject_response: "3h",
      });
      expect(r.available_time_minutes).toBe(180);
    });

    it("número sozinho razoável presume minutos", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "time_window",
        subject_response: "uns 45",
      });
      expect(r.available_time_minutes).toBe(45);
    });

    it("termo qualitativo: uma hora", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "time_window",
        subject_response: "uma hora",
      });
      expect(r.available_time_minutes).toBe(60);
    });

    it("termo qualitativo: tarde toda", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "time_window",
        subject_response: "a tarde toda",
      });
      expect(r.available_time_minutes).toBe(180);
    });

    it("resposta sem número/qualificador → {}", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "time_window",
        subject_response: "sei lá",
      });
      expect(r).toEqual({});
    });
  });

  describe("family_presence", () => {
    it("detecta relações comuns", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "family_presence",
        subject_response: "tô com meu pai e minha irmã",
      });
      expect(r.family_present).toContain("pai");
      expect(r.family_present).toContain("irmã");
    });

    it("ninguém em casa → {}", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "family_presence",
        subject_response: "ninguém, tô sozinho",
      });
      expect(r).toEqual({});
    });

    it("texto sem relações conhecidas → {}", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "family_presence",
        subject_response: "tem gente sim mas não sei quem",
      });
      expect(r).toEqual({});
    });
  });

  describe("budget_capacity", () => {
    it("R$ X,YY", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "budget_capacity",
        subject_response: "posso gastar uns R$ 30,50",
      });
      expect(r.available_budget_cents).toBe(3050);
    });

    it("R$ X (sem centavos)", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "budget_capacity",
        subject_response: "uns R$ 25",
      });
      expect(r.available_budget_cents).toBe(2500);
    });

    it("'X reais'", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "budget_capacity",
        subject_response: "20 reais",
      });
      expect(r.available_budget_cents).toBe(2000);
    });

    it("número sozinho razoável presume reais", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "budget_capacity",
        subject_response: "uns 40",
      });
      expect(r.available_budget_cents).toBe(4000);
    });

    it("nada/zero → 0 centavos explícito (não {})", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "budget_capacity",
        subject_response: "não tenho dinheiro",
      });
      expect(r.available_budget_cents).toBe(0);
    });
  });

  describe("aspirational_wishlist", () => {
    it("retorna resposta inteira como item único", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "aspirational",
        subject_response: "sempre quis fazer um bolo de chocolate sozinho",
      });
      expect(r.aspirational_wishlist).toHaveLength(1);
      expect(r.aspirational_wishlist![0]).toContain("bolo");
    });

    it("trunca em 200 chars", async () => {
      const longText = "x".repeat(300);
      const r = await extractInventoryFromResponse({
        probe_kind: "aspirational",
        subject_response: longText,
      });
      expect(r.aspirational_wishlist![0].length).toBe(200);
    });

    it("negativa curta → {}", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "aspirational",
        subject_response: "não",
      });
      expect(r).toEqual({});
    });

    it("texto curto demais → {}", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "aspirational",
        subject_response: "x",
      });
      expect(r).toEqual({});
    });
  });

  describe("input edge cases", () => {
    it("resposta vazia → {}", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "materials_around",
        subject_response: "",
      });
      expect(r).toEqual({});
    });

    it("resposta só espaço → {}", async () => {
      const r = await extractInventoryFromResponse({
        probe_kind: "materials_around",
        subject_response: "   ",
      });
      expect(r).toEqual({});
    });
  });
});
