/**
 * Tests recall_check_candidate hookup no materializer.
 * Foco: applyRecallCheckFraming pura — anexa framing ao texto final.
 *
 * O materialize completo é testado em smoke (LLM call real). Aqui só a
 * lógica de anexação é testada isolada.
 */
import { describe, it, expect } from "vitest";
import { applyRecallCheckFraming } from "../src/constrained-materializer.js";

describe("applyRecallCheckFraming", () => {
  it("sem candidate: texto original sem emitted", () => {
    const r = applyRecallCheckFraming("Que legal!", undefined);
    expect(r.text).toBe("Que legal!");
    expect(r.emitted).toBeUndefined();
  });

  it("candidate válido: texto recebe framing com separador adequado", () => {
    const r = applyRecallCheckFraming("Que legal.", {
      concept_id: "metamorfose_lagarta",
      suggested_framing: "lembra daquela lagarta?",
    });
    expect(r.text).toBe("Que legal. lembra daquela lagarta?");
    expect(r.emitted?.concept_id).toBe("metamorfose_lagarta");
    expect(r.emitted?.framing_used).toBe("lembra daquela lagarta?");
  });

  it("separador ' — ' quando texto NÃO termina em pontuação", () => {
    const r = applyRecallCheckFraming("Aqui vai um pensamento", {
      concept_id: "x",
      suggested_framing: "lembra?",
    });
    expect(r.text).toBe("Aqui vai um pensamento — lembra?");
  });

  it("separador ' ' quando texto termina em '?'", () => {
    const r = applyRecallCheckFraming("Você concorda?", {
      concept_id: "x",
      suggested_framing: "lembra do casulo?",
    });
    expect(r.text).toBe("Você concorda? lembra do casulo?");
  });

  it("separador ' ' quando texto termina em '!'", () => {
    const r = applyRecallCheckFraming("Beleza!", {
      concept_id: "x",
      suggested_framing: "lembra?",
    });
    expect(r.text).toBe("Beleza! lembra?");
  });

  it("framing vazio (trim): retorna texto original sem emitted", () => {
    const r = applyRecallCheckFraming("Texto.", {
      concept_id: "x",
      suggested_framing: "   ",
    });
    expect(r.text).toBe("Texto.");
    expect(r.emitted).toBeUndefined();
  });

  it("texto vazio: retorna vazio sem emitted (preserva sinal de erro)", () => {
    const r = applyRecallCheckFraming("", {
      concept_id: "x",
      suggested_framing: "lembra?",
    });
    expect(r.text).toBe("");
    expect(r.emitted).toBeUndefined();
  });

  it("framing com espaços externos: trim automático", () => {
    const r = applyRecallCheckFraming("Texto.", {
      concept_id: "x",
      suggested_framing: "  lembra?  ",
    });
    expect(r.text).toBe("Texto. lembra?");
    expect(r.emitted?.framing_used).toBe("lembra?");
  });
});
