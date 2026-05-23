/**
 * S-T-10-09 (ops#1070) — unit tests pra canSkipDrotaComposition.
 *
 * Cobre as 4 gating conditions:
 *   1. Feature flag ASC_SKIP_DROTA_COMPOSITION
 *   2. item.domain === "action_menu"
 *   3. content extractable + length >= threshold
 *   4. !item.is_critical
 */

import { describe, it, expect } from "vitest";
import type { ContentItem } from "@ascendimacy/shared";
import {
  canSkipDrotaComposition,
  extractMenuContent,
  DEFAULT_MIN_CONTENT_LEN,
} from "../src/compose-skip.js";

// ─── Test fixtures ─────────────────────────────────────────────────────────
const baseCuriosityHook: ContentItem = {
  id: "test-curio",
  type: "curiosity_hook",
  domain: "action_menu",
  casel_target: [],
  age_range: [7, 17],
  surprise: 8,
  verified: true,
  base_score: 8,
  fact: "Esta é uma curiosity rich enough pra passar threshold de 80 chars — tem certa densidade semântica.",
  bridge: "",
  quest: "",
  sacrifice_type: "reflect",
};

const envOn = { ASC_SKIP_DROTA_COMPOSITION: "true" };
const envOff = {};

// ─── extractMenuContent ────────────────────────────────────────────────────
describe("extractMenuContent", () => {
  it("retorna fact pra curiosity_hook", () => {
    expect(extractMenuContent(baseCuriosityHook)).toBe(baseCuriosityHook.fact);
  });

  it("retorna fact pra cultural_diamond", () => {
    const item: ContentItem = {
      ...baseCuriosityHook,
      type: "cultural_diamond",
    } as ContentItem;
    expect(extractMenuContent(item)).toBe(item.fact);
  });

  it("retorna description pra challenge", () => {
    const item: ContentItem = {
      id: "test-chal",
      type: "challenge",
      domain: "action_menu",
      casel_target: [],
      age_range: [7, 17],
      surprise: 7,
      verified: true,
      base_score: 7,
      description: "Descrição do challenge longa o suficiente pra passar threshold de skip.",
      expected_outcome: "",
      estimated_minutes: 10,
    } as ContentItem;
    expect(extractMenuContent(item)).toBe(item.description);
  });

  it("retorna setup pra dynamic", () => {
    const item: ContentItem = {
      id: "test-dyn",
      type: "dynamic",
      domain: "action_menu",
      casel_target: [],
      age_range: [7, 17],
      surprise: 7,
      verified: true,
      base_score: 7,
      title: "x",
      setup: "Setup do dynamic é o conteúdo principal do item — deve estar acima do threshold.",
      execution: "",
      closing: "",
      multi_turn: false,
    } as ContentItem;
    expect(extractMenuContent(item)).toBe(item.setup);
  });
});

// ─── canSkipDrotaComposition ───────────────────────────────────────────────
describe("canSkipDrotaComposition", () => {
  it("REJECT: feature flag off (default)", () => {
    const d = canSkipDrotaComposition(baseCuriosityHook, envOff);
    expect(d.shouldSkip).toBe(false);
    expect(d.reason).toBe("feature_flag_off");
  });

  it("REJECT: item.domain != action_menu", () => {
    const item = { ...baseCuriosityHook, domain: "fallback" };
    const d = canSkipDrotaComposition(item as ContentItem, envOn);
    expect(d.shouldSkip).toBe(false);
    expect(d.reason).toBe("not_from_action_menu");
  });

  it("REJECT: item.is_critical=true", () => {
    const item = { ...baseCuriosityHook, is_critical: true };
    const d = canSkipDrotaComposition(item as ContentItem, envOn);
    expect(d.shouldSkip).toBe(false);
    expect(d.reason).toBe("item_is_critical");
  });

  it("REJECT: content < MIN_CONTENT_LEN", () => {
    const item = { ...baseCuriosityHook, fact: "muito curto" };
    const d = canSkipDrotaComposition(item as ContentItem, envOn);
    expect(d.shouldSkip).toBe(false);
    expect(d.reason).toMatch(/content_too_short/);
  });

  it("REJECT: content vazio retorna no_extractable_content", () => {
    const item = { ...baseCuriosityHook, fact: "" };
    const d = canSkipDrotaComposition(item as ContentItem, envOn);
    expect(d.shouldSkip).toBe(false);
    expect(d.reason).toBe("no_extractable_content");
  });

  it("ACCEPT: todas gating passam → skip_eligible + content populated", () => {
    const d = canSkipDrotaComposition(baseCuriosityHook, envOn);
    expect(d.shouldSkip).toBe(true);
    expect(d.reason).toBe("skip_eligible");
    expect(d.content).toBe(baseCuriosityHook.fact);
  });

  it("threshold customizável", () => {
    const item = { ...baseCuriosityHook, fact: "tem 20 chars exatamente!" }; // < 80 mas >= 20
    const dDefault = canSkipDrotaComposition(item as ContentItem, envOn);
    expect(dDefault.shouldSkip).toBe(false);
    const dLow = canSkipDrotaComposition(item as ContentItem, envOn, 20);
    expect(dLow.shouldSkip).toBe(true);
  });

  it("DEFAULT_MIN_CONTENT_LEN exposto = 80", () => {
    expect(DEFAULT_MIN_CONTENT_LEN).toBe(80);
  });
});
