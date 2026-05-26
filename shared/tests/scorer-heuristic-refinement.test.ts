/**
 * Tests refinements de heurística no scorer multi-dim:
 * - latent_needs longos são tokenizados (match palavra a palavra)
 * - interest fallback pra domain_ranking quando interests vazio
 */
import { describe, it, expect } from "vitest";
import { evaluateMultiDimMatches } from "../src/scorer.js";
import type { CuriosityHookItem } from "../src/content-item.js";

const baseItem = (overrides: Partial<CuriosityHookItem>): CuriosityHookItem => ({
  id: "test-item",
  type: "curiosity_hook",
  domain: "biologia",
  casel_target: ["SA"],
  age_range: [10, 15],
  surprise: 7,
  verified: true,
  base_score: 5,
  fact: "x",
  bridge: "y",
  quest: "z",
  sacrifice_type: "reflect",
  axis_id: 11,
  family: "cognicao_si",
  lineage_anchor: "paideia/gnothi_seauton",
  extracted_keywords: ["expressao", "emocional", "sentimentos"],
  ...overrides,
});

describe("scorer heuristic refinement — latent_needs tokenization", () => {
  it("match exato palavra única funciona (caso simples)", () => {
    const item = baseItem({});
    const m = evaluateMultiDimMatches(item, {
      age: 12,
      latent_needs: ["emocional"],
    });
    expect(m.need).toBe(true);
  });

  it("string longa 'expressão emocional' agora matcha keyword 'emocional'", () => {
    const item = baseItem({});
    const m = evaluateMultiDimMatches(item, {
      age: 12,
      latent_needs: ["expressão emocional"], // antes nunca matchava (string longa)
    });
    expect(m.need).toBe(true);
  });

  it("frase muito longa parece estranha mas extrai tokens >3 chars", () => {
    const item = baseItem({ extracted_keywords: ["acadêmico"] });
    const m = evaluateMultiDimMatches(item, {
      age: 12,
      latent_needs: ["equilíbrio acadêmico sem pressão"],
    });
    expect(m.need).toBe(true);
  });

  it("stopwords PT-BR não disparam falso match", () => {
    const item = baseItem({ extracted_keywords: ["de", "com", "para"] });
    const m = evaluateMultiDimMatches(item, {
      age: 12,
      latent_needs: ["coisa importante de verdade"],
    });
    expect(m.need).toBe(false); // só "de" matcharia, mas é stopword
  });

  it("retorna false quando nenhum token bate", () => {
    const item = baseItem({ extracted_keywords: ["zen", "shoshin"] });
    const m = evaluateMultiDimMatches(item, {
      age: 12,
      latent_needs: ["coisas totalmente diferentes do conteúdo"],
    });
    expect(m.need).toBe(false);
  });
});

describe("scorer heuristic refinement — interest fallback domain_ranking", () => {
  it("usa interests quando presente (caso normal)", () => {
    const item = baseItem({ domain: "biologia" });
    const m = evaluateMultiDimMatches(item, {
      age: 12,
      interests: ["biologia"],
    });
    expect(m.interest).toBe(true);
  });

  it("fallback pra domain_ranking keys quando interests vazio/ausente", () => {
    const item = baseItem({ domain: "biologia" });
    const m = evaluateMultiDimMatches(item, {
      age: 12,
      domain_ranking: { biologia: { score: 0.8 }, social: { score: 0.5 } },
    });
    expect(m.interest).toBe(true); // veio do domain_ranking, não interests
  });

  it("fallback considera só nomes dos domínios (keys), não scores", () => {
    const item = baseItem({ domain: "matematica" });
    const m = evaluateMultiDimMatches(item, {
      age: 12,
      domain_ranking: { matematica: { score: 0.5 } },
    });
    expect(m.interest).toBe(true);
  });

  it("interests explícitos VENCEM domain_ranking quando ambos presentes", () => {
    const item = baseItem({ domain: "fisica" });
    const m = evaluateMultiDimMatches(item, {
      age: 12,
      interests: ["fisica"], // matcha
      domain_ranking: { biologia: { score: 0.9 } }, // ignorado
    });
    expect(m.interest).toBe(true);
  });

  it("retorna false sem interests e sem domain_ranking", () => {
    const item = baseItem({});
    const m = evaluateMultiDimMatches(item, { age: 12 });
    expect(m.interest).toBe(false);
  });
});
