import { describe, it, expect } from "vitest";
import { filterF3, filterF5, applyPostProcessors } from "../src/post-processor.js";

describe("filterF3 — anti-infantilização", () => {
  it("flags 'que bonitinho!' in warn mode", () => {
    const result = filterF3("Que bonitinho! Você fez muito bem.", "warn");
    expect(result.passed).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.warnings.some((w) => w.startsWith("F3:"))).toBe(true);
    expect(result.matchedPatterns).toContain("diminutivo_condescendente");
  });

  it("blocks in strict mode when pattern matches", () => {
    const result = filterF3("Uau!! Que incrível!", "strict");
    expect(result.blocked).toBe(true);
  });

  it("does not block in warn mode even with match", () => {
    const result = filterF3("Uau! Que legal!", "warn");
    expect(result.blocked).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("clean text passes with no warnings", () => {
    const result = filterF3("Os Inuit têm mais de 50 palavras pra neve. Quantas você tem pra raiva?", "warn");
    expect(result.passed).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it("flags cascading exclamations", () => {
    const result = filterF3("Muito bem!!! Continue assim.", "warn");
    expect(result.matchedPatterns).toContain("exclamacoes_em_cascata");
  });
});

describe("filterF5 — persona consistency (Kids)", () => {
  it("blocks 'Como posso te ajudar?'", () => {
    const result = filterF5("Olá! Como posso te ajudar hoje?", "ryo-kids-jp");
    expect(result.blocked).toBe(true);
    expect(result.matchedPatterns.some((p) => p.includes("assistente"))).toBe(true);
  });

  it("blocks 'Como IA, eu...'", () => {
    const result = filterF5("Como IA, eu entendo como você se sente.", "ryo-kids-jp");
    expect(result.blocked).toBe(true);
    expect(result.matchedPatterns.some((p) => p.includes("ia"))).toBe(true);
  });

  it("blocks 'Olá! Como posso...'", () => {
    const result = filterF5("Olá! Como posso te ajudar?", "kei-kids-jp");
    expect(result.blocked).toBe(true);
  });

  it("blocks 'eu também adoro!'", () => {
    const result = filterF5("Caramba, eu também adoro! É muito legal.", "ryo-kids-jp");
    expect(result.blocked).toBe(true);
    expect(result.matchedPatterns).toContain("entuasiasmo_artificial_adoro");
  });

  it("blocks generic therapy question", () => {
    const result = filterF5("Como você se sente sobre isso?", "ryo-kids-jp");
    expect(result.blocked).toBe(true);
    expect(result.matchedPatterns).toContain("pergunta_terapeuta_generica");
  });

  it("clean text passes", () => {
    const result = filterF5(
      "Os Inuit têm mais de 50 palavras pra neve. Quantas você tem pra raiva?",
      "ryo-kids-jp",
    );
    expect(result.passed).toBe(true);
    expect(result.blocked).toBe(false);
  });
});

describe("applyPostProcessors — orchestrator com retry F5", () => {
  it("returns original text when both filters pass", async () => {
    const text = "Os Inuit têm mais de 50 palavras pra neve. Quantas você tem pra raiva?";
    const result = await applyPostProcessors(
      text,
      { f3Mode: "warn", personaProfile: "ryo-kids-jp" },
      async () => "should not be called",
    );
    expect(result.passed).toBe(true);
    expect(result.text).toBe(text);
  });

  it("retries when F5 blocked and returns clean text on retry", async () => {
    const cleanText = "Sabe que os Inuit têm 50 palavras pra neve? Tenta isso.";
    let callCount = 0;
    const result = await applyPostProcessors(
      "Olá! Como posso te ajudar?",
      { f3Mode: "warn", personaProfile: "ryo-kids-jp" },
      async () => {
        callCount++;
        return cleanText;
      },
    );
    expect(callCount).toBeGreaterThanOrEqual(1);
    expect(result.text).toBe(cleanText);
    expect(result.passed).toBe(true);
  });

  it("F3 warn mode does not retry — warns but text passes through", async () => {
    let regenerateCalled = false;
    const result = await applyPostProcessors(
      "Que bonitinho! Aqui está sua tarefa.",
      { f3Mode: "warn", personaProfile: "ryo-kids-jp" },
      async () => { regenerateCalled = true; return "retry text"; },
    );
    expect(regenerateCalled).toBe(false);
    expect(result.warnings.some((w) => w.startsWith("F3:"))).toBe(true);
    expect(result.blocked).toBe(false);
  });
});
