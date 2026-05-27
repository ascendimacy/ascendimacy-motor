/**
 * Pool-builder drill integration — verifica que quando o orchestrator
 * passa `contextHints.drill_proposal` serializado, o planejador deserializa
 * e injeta o drill como ScoredContentItem no topo do pool.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md
 */

import { describe, it, expect } from "vitest";
import {
  DRILL_BASE_SCORE,
  DRILL_OVERDUE_BONUS_PER_DAY,
  DRILL_WINDOW_HOOK,
  drillProposalToScoredItem,
  scoreDrillProposal,
  serializeDrillProposal,
  deserializeDrillProposal,
  type DrillItem,
  type DrillProposal,
  type DrillState,
} from "@ascendimacy/shared";

const NOW = "2026-05-27T12:00:00.000Z";
const TWO_DAYS_AGO = "2026-05-25T12:00:00.000Z";

const buildItem = (overrides: Partial<DrillItem> = {}): DrillItem => ({
  id: "jpv-001",
  bank_id: "ja-pt-vocab-n5",
  type: "vocab",
  axis: "language.jp_pt",
  difficulty: 1,
  payload: { prompt: "りんご", answer: "maçã", accept_variants: ["maca"] },
  ...overrides,
});

const buildState = (overrides: Partial<DrillState> = {}): DrillState => ({
  persona_id: "ryo-ochiai",
  item_id: "jpv-001",
  presented_count: 3,
  correct_count: 2,
  last_seen_at: TWO_DAYS_AGO,
  next_due_at: TWO_DAYS_AGO, // 2d overdue at NOW
  current_interval_days: 1,
  current_easiness: 2.5,
  mastery_reached_at: null,
  last_5_attempts: ["correct", "correct", "incorrect"],
  ...overrides,
});

const buildProposal = (): DrillProposal => ({
  hook: DRILL_WINDOW_HOOK,
  item: buildItem(),
  state: buildState(),
  cost: 2,
});

describe("scoreDrillProposal", () => {
  it("retorna DRILL_BASE_SCORE quando state é exato no due", () => {
    const state = buildState({ next_due_at: NOW });
    expect(scoreDrillProposal(state, NOW)).toBe(DRILL_BASE_SCORE);
  });

  it("adiciona bonus linear por dias de atraso", () => {
    const state = buildState({ next_due_at: TWO_DAYS_AGO });
    expect(scoreDrillProposal(state, NOW)).toBe(
      DRILL_BASE_SCORE + 2 * DRILL_OVERDUE_BONUS_PER_DAY,
    );
  });

  it("capa o bonus em DRILL_MAX_OVERDUE_BONUS pra items muito antigos", () => {
    const veryOld = "2025-01-01T00:00:00.000Z";
    const state = buildState({ next_due_at: veryOld });
    const score = scoreDrillProposal(state, NOW);
    expect(score).toBeLessThanOrEqual(DRILL_BASE_SCORE + 30);
    expect(score).toBeGreaterThan(DRILL_BASE_SCORE);
  });
});

describe("drillProposalToScoredItem", () => {
  it("constrói ScoredContentItem do tipo drill_vocab", () => {
    const scored = drillProposalToScoredItem(buildProposal(), 8, NOW);
    expect(scored.item.type).toBe("drill_vocab");
    expect(scored.item.id).toBe("drill:jpv-001");
    const drillItem = scored.item as { prompt: string; answer: string; bank_id: string };
    expect(drillItem.prompt).toBe("りんご");
    expect(drillItem.answer).toBe("maçã");
    expect(drillItem.bank_id).toBe("ja-pt-vocab-n5");
  });

  it("score reflete SR urgency (2d overdue → +10)", () => {
    const scored = drillProposalToScoredItem(buildProposal(), 8, NOW);
    expect(scored.score).toBe(DRILL_BASE_SCORE + 2 * DRILL_OVERDUE_BONUS_PER_DAY);
    expect(scored.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("drill_due"),
        "drill_bank=ja-pt-vocab-n5",
      ]),
    );
  });

  it("detecta source_language=jp via charset", () => {
    const scored = drillProposalToScoredItem(buildProposal(), 8, NOW);
    const drillItem = scored.item as { source_language?: string };
    expect(drillItem.source_language).toBe("jp");
  });
});

describe("serialize/deserialize drill proposal", () => {
  it("round-trip preserva todos os campos", () => {
    const original = buildProposal();
    const serialized = serializeDrillProposal(original);
    const json = JSON.parse(JSON.stringify(serialized));
    const deserialized = deserializeDrillProposal(json);
    expect(deserialized).not.toBeNull();
    expect(deserialized!.hook).toBe(DRILL_WINDOW_HOOK);
    expect(deserialized!.item.id).toBe(original.item.id);
    expect(deserialized!.state.persona_id).toBe(original.state.persona_id);
    expect(deserialized!.cost).toBe(original.cost);
  });

  it("deserialize retorna null para shape inválido", () => {
    expect(deserializeDrillProposal(null)).toBeNull();
    expect(deserializeDrillProposal({})).toBeNull();
    expect(deserializeDrillProposal({ hook: "other", item: {}, state: {}, cost: 1 })).toBeNull();
    expect(deserializeDrillProposal({ hook: DRILL_WINDOW_HOOK, cost: 1 })).toBeNull();
  });
});
