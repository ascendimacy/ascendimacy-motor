import { describe, it, expect } from "vitest";
import { extractIntent } from "../src/intent-extractor.js";

const NOW = "2026-05-26T10:00:00.000Z"; // terça-feira

function baseInput(message: string): {
  message: string;
  personaId: string;
  sessionId: string;
  now: string;
} {
  return {
    message,
    personaId: "ryo",
    sessionId: "sess-1",
    now: NOW,
  };
}

describe("extractIntent — positive cases", () => {
  it("PT: 'quero ... até fim do mês'", async () => {
    const obj = await extractIntent(
      baseInput("Quero aprender frações até fim do mês"),
    );
    expect(obj).not.toBeNull();
    expect(obj!.statement).toContain("aprender frações");
    // fim de maio 2026 — 23:59:59 UTC
    expect(obj!.target_date.startsWith("2026-05-31T23:59:59")).toBe(true);
    expect(obj!.status).toBe("active");
    expect(obj!.persona_id).toBe("ryo");
  });

  it("PT: 'quero ... em 2 semanas' (inferido)", async () => {
    const obj = await extractIntent(
      baseInput("Quero treinar tabuada em 2 semanas"),
    );
    expect(obj).not.toBeNull();
    // 2026-05-26 + 14d = 2026-06-09
    expect(obj!.target_date.startsWith("2026-06-09")).toBe(true);
  });

  it("PT: 'vou ... em 7 dias'", async () => {
    const obj = await extractIntent(baseInput("Vou ler 3 livros em 7 dias"));
    expect(obj).not.toBeNull();
    expect(obj!.target_date.startsWith("2026-06-02")).toBe(true);
  });

  it("PT: 'pretendo ... até 2026-06-15' (literal ISO)", async () => {
    const obj = await extractIntent(
      baseInput("Pretendo terminar o projeto até 2026-06-15"),
    );
    expect(obj).not.toBeNull();
    expect(obj!.target_date.startsWith("2026-06-15")).toBe(true);
  });

  it("PT: 'meta: ... até sexta'", async () => {
    const obj = await extractIntent(
      baseInput("Meta: aprender hiragana até sexta"),
    );
    expect(obj).not.toBeNull();
    // 2026-05-26 = terça, próxima sexta = 2026-05-29
    expect(obj!.target_date.startsWith("2026-05-29")).toBe(true);
  });

  it("PT: 'quero ... até 30/06' (DD/MM no ano corrente)", async () => {
    const obj = await extractIntent(
      baseInput("Quero correr 5km até 30/06"),
    );
    expect(obj).not.toBeNull();
    expect(obj!.target_date.startsWith("2026-06-30")).toBe(true);
  });

  it("PT: caso com pontuação final", async () => {
    const obj = await extractIntent(
      baseInput("Quero aprender violão em 30 dias."),
    );
    expect(obj).not.toBeNull();
    expect(obj!.statement.endsWith(".")).toBe(false);
  });

  it("JP: '今月末までに〜したい'", async () => {
    const obj = await extractIntent(
      baseInput("今月末までに掛け算をマスターしたい"),
    );
    expect(obj).not.toBeNull();
    expect(obj!.target_date.startsWith("2026-05-31T23:59:59")).toBe(true);
  });

  it("JP: '2週間で〜したい'", async () => {
    const obj = await extractIntent(
      baseInput("2週間でひらがなを覚えたい"),
    );
    expect(obj).not.toBeNull();
    expect(obj!.target_date.startsWith("2026-06-09")).toBe(true);
  });

  it("PT: statement trunca em 200 chars", async () => {
    const longWhat = "a".repeat(250);
    const obj = await extractIntent(
      baseInput(`Quero ${longWhat} até fim do mês`),
    );
    expect(obj).not.toBeNull();
    expect(obj!.statement.length).toBeLessThanOrEqual(200);
  });
});

describe("extractIntent — negative cases", () => {
  it("retorna null se sem verbo intent", async () => {
    const obj = await extractIntent(baseInput("Hoje fez frio na escola"));
    expect(obj).toBeNull();
  });

  it("retorna null se sem expressão temporal", async () => {
    const obj = await extractIntent(baseInput("Quero aprender violão"));
    expect(obj).toBeNull();
  });

  it("retorna null se expressão temporal não-resolvível", async () => {
    const obj = await extractIntent(
      baseInput("Quero aprender alguma coisa até qualquer dia"),
    );
    expect(obj).toBeNull();
  });

  it("retorna null se message vazia", async () => {
    const obj = await extractIntent(baseInput(""));
    expect(obj).toBeNull();
  });

  it("retorna null se now invalido", async () => {
    const obj = await extractIntent({
      ...baseInput("Quero X até fim do mês"),
      now: "not-a-date",
    });
    expect(obj).toBeNull();
  });
});

describe("extractIntent — LLM fallback", () => {
  it("chama llmFallback quando regex falha", async () => {
    let called = false;
    const obj = await extractIntent({
      ...baseInput("alguma frase sem padrão regex"),
      llmFallback: async () => {
        called = true;
        return {
          statement: "objetivo via LLM",
          target_date: "2026-07-01T23:59:59.000Z",
          axis: "virtue:wisdom",
        };
      },
    });
    expect(called).toBe(true);
    expect(obj).not.toBeNull();
    expect(obj!.statement).toBe("objetivo via LLM");
    expect(obj!.axis).toBe("virtue:wisdom");
  });

  it("NÃO chama llmFallback quando regex já matchou", async () => {
    let called = false;
    const obj = await extractIntent({
      ...baseInput("Quero aprender frações até fim do mês"),
      llmFallback: async () => {
        called = true;
        return null;
      },
    });
    expect(called).toBe(false);
    expect(obj).not.toBeNull();
  });

  it("llmFallback retornando null → extract retorna null", async () => {
    const obj = await extractIntent({
      ...baseInput("frase sem padrão"),
      llmFallback: async () => null,
    });
    expect(obj).toBeNull();
  });

  it("llmFallback erro é absorvido fail-soft", async () => {
    const obj = await extractIntent({
      ...baseInput("frase sem padrão"),
      llmFallback: async () => {
        throw new Error("LLM down");
      },
    });
    expect(obj).toBeNull();
  });
});
