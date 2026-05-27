/**
 * Drill materialization — verifica short-circuit determinístico em items
 * `drill_vocab`. Sem LLM call, prompt-template fixo por source_language.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md
 */

import { describe, it, expect } from "vitest";
import {
  materialize,
  materializeDrillVocab,
} from "../src/constrained-materializer.js";
import type { ScoredContentItem } from "@ascendimacy/shared";

describe("materializeDrillVocab (template)", () => {
  it("emite pergunta JP→PT pra source japonês", () => {
    const text = materializeDrillVocab({
      prompt: "りんご",
      source_language: "jp",
    });
    expect(text).toContain("りんご");
    expect(text).toMatch(/em portugu[êe]s/i);
  });

  it("emite pergunta genérica pra source desconhecido", () => {
    const text = materializeDrillVocab({ prompt: "fork" });
    expect(text).toContain("fork");
    expect(text).toMatch(/o que significa/i);
  });

  it("anexa dica quando hint presente", () => {
    const text = materializeDrillVocab({
      prompt: "犬",
      source_language: "jp",
      hint: "animal de estimação",
    });
    expect(text).toContain("dica: animal de estimação");
  });

  it("ignora hint vazio", () => {
    const text = materializeDrillVocab({
      prompt: "犬",
      source_language: "jp",
      hint: "  ",
    });
    expect(text).not.toContain("dica");
  });
});

describe("materialize() — drill_vocab short-circuit", () => {
  const drillAction = (): ScoredContentItem => ({
    item: {
      id: "drill:jpv-001",
      type: "drill_vocab",
      domain: "drill.ja-pt-vocab-n5",
      casel_target: [],
      age_range: [4, 12],
      surprise: 3,
      verified: true,
      base_score: 60,
      drill_item_id: "jpv-001",
      bank_id: "ja-pt-vocab-n5",
      prompt: "りんご",
      answer: "maçã",
      source_language: "jp",
    } as ScoredContentItem["item"],
    score: 70,
    reasons: ["drill_due(overdue_days=2.00)"],
  });

  it("retorna fallback_triggered=false + model_used=drill_template_v0 + zero token", async () => {
    const result = await materialize({
      action: drillAction(),
      subjectNameForm: "Ryo",
      mood: 5,
      engagement: "medium",
      turnCount: 4,
      budgetRemaining: 80,
      jurisdictionActive: "jp",
      incomingMessage: "tô pronto",
    });
    expect(result.fallback_triggered).toBe(false);
    expect(result.model_used).toBe("drill_template_v0");
    expect(result.token_count).toBe(0);
    expect(result.text).toContain("りんご");
    expect(result.text).toMatch(/portugu[êe]s/i);
  });

  it("não chama LLM mesmo em turn 1 (zero rapport setup)", async () => {
    // Sem mock — se LLM fosse chamada com sucesso o teste pegaria
    // latency >0; com short-circuit a latency é ~ms locais.
    const t0 = Date.now();
    const result = await materialize({
      action: drillAction(),
      subjectNameForm: "Ryo",
      mood: 5,
      engagement: "medium",
      turnCount: 1,
      budgetRemaining: 100,
      jurisdictionActive: "jp",
    });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
    expect(result.fallback_triggered).toBe(false);
  });

  it("inclui hint no output quando presente", async () => {
    const action = drillAction();
    (action.item as { hint?: string }).hint = "fruta vermelha";
    const result = await materialize({
      action,
      subjectNameForm: "Kei",
      mood: 6,
      engagement: "high",
      turnCount: 3,
      budgetRemaining: 80,
      jurisdictionActive: "jp",
    });
    expect(result.text).toContain("dica: fruta vermelha");
  });
});
