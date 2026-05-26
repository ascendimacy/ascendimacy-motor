import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dump as yamlDump } from "js-yaml";
import {
  loadPlaybookMoves,
  getPlaybookCatalog,
  resetPlaybookCache,
  getMoveById,
  getMovesByPhase,
  getMovesByTargetFramework,
  validatePlaybookCatalog,
  type PlaybookCatalog,
} from "../src/playbook-moves-loader.js";

beforeEach(() => {
  resetPlaybookCache();
});

describe("loadPlaybookMoves — catálogo default", () => {
  it("carrega motor-drota/data/playbook-moves.yaml sem erros", () => {
    const result = loadPlaybookMoves();
    expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("contém ≥10 moves (v1 deve ser substancial)", () => {
    const { catalog } = loadPlaybookMoves();
    expect(catalog.moves.length).toBeGreaterThanOrEqual(10);
  });

  it("todos os IDs únicos", () => {
    const { catalog } = loadPlaybookMoves();
    const ids = catalog.moves.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todas as 4 phases têm pelo menos 1 move (cobertura)", () => {
    const { catalog } = loadPlaybookMoves();
    const phasesCovered = new Set(catalog.moves.map((m) => m.phase));
    expect(phasesCovered.has("ice_breaker")).toBe(true);
    expect(phasesCovered.has("challenge_explain")).toBe(true);
    expect(phasesCovered.has("challenge_execute")).toBe(true);
    expect(phasesCovered.has("follow_up")).toBe(true);
  });

  it("todos os moves têm framing_template + success_signal não-vazio", () => {
    const { catalog } = loadPlaybookMoves();
    for (const m of catalog.moves) {
      expect(m.framing_template.length).toBeGreaterThan(0);
      expect(m.success_signal.length).toBeGreaterThan(0);
    }
  });

  it("estimated_minutes coerente (>0 e <30 por move)", () => {
    const { catalog } = loadPlaybookMoves();
    for (const m of catalog.moves) {
      expect(m.estimated_minutes).toBeGreaterThan(0);
      expect(m.estimated_minutes).toBeLessThanOrEqual(30);
    }
  });
});

describe("getPlaybookCatalog — singleton cache", () => {
  it("retorna mesma instância em chamadas subsequentes", () => {
    const c1 = getPlaybookCatalog();
    const c2 = getPlaybookCatalog();
    expect(c1).toBe(c2);
  });

  it("resetPlaybookCache força recarga", () => {
    const c1 = getPlaybookCatalog();
    resetPlaybookCache();
    const c2 = getPlaybookCatalog();
    expect(c1).not.toBe(c2);
    expect(c1.moves.length).toBe(c2.moves.length);
  });
});

describe("query helpers", () => {
  it("getMoveById encontra move existente", () => {
    const m = getMoveById("propose_dilemma");
    expect(m?.phase).toBe("challenge_execute");
  });

  it("getMoveById retorna undefined pra ID inexistente", () => {
    expect(getMoveById("inexistente")).toBeUndefined();
  });

  it("getMovesByPhase('ice_breaker') retorna só moves dessa fase", () => {
    const moves = getMovesByPhase("ice_breaker");
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.phase === "ice_breaker")).toBe(true);
  });

  it("getMovesByPhase('follow_up') tem ≥1 move", () => {
    expect(getMovesByPhase("follow_up").length).toBeGreaterThan(0);
  });

  it("getMovesByTargetFramework('valores_classicos') retorna moves anchored", () => {
    const moves = getMovesByTargetFramework("valores_classicos");
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(
        (m.targets ?? []).some((t) => t.framework === "valores_classicos"),
      ).toBe(true);
    }
  });
});

describe("validatePlaybookCatalog — detecção de issues", () => {
  it("detecta IDs duplicados", () => {
    const bad: PlaybookCatalog = {
      version: 1,
      moves: [
        {
          id: "dup",
          phase: "ice_breaker",
          estimated_minutes: 5,
          framing_template: "x",
          success_signal: "y",
        },
        {
          id: "dup",
          phase: "follow_up",
          estimated_minutes: 3,
          framing_template: "a",
          success_signal: "b",
        },
      ],
    };
    const issues = validatePlaybookCatalog(bad);
    expect(issues.some((i) => i.code === "move_id_duplicate")).toBe(true);
  });

  it("detecta phase inválida", () => {
    const bad: PlaybookCatalog = {
      version: 1,
      moves: [
        {
          id: "x",
          // @ts-expect-error testing invalid phase
          phase: "nonsense",
          estimated_minutes: 5,
          framing_template: "x",
          success_signal: "y",
        },
      ],
    };
    const issues = validatePlaybookCatalog(bad);
    expect(issues.some((i) => i.code === "move_phase_invalid")).toBe(true);
  });

  it("warning quando phase sem moves (uncovered)", () => {
    const bad: PlaybookCatalog = {
      version: 1,
      moves: [
        {
          id: "only_ice",
          phase: "ice_breaker",
          estimated_minutes: 5,
          framing_template: "x",
          success_signal: "y",
        },
      ],
    };
    const issues = validatePlaybookCatalog(bad);
    const warnings = issues.filter((i) => i.code === "phase_uncovered");
    expect(warnings.length).toBe(3); // missing 3 phases
  });
});

describe("loadPlaybookMoves — strict mode + erros", () => {
  it("strict lança erro quando catálogo inválido", () => {
    const tmp = mkdtempSync(join(tmpdir(), "playbook-bad-"));
    const path = join(tmp, "bad.yaml");
    writeFileSync(
      path,
      yamlDump({
        version: 1,
        moves: [
          {
            id: "dup",
            phase: "ice_breaker",
            estimated_minutes: 5,
            framing_template: "x",
            success_signal: "y",
          },
          {
            id: "dup",
            phase: "follow_up",
            estimated_minutes: 3,
            framing_template: "a",
            success_signal: "b",
          },
        ],
      }),
    );
    expect(() => loadPlaybookMoves({ path })).toThrow(/erro\(s\)/);
  });

  it("strict=false retorna catálogo + issues mesmo com erros", () => {
    const tmp = mkdtempSync(join(tmpdir(), "playbook-bad-"));
    const path = join(tmp, "bad.yaml");
    writeFileSync(
      path,
      yamlDump({
        version: 1,
        moves: [
          {
            id: "dup",
            phase: "ice_breaker",
            estimated_minutes: 5,
            framing_template: "x",
            success_signal: "y",
          },
          {
            id: "dup",
            phase: "follow_up",
            estimated_minutes: 3,
            framing_template: "a",
            success_signal: "b",
          },
        ],
      }),
    );
    const r = loadPlaybookMoves({ path, strict: false });
    expect(r.catalog.moves.length).toBe(2);
    expect(r.issues.some((i) => i.level === "error")).toBe(true);
  });
});
