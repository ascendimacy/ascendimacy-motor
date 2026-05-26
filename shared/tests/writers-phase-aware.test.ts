/**
 * Tests PR 2 tracer — phase-aware behavior em writers.
 * - DiscoveryWriter: threshold minConfidence filtra entries
 * - ConceptLedgerWriter: ice_breaker gate suprime presented_concept
 */
import { describe, it, expect } from "vitest";
import { extractDiscoveries } from "../src/subject-knowledge-writers.js";
import { extractPresentedConcept } from "../src/concept-ledger-writer.js";
import type { CuriosityHookItem } from "../src/content-item.js";

const baseInput = {
  subjectId: "ryo",
  sessionId: "s1",
  turnRef: "s1__t1",
};

describe("extractDiscoveries — minConfidence threshold", () => {
  it("sem threshold, retorna todas as entries detectadas", () => {
    const out = extractDiscoveries({
      ...baseInput,
      lastUserMessage: "eu gosto de tênis e queria muito poder dormir mais",
    });
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it("threshold 0.4 (ice_breaker) preserva quase tudo", () => {
    const out = extractDiscoveries({
      ...baseInput,
      lastUserMessage: "eu gosto de tênis",
      minConfidence: 0.4,
    });
    // 'gosto de' = interest mid (0.7), passa 0.4
    expect(out.length).toBeGreaterThanOrEqual(1);
  });

  it("threshold 0.6 (challenge_execute) filtra value/need (≤0.55)", () => {
    const out = extractDiscoveries({
      ...baseInput,
      lastUserMessage: "pra mim importa amizade e queria muito poder dormir",
      minConfidence: 0.6,
    });
    // value (0.55) e need (0.5) ficam abaixo de 0.6
    expect(out.filter((e) => e.type === "value")).toHaveLength(0);
    expect(out.filter((e) => e.type === "need")).toHaveLength(0);
  });

  it("threshold 0.7 (follow_up) filtra também interest mid", () => {
    const out = extractDiscoveries({
      ...baseInput,
      lastUserMessage: "eu gosto de tênis",
      minConfidence: 0.71,
    });
    // interest mid é 0.7, abaixo de 0.71 → filtra
    expect(out).toHaveLength(0);
  });

  it("threshold 0.7 preserva interest high (0.9)", () => {
    const out = extractDiscoveries({
      ...baseInput,
      lastUserMessage: "adoro skate, é meu favorito",
      minConfidence: 0.7,
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].confidence).toBeGreaterThanOrEqual(0.7);
  });
});

const taggedItem: CuriosityHookItem = {
  id: "metamorfose_lagarta",
  type: "curiosity_hook",
  domain: "biologia",
  casel_target: ["SA"],
  age_range: [10, 15],
  surprise: 8,
  verified: true,
  base_score: 7,
  fact: "x",
  bridge: "y",
  quest: "z",
  sacrifice_type: "reflect",
  axis_id: 4,
  family: "carater",
  lineage_anchor: "zen/shoshin",
  extracted_keywords: ["lagarta", "casulo"],
};

describe("extractPresentedConcept — phase gate", () => {
  it("ice_breaker suprime entry mesmo com item tagged", () => {
    const entry = extractPresentedConcept({
      ...baseInput,
      item: taggedItem,
      sessionPhase: "ice_breaker",
    });
    expect(entry).toBeNull();
  });

  it("challenge_explain permite emissão", () => {
    const entry = extractPresentedConcept({
      ...baseInput,
      item: taggedItem,
      sessionPhase: "challenge_explain",
    });
    expect(entry).not.toBeNull();
  });

  it("challenge_execute permite emissão (caso principal)", () => {
    const entry = extractPresentedConcept({
      ...baseInput,
      item: taggedItem,
      sessionPhase: "challenge_execute",
    });
    expect(entry).not.toBeNull();
  });

  it("follow_up permite emissão", () => {
    const entry = extractPresentedConcept({
      ...baseInput,
      item: taggedItem,
      sessionPhase: "follow_up",
    });
    expect(entry).not.toBeNull();
  });

  it("backcompat: sem sessionPhase emite (preserva comportamento PR 3)", () => {
    const entry = extractPresentedConcept({
      ...baseInput,
      item: taggedItem,
    });
    expect(entry).not.toBeNull();
  });
});
