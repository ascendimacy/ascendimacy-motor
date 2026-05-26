import { describe, it, expect } from "vitest";
import { detectMilestone } from "../src/milestone-detector.js";

describe("detectMilestone — positivos (8 tipos)", () => {
  it("first_avowal: detecta 'eu aprendi'", () => {
    const r = detectMilestone("Eu aprendi que posso ser mais paciente", [], "ryo");
    expect(r?.type).toBe("first_avowal");
    expect(r?.persona).toBe("ryo");
    expect(r?.axis).toBe("autoconhecimento");
    expect(r?.evidence).toContain("aprendi");
    expect(r?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("fear_named: detecta 'tenho medo'", () => {
    const r = detectMilestone("Tenho medo de errar na frente de todo mundo", [], "kei");
    expect(r?.type).toBe("fear_named");
    expect(r?.persona).toBe("kei");
  });

  it("conflict_resolved: detecta via signal 'resolution'", () => {
    const r = detectMilestone("ok", ["resolution", "mood_drift_up"], "ryo");
    expect(r?.type).toBe("conflict_resolved");
  });

  it("conflict_resolved: detecta via frase 'resolvemos'", () => {
    const r = detectMilestone("Resolvemos a briga com minha irmã", [], "ryo");
    expect(r?.type).toBe("conflict_resolved");
  });

  it("value_articulated: detecta 'o que mais importa'", () => {
    const r = detectMilestone("O que mais importa é ser honesto", [], "saki");
    expect(r?.type).toBe("value_articulated");
    expect(r?.axis).toBe("honestidade");
  });

  it("virtue_practiced: detecta 'consegui'", () => {
    const r = detectMilestone("Consegui terminar o dever de casa hoje", [], "ryo");
    expect(r?.type).toBe("virtue_practiced");
    expect(r?.axis).toBe("temperança");
  });

  it("regression_recognized: detecta 'errei de novo'", () => {
    const r = detectMilestone("Errei de novo com meu irmão, fui grosso", [], "kei");
    expect(r?.type).toBe("regression_recognized");
    expect(r?.axis).toBe("prudência");
  });

  it("sacrifice_chosen: detecta 'prefiro'", () => {
    const r = detectMilestone("Prefiro ficar em casa do que ir à festa", [], "ryo");
    expect(r?.type).toBe("sacrifice_chosen");
  });

  it("repair_initiated: detecta 'desculpa'", () => {
    const r = detectMilestone("Desculpa pelo que fiz ontem, foi errado", [], "saki");
    expect(r?.type).toBe("repair_initiated");
    expect(r?.axis).toBe("justiça");
  });
});

describe("detectMilestone — negativos (sem milestone)", () => {
  it("retorna null para mensagem neutra", () => {
    expect(detectMilestone("tudo bem por aqui", [], "ryo")).toBeNull();
  });

  it("retorna null para mensagem vazia", () => {
    expect(detectMilestone("", [], "ryo")).toBeNull();
  });

  it("retorna null para mensagem sem padrão e sem signals", () => {
    expect(detectMilestone("ok legal", [], "ryo")).toBeNull();
  });
});

describe("detectMilestone — evidence truncation", () => {
  it("trunca evidence em 200 chars", () => {
    const long = "eu aprendi " + "x".repeat(300);
    const r = detectMilestone(long, [], "ryo");
    expect(r?.type).toBe("first_avowal");
    expect(r?.evidence.length).toBeLessThanOrEqual(200);
  });
});
