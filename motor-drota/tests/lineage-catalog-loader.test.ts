/**
 * Tests do loader do Lineage Catalog (spec 2026-05-25 Fase 4).
 * Cobre: parsing, validação estrutural, redundância por eixo, filtros culturais.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dump as yamlDump } from "js-yaml";
import {
  loadLineageCatalog,
  getCatalog,
  resetCatalogCache,
  DEFAULT_CATALOG_PATH,
} from "../src/lineage-catalog-loader.js";
import {
  getComplementsForAxis,
  getAxis,
  getComplement,
  LINEAGE_TRADITIONS,
  validateLineageCatalog,
  type LineageCatalog,
} from "@ascendimacy/shared";

beforeEach(() => {
  resetCatalogCache();
});

describe("loadLineageCatalog — default path (catálogo v1)", () => {
  it("carrega motor-drota/data/lineage-catalog.yaml sem erros", () => {
    const result = loadLineageCatalog();
    const errors = result.issues.filter((i) => i.level === "error");
    expect(errors).toEqual([]);
  });

  it("contém exatamente 12 eixos", () => {
    const { catalog } = loadLineageCatalog();
    expect(catalog.axes).toHaveLength(12);
  });

  it("cada eixo tem ≥3 complementos de tradições distintas (redundância opt-in)", () => {
    const { catalog } = loadLineageCatalog();
    for (const axis of catalog.axes) {
      const traditions = new Set(axis.complements.map((c) => c.lineage));
      expect(traditions.size).toBeGreaterThanOrEqual(3);
    }
  });

  it("famílias mapeiam corretamente: 1-4 carater, 5-8 disposicao, 9-12 cognicao_si", () => {
    const { catalog } = loadLineageCatalog();
    for (const axis of catalog.axes) {
      if (axis.id <= 4) expect(axis.family).toBe("carater");
      else if (axis.id <= 8) expect(axis.family).toBe("disposicao");
      else expect(axis.family).toBe("cognicao_si");
    }
  });

  it("todas as tradições usadas estão no vocabulário fechado", () => {
    const { catalog } = loadLineageCatalog();
    for (const axis of catalog.axes) {
      for (const c of axis.complements) {
        expect(LINEAGE_TRADITIONS).toContain(c.lineage);
      }
    }
  });

  it("axis_id em cada complement bate com axis_id do eixo pai", () => {
    const { catalog } = loadLineageCatalog();
    for (const axis of catalog.axes) {
      for (const c of axis.complements) {
        expect(c.axis_id).toBe(axis.id);
      }
    }
  });

  it("DEFAULT_CATALOG_PATH aponta pra arquivo existente", () => {
    expect(DEFAULT_CATALOG_PATH).toMatch(/lineage-catalog\.yaml$/);
  });
});

describe("getCatalog — singleton cache", () => {
  it("retorna a mesma instância nas chamadas subsequentes", () => {
    const c1 = getCatalog();
    const c2 = getCatalog();
    expect(c1).toBe(c2);
  });

  it("resetCatalogCache força recarga", () => {
    const c1 = getCatalog();
    resetCatalogCache();
    const c2 = getCatalog();
    expect(c1).not.toBe(c2);
    expect(c1.axes).toHaveLength(c2.axes.length);
  });
});

describe("getAxis / getComplement / getComplementsForAxis (helpers)", () => {
  it("getAxis encontra eixo por ID", () => {
    const cat = getCatalog();
    const axis3 = getAxis(cat, 3);
    expect(axis3?.name).toMatch(/Fortaleza/);
  });

  it("getComplement encontra complement em qualquer eixo", () => {
    const cat = getCatalog();
    const phronesis = getComplement(cat, "phronesis");
    expect(phronesis?.lineage).toBe("aristotelica");
    expect(phronesis?.axis_id).toBe(1);
  });

  it("getComplementsForAxis filtra por allowed_lineages", () => {
    const cat = getCatalog();
    const filtered = getComplementsForAxis(cat, 4, {
      allowed: ["zen", "estoica"],
    });
    expect(filtered.every((c) => c.lineage === "zen" || c.lineage === "estoica")).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
  });

  it("getComplementsForAxis filtra por blocked_lineages", () => {
    const cat = getCatalog();
    const all = getComplementsForAxis(cat, 7);
    const blocked = getComplementsForAxis(cat, 7, { blocked: ["cristã"] });
    expect(blocked.length).toBe(all.length - 1);
    expect(blocked.every((c) => c.lineage !== "cristã")).toBe(true);
  });

  it("sem filtro retorna todos os complements do eixo", () => {
    const cat = getCatalog();
    const all = getComplementsForAxis(cat, 1);
    expect(all.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateLineageCatalog — detecção de issues", () => {
  it("detecta eixo com tradições insuficientes (redundância <3)", () => {
    const bad: LineageCatalog = {
      version: 1,
      axes: Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        family: i < 4 ? "carater" : i < 8 ? "disposicao" : "cognicao_si",
        name: `Eixo ${i + 1}`,
        balances: [],
        complements: [
          { id: `a${i}`, lineage: "estoica", axis_id: i + 1, short_definition: "x", youth_example: "y" },
          { id: `b${i}`, lineage: "estoica", axis_id: i + 1, short_definition: "x", youth_example: "y" },
        ],
      })),
    };
    const issues = validateLineageCatalog(bad);
    const redundancyIssues = issues.filter((i) => i.code === "axis_redundancy_insufficient");
    expect(redundancyIssues.length).toBe(12);
  });

  it("detecta axis_id duplicado", () => {
    const bad: LineageCatalog = {
      version: 1,
      axes: [
        {
          id: 1,
          family: "carater",
          name: "A",
          balances: [],
          complements: [
            { id: "x1", lineage: "estoica", axis_id: 1, short_definition: "x", youth_example: "y" },
            { id: "x2", lineage: "zen", axis_id: 1, short_definition: "x", youth_example: "y" },
            { id: "x3", lineage: "paideia", axis_id: 1, short_definition: "x", youth_example: "y" },
          ],
        },
        {
          id: 1,
          family: "carater",
          name: "A dup",
          balances: [],
          complements: [
            { id: "y1", lineage: "estoica", axis_id: 1, short_definition: "x", youth_example: "y" },
            { id: "y2", lineage: "zen", axis_id: 1, short_definition: "x", youth_example: "y" },
            { id: "y3", lineage: "paideia", axis_id: 1, short_definition: "x", youth_example: "y" },
          ],
        },
      ],
    };
    const issues = validateLineageCatalog(bad);
    expect(issues.some((i) => i.code === "axis_id_duplicate")).toBe(true);
  });

  it("warning quando family não bate com mapeamento esperado por axis_id", () => {
    const bad: LineageCatalog = {
      version: 1,
      axes: Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        family: "carater" as const, // todos como carater — eixos 5..12 vão warning
        name: `Eixo ${i + 1}`,
        balances: [],
        complements: [
          { id: `${i}a`, lineage: "estoica", axis_id: i + 1, short_definition: "x", youth_example: "y" },
          { id: `${i}b`, lineage: "zen", axis_id: i + 1, short_definition: "x", youth_example: "y" },
          { id: `${i}c`, lineage: "paideia", axis_id: i + 1, short_definition: "x", youth_example: "y" },
        ],
      })),
    };
    const issues = validateLineageCatalog(bad);
    const warnings = issues.filter((i) => i.code === "axis_family_unexpected");
    expect(warnings.length).toBe(8);
  });
});

describe("loadLineageCatalog — strict mode + erros", () => {
  it("strict (default) lança erro quando catálogo é inválido", () => {
    const tmp = mkdtempSync(join(tmpdir(), "lineage-bad-"));
    const path = join(tmp, "bad-catalog.yaml");
    const badCat = {
      version: 1,
      axes: [
        {
          id: 1, family: "carater", name: "x", balances: [],
          complements: [
            { id: "a", lineage: "estoica", axis_id: 1, short_definition: "x", youth_example: "y" },
          ],
        },
      ],
    };
    writeFileSync(path, yamlDump(badCat));
    expect(() => loadLineageCatalog({ path })).toThrow(/erro\(s\) de validação/);
  });

  it("strict=false retorna catálogo + issues mesmo com erros", () => {
    const tmp = mkdtempSync(join(tmpdir(), "lineage-bad-"));
    const path = join(tmp, "bad-catalog.yaml");
    const badCat = {
      version: 1,
      axes: [
        {
          id: 1, family: "carater", name: "x", balances: [],
          complements: [
            { id: "a", lineage: "estoica", axis_id: 1, short_definition: "x", youth_example: "y" },
          ],
        },
      ],
    };
    writeFileSync(path, yamlDump(badCat));
    const { catalog, issues } = loadLineageCatalog({ path, strict: false });
    expect(catalog.axes).toHaveLength(1);
    expect(issues.some((i) => i.level === "error")).toBe(true);
  });
});
