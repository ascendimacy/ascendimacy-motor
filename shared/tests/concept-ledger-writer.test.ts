/**
 * Tests do ConceptLedgerWriter (spec 2026-05-25 Fase 3).
 */
import { describe, it, expect } from "vitest";
import {
  extractPresentedConcept,
  extractPresentedConcepts,
} from "../src/concept-ledger-writer.js";
import type { CuriosityHookItem } from "../src/content-item.js";

const taggedItem: CuriosityHookItem = {
  id: "metamorfose_lagarta",
  type: "curiosity_hook",
  domain: "biologia",
  casel_target: ["SA"],
  age_range: [10, 15],
  surprise: 8,
  verified: true,
  base_score: 7,
  fact: "lagarta vira sopa dentro do casulo",
  bridge: "como você muda",
  quest: "que mudança você sentiu?",
  sacrifice_type: "reflect",
  // Subject Knowledge tags:
  axis_id: 4,
  family: "carater",
  lineage_anchor: "zen/shoshin",
  extracted_keywords: ["lagarta", "casulo", "metamorfose", "transformação"],
};

const untaggedItem: CuriosityHookItem = {
  id: "legacy-no-tags",
  type: "curiosity_hook",
  domain: "ciência",
  casel_target: ["SA"],
  age_range: [10, 15],
  surprise: 6,
  verified: true,
  base_score: 5,
  fact: "x",
  bridge: "y",
  quest: "z",
  sacrifice_type: "reflect",
};

describe("extractPresentedConcept — item tagged", () => {
  it("retorna entry presented_concept com +1pt", () => {
    const entry = extractPresentedConcept({
      subjectId: "ryo",
      sessionId: "sess-1",
      turnRef: "sess-1__turn_2",
      item: taggedItem,
    });
    expect(entry).not.toBeNull();
    if (entry && entry.payload.kind === "presented_concept") {
      expect(entry.payload.concept_id).toBe("metamorfose_lagarta");
      expect(entry.payload.axis_id).toBe(4);
      expect(entry.payload.family).toBe("carater");
      expect(entry.payload.lineage_anchor).toBe("zen/shoshin");
      expect(entry.payload.keywords).toContain("metamorfose");
      expect(entry.payload.points).toBe(1);
    }
    expect(entry?.confidence).toBe(1.0);
    expect(entry?.source).toBe("motor_inferred");
    expect(entry?.type).toBe("presented_concept");
  });
});

describe("extractPresentedConcept — item sem tags retorna null", () => {
  it("legacy item sem axis_id/family/lineage_anchor/keywords", () => {
    const entry = extractPresentedConcept({
      subjectId: "ryo",
      sessionId: "sess-1",
      turnRef: "sess-1__turn_2",
      item: untaggedItem,
    });
    expect(entry).toBeNull();
  });

  it("item com axis_id fora de 1..12 retorna null", () => {
    const entry = extractPresentedConcept({
      subjectId: "ryo",
      sessionId: "sess-1",
      turnRef: "sess-1__turn_2",
      item: { ...taggedItem, axis_id: 15 },
    });
    expect(entry).toBeNull();
  });

  it("item com family inválido retorna null", () => {
    const entry = extractPresentedConcept({
      subjectId: "ryo",
      sessionId: "sess-1",
      turnRef: "sess-1__turn_2",
      // @ts-expect-error testing invalid family
      item: { ...taggedItem, family: "nonsense" },
    });
    expect(entry).toBeNull();
  });

  it("item com extracted_keywords vazio retorna null", () => {
    const entry = extractPresentedConcept({
      subjectId: "ryo",
      sessionId: "sess-1",
      turnRef: "sess-1__turn_2",
      item: { ...taggedItem, extracted_keywords: [] },
    });
    expect(entry).toBeNull();
  });

  it("item com lineage_anchor vazio retorna null", () => {
    const entry = extractPresentedConcept({
      subjectId: "ryo",
      sessionId: "sess-1",
      turnRef: "sess-1__turn_2",
      item: { ...taggedItem, lineage_anchor: "" },
    });
    expect(entry).toBeNull();
  });
});

describe("extractPresentedConcepts (array helper)", () => {
  it("retorna array unitário pra item tagged", () => {
    const arr = extractPresentedConcepts({
      subjectId: "ryo",
      sessionId: "sess-1",
      turnRef: "t1",
      item: taggedItem,
    });
    expect(arr).toHaveLength(1);
  });

  it("retorna array vazio pra item untagged", () => {
    const arr = extractPresentedConcepts({
      subjectId: "ryo",
      sessionId: "sess-1",
      turnRef: "t1",
      item: untaggedItem,
    });
    expect(arr).toHaveLength(0);
  });
});
