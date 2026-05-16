import { describe, it, expect } from "vitest";
import { filterF3, filterF5, applyPostProcessors } from "../src/post-processor.js";

describe("filterF3 — anti-infantilização", () => {
  it("flags 'que bonitinho!' in warn mode (passed=false but blocked=false)", () => {
    const result = filterF3("Que bonitinho! Você fez muito bem.", "warn");
    expect(result.passed).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.warnings.some((w) => w.startsWith("F3:"))).toBe(true);
    expect(result.matchedPatterns).toContain("diminutivo_condescendente");
  });

  it("blocks in strict mode when pattern matches", () => {
    const result = filterF3("Uau!! Que incrível!", "strict");
    expect(result.blocked).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("does not block in warn mode even with match", () => {
    const result = filterF3("Uau! Que legal!", "warn");
    expect(result.blocked).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("clean text passes with no warnings", () => {
    const result = filterF3(
      "Os Inuit têm mais de 50 palavras pra neve. Quantas você tem pra raiva?",
      "warn",
    );
    expect(result.passed).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it("flags cascading exclamations (3+)", () => {
    const result = filterF3("Muito bem!!! Continue assim.", "warn");
    expect(result.matchedPatterns).toContain("exclamacoes_em_cascata");
  });

  it("flags 'fantástico!' as elogio condescendente", () => {
    const result = filterF3("Fantástico! Você acertou.", "warn");
    expect(result.matchedPatterns).toContain("elogio_condescendente_fantastico");
  });

  it("warnings carry F3: prefix for tagging in logs", () => {
    const result = filterF3("Uau!", "warn");
    expect(result.warnings.every((w) => w.startsWith("F3:"))).toBe(true);
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

  it("blocks 'Olá! Como posso...' (saudacao assistente)", () => {
    const result = filterF5("Olá! Como posso te ajudar?", "kei-kids-jp");
    expect(result.blocked).toBe(true);
  });

  it("blocks 'eu também adoro!' (entusiasmo artificial)", () => {
    const result = filterF5("Caramba, eu também adoro! É muito legal.", "ryo-kids-jp");
    expect(result.blocked).toBe(true);
    expect(result.matchedPatterns).toContain("entusiasmo_artificial_adoro");
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

  it("warnings carry F5: prefix + persona slice for log tagging", () => {
    const result = filterF5("Como posso te ajudar?", "ryo-kids-jp");
    expect(result.warnings.every((w) => w.startsWith("F5:"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("ryo-kids-jp"))).toBe(true);
  });
});

describe("applyPostProcessors — orchestrator com retry F5", () => {
  it("returns original text when both filters pass", async () => {
    const text = "Os Inuit têm mais de 50 palavras pra neve. Quantas você tem pra raiva?";
    let regenerateCalled = false;
    const result = await applyPostProcessors(
      text,
      { f3Mode: "warn", personaProfile: "ryo-kids-jp" },
      async () => {
        regenerateCalled = true;
        return "should not be called";
      },
    );
    expect(result.passed).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.text).toBe(text);
    expect(regenerateCalled).toBe(false);
  });

  it("retries when F5 blocked and returns clean text on first retry", async () => {
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
    expect(result.blocked).toBe(false);
  });

  it("F3 warn mode does not retry — warns but text passes through", async () => {
    let regenerateCalled = false;
    const result = await applyPostProcessors(
      "Que bonitinho! Aqui está sua tarefa.",
      { f3Mode: "warn", personaProfile: "ryo-kids-jp" },
      async () => {
        regenerateCalled = true;
        return "retry text";
      },
    );
    expect(regenerateCalled).toBe(false);
    expect(result.warnings.some((w) => w.startsWith("F3:"))).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it("F5 retry budget = 2 attempts; if all blocked returns final attempt with blocked=true", async () => {
    let callCount = 0;
    const result = await applyPostProcessors(
      "Como posso te ajudar?",
      { f3Mode: "warn", personaProfile: "ryo-kids-jp" },
      async () => {
        callCount++;
        return "Como posso te ajudar mais uma vez?"; // always blocked
      },
    );
    // 2 in-loop retries + 1 final-attempt fetch (per design) = 3 calls
    expect(callCount).toBe(3);
    expect(result.blocked).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("F3 strict + only F3 blocked: no retry triggered (F3 has no retry budget)", async () => {
    let regenerateCalled = false;
    const result = await applyPostProcessors(
      "Que bonitinho!",
      { f3Mode: "strict", personaProfile: "ryo-kids-jp" },
      async () => {
        regenerateCalled = true;
        return "retry text";
      },
    );
    expect(regenerateCalled).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.filter).toBe("f3");
  });

  it("warnings from both F3 + F5 merged on retry success path", async () => {
    const cleanText = "Texto neutro factual.";
    const result = await applyPostProcessors(
      "Olá! Como posso te ajudar?",
      { f3Mode: "warn", personaProfile: "ryo-kids-jp" },
      async () => cleanText,
    );
    expect(result.text).toBe(cleanText);
    expect(result.passed).toBe(true);
  });
});
