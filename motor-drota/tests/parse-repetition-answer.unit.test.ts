/**
 * Unit tests — parse-repetition-answer (ops#1068 sub-decisão 7).
 *
 * Cobre cascata literal (single-letter, single-digit, linguagem natural)
 * + default per-persona em ambiguidade/silêncio.
 *
 * LLM intent classifier stage (v0.1 follow-up) NÃO coberto aqui.
 */

import { describe, it, expect } from "vitest";
import { parseRepetitionAnswer } from "../src/parse-repetition-answer.js";

describe("parseRepetitionAnswer — single-letter literal", () => {
  it("'a' → choice a", () => {
    const r = parseRepetitionAnswer("a");
    expect(r.choice).toBe("a");
    expect(r.stage).toBe("literal");
    expect(r.confidence).toBe(1);
  });

  it("'B' (uppercase) → choice b", () => {
    const r = parseRepetitionAnswer("B");
    expect(r.choice).toBe("b");
  });

  it("'c.' (com pontuação) → choice c", () => {
    const r = parseRepetitionAnswer("c.");
    expect(r.choice).toBe("c");
  });

  it("'a)' (estilo opção) → choice a", () => {
    const r = parseRepetitionAnswer("a)");
    expect(r.choice).toBe("a");
  });
});

describe("parseRepetitionAnswer — single-digit literal", () => {
  it("'1' → choice a", () => {
    expect(parseRepetitionAnswer("1").choice).toBe("a");
  });

  it("'2' → choice b", () => {
    expect(parseRepetitionAnswer("2").choice).toBe("b");
  });

  it("'3' → choice c", () => {
    expect(parseRepetitionAnswer("3").choice).toBe("c");
  });

  it("'2.' → choice b", () => {
    expect(parseRepetitionAnswer("2.").choice).toBe("b");
  });
});

describe("parseRepetitionAnswer — linguagem natural (a: de novo / mesmo)", () => {
  it("'de novo' → a", () => {
    const r = parseRepetitionAnswer("de novo");
    expect(r.choice).toBe("a");
    expect(r.stage).toBe("literal");
  });

  it("'quero aquele mesmo' → a", () => {
    expect(parseRepetitionAnswer("quero aquele mesmo").choice).toBe("a");
  });

  it("'aquele do Gohan' → a", () => {
    expect(parseRepetitionAnswer("aquele do Gohan").choice).toBe("a");
  });

  it("'tentar de novo' → a", () => {
    expect(parseRepetitionAnswer("tentar de novo").choice).toBe("a");
  });

  it("'repetir' → a", () => {
    expect(parseRepetitionAnswer("repetir").choice).toBe("a");
  });
});

describe("parseRepetitionAnswer — linguagem natural (b: parecido)", () => {
  it("'parecido' → b", () => {
    expect(parseRepetitionAnswer("parecido").choice).toBe("b");
  });

  it("'algo parecido' → b", () => {
    expect(parseRepetitionAnswer("algo parecido").choice).toBe("b");
  });

  it("'outro parecido' → b (precedência sobre 'outro')", () => {
    expect(parseRepetitionAnswer("outro parecido").choice).toBe("b");
  });

  it("'tipo esse' → b", () => {
    expect(parseRepetitionAnswer("tipo esse").choice).toBe("b");
  });

  it("'similar' → b", () => {
    expect(parseRepetitionAnswer("similar").choice).toBe("b");
  });
});

describe("parseRepetitionAnswer — linguagem natural (c: novo / diferente)", () => {
  it("'algo novo' → c", () => {
    expect(parseRepetitionAnswer("algo novo").choice).toBe("c");
  });

  it("'outra coisa' → c", () => {
    expect(parseRepetitionAnswer("outra coisa").choice).toBe("c");
  });

  it("'diferente' → c", () => {
    expect(parseRepetitionAnswer("diferente").choice).toBe("c");
  });

  it("'mudar' → c", () => {
    expect(parseRepetitionAnswer("mudar").choice).toBe("c");
  });

  it("'coisa nova' → c", () => {
    expect(parseRepetitionAnswer("coisa nova").choice).toBe("c");
  });

  it("'outro' (single-word, sem 'parecido') → c", () => {
    expect(parseRepetitionAnswer("outro").choice).toBe("c");
  });

  it("'novo' (single-word) → c", () => {
    expect(parseRepetitionAnswer("novo").choice).toBe("c");
  });
});

describe("parseRepetitionAnswer — default em ambiguidade/silêncio", () => {
  it("string vazia → default b", () => {
    const r = parseRepetitionAnswer("");
    expect(r.choice).toBe("b");
    expect(r.stage).toBe("default");
    expect(r.confidence).toBe(0);
  });

  it("apenas whitespace → default", () => {
    expect(parseRepetitionAnswer("   ").stage).toBe("default");
  });

  it("'tanto faz' → default", () => {
    const r = parseRepetitionAnswer("tanto faz");
    expect(r.stage).toBe("default");
    expect(r.choice).toBe("b");
  });

  it("'sei lá' → default", () => {
    expect(parseRepetitionAnswer("sei lá").stage).toBe("default");
  });

  it("respeita defaultOnSkip per-persona quando default disparado", () => {
    expect(parseRepetitionAnswer("", "a").choice).toBe("a");
    expect(parseRepetitionAnswer("tanto faz", "c").choice).toBe("c");
  });
});

describe("parseRepetitionAnswer — precedência / edge cases", () => {
  it("multi-palavra B vence single-word C ('outro parecido' não vira c)", () => {
    expect(parseRepetitionAnswer("outro parecido").choice).toBe("b");
  });

  it("multi-palavra A vence ('de novo' não vira default)", () => {
    expect(parseRepetitionAnswer("de novo, por favor").choice).toBe("a");
  });

  it("não pega 'a' dentro de 'açúcar' (word boundary)", () => {
    // "açúcar" não contém o pattern \ba\b
    expect(parseRepetitionAnswer("açúcar").stage).toBe("default");
  });

  it("frase longa com keyword no meio", () => {
    expect(parseRepetitionAnswer("mais ou menos, prefiro algo parecido se puder").choice).toBe("b");
  });
});
