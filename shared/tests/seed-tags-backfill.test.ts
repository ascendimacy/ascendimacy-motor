/**
 * Tests do backfill Subject Knowledge no content/hooks/seed.json.
 * Garante que TODOS os items podem gerar presented_concept via
 * ConceptLedgerWriter — pré-condição para o ledger funcionar em produção.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { extractPresentedConcept } from "../src/concept-ledger-writer.js";
import type { ContentItem } from "../src/content-item.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SEED_PATH = join(__dirname, "..", "..", "content", "hooks", "seed.json");

const items = JSON.parse(readFileSync(SEED_PATH, "utf8")) as ContentItem[];

describe("content/hooks/seed.json — Subject Knowledge backfill", () => {
  it("loaded items > 0", () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it("100% dos items têm axis_id (1..12)", () => {
    const without = items.filter((i) => typeof i.axis_id !== "number");
    expect(without.map((i) => i.id)).toEqual([]);
    for (const item of items) {
      expect(item.axis_id).toBeGreaterThanOrEqual(1);
      expect(item.axis_id).toBeLessThanOrEqual(12);
    }
  });

  it("100% dos items têm family válida", () => {
    for (const item of items) {
      expect(["carater", "disposicao", "cognicao_si"]).toContain(item.family);
    }
  });

  it("family bate com axis_id (1-4=carater, 5-8=disposicao, 9-12=cognicao_si)", () => {
    for (const item of items) {
      if (item.axis_id! >= 1 && item.axis_id! <= 4) expect(item.family).toBe("carater");
      else if (item.axis_id! >= 5 && item.axis_id! <= 8) expect(item.family).toBe("disposicao");
      else expect(item.family).toBe("cognicao_si");
    }
  });

  it("100% têm lineage_anchor formato tradicao/complemento", () => {
    for (const item of items) {
      expect(typeof item.lineage_anchor).toBe("string");
      expect(item.lineage_anchor).toMatch(/^[a-zA-Záâãéêíóôõúç_-]+\/[a-zA-Z_]+$/);
    }
  });

  it("100% têm extracted_keywords não-vazio", () => {
    for (const item of items) {
      expect(Array.isArray(item.extracted_keywords)).toBe(true);
      expect(item.extracted_keywords!.length).toBeGreaterThan(0);
    }
  });

  it("ConceptLedgerWriter gera entry para 100% dos items", () => {
    let missed = 0;
    for (const item of items) {
      const entry = extractPresentedConcept({
        subjectId: "test",
        sessionId: "s",
        turnRef: "s__t",
        item,
      });
      if (entry === null) missed += 1;
    }
    expect(missed).toBe(0);
  });

  it("distribuição razoável entre famílias (cada uma >= 10%)", () => {
    const dist = { carater: 0, disposicao: 0, cognicao_si: 0 };
    for (const item of items) {
      dist[item.family!] = (dist[item.family!] ?? 0) + 1;
    }
    const total = items.length;
    expect(dist.carater / total).toBeGreaterThanOrEqual(0.1);
    expect(dist.disposicao / total).toBeGreaterThanOrEqual(0.1);
    expect(dist.cognicao_si / total).toBeGreaterThanOrEqual(0.1);
  });
});
