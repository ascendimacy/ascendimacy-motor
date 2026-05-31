import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadDilemmaCatalog,
  findArchetypesByVirtue,
  findArchetypesByTrigger,
} from "../src/dilemma-archetype-loader.js";

describe("loadDilemmaCatalog — produção (data/dilemma-archetypes.yaml)", () => {
  it("carrega catálogo default sem erros", () => {
    const { catalog, issues } = loadDilemmaCatalog();
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toEqual([]);
    expect(catalog.version).toBeGreaterThanOrEqual(1);
  });

  it("catálogo tem os 8 archetypes esperados (spec §5.4)", () => {
    const { catalog } = loadDilemmaCatalog();
    const ids = catalog.archetypes.map((a) => a.id).sort();
    expect(ids).toEqual([
      "cheap_vs_quality",
      "early_quit",
      "give_credit",
      "judge_yourself",
      "prioritize_who",
      "share_vs_keep",
      "silent_error",
      "temptation_to_skip",
    ]);
  });

  it("todos archetypes têm prompt_template não-vazio", () => {
    const { catalog } = loadDilemmaCatalog();
    for (const a of catalog.archetypes) {
      expect(a.prompt_template.length).toBeGreaterThan(20);
    }
  });

  it("todos archetypes têm pelo menos 1 applicable_trigger", () => {
    const { catalog } = loadDilemmaCatalog();
    for (const a of catalog.archetypes) {
      expect(a.applicable_triggers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("evaluation_focus é sempre um dos 3 valores válidos", () => {
    const { catalog } = loadDilemmaCatalog();
    const valid = new Set([
      "raciocinio",
      "consistencia_com_valor_declarado",
      "consideracao_do_outro",
    ]);
    for (const a of catalog.archetypes) {
      expect(valid.has(a.evaluation_focus)).toBe(true);
    }
  });

  it("strict mode passa sem throw", () => {
    expect(() => loadDilemmaCatalog({ strict: true })).not.toThrow();
  });
});

describe("findArchetypesByVirtue", () => {
  it("retorna archetypes correspondentes", () => {
    const { catalog } = loadDilemmaCatalog();
    const honesty = findArchetypesByVirtue(catalog, "honestidade");
    expect(honesty.length).toBeGreaterThan(0);
    for (const a of honesty) {
      expect(a.virtue_tested).toBe("honestidade");
    }
  });

  it("retorna [] quando virtude desconhecida", () => {
    const { catalog } = loadDilemmaCatalog();
    expect(findArchetypesByVirtue(catalog, "fake-virtue")).toEqual([]);
  });
});

describe("findArchetypesByTrigger", () => {
  it("retorna archetypes que aplicam em step_complete", () => {
    const { catalog } = loadDilemmaCatalog();
    const stepComplete = findArchetypesByTrigger(catalog, "step_complete");
    expect(stepComplete.length).toBeGreaterThan(0);
    for (const a of stepComplete) {
      expect(a.applicable_triggers).toContain("step_complete");
    }
  });

  it("retorna archetypes que aplicam em step_midway", () => {
    const { catalog } = loadDilemmaCatalog();
    const midway = findArchetypesByTrigger(catalog, "step_midway");
    expect(midway.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Loader edge cases — usa arquivos temporários
// ─────────────────────────────────────────────────────────────────────────

describe("loadDilemmaCatalog — validation edge cases", () => {
  function withTempCatalog<T>(content: string, fn: (path: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), "dilemma-catalog-"));
    const path = join(dir, "test.yaml");
    writeFileSync(path, content, "utf8");
    try {
      return fn(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("YAML root inválido → throw", () => {
    withTempCatalog("just a string", (path) => {
      expect(() => loadDilemmaCatalog({ path })).toThrow(/root inválido/);
    });
  });

  it("falta campo 'archetypes' → throw", () => {
    withTempCatalog("version: 1\n", (path) => {
      expect(() => loadDilemmaCatalog({ path })).toThrow(/'archetypes' obrigatório/);
    });
  });

  it("archetype sem id → issue error, archetype dropado", () => {
    const yaml = `version: 1
archetypes:
  - virtue_tested: x
    evaluation_focus: raciocinio
    applicable_triggers: [step_complete]
    prompt_template: "test prompt longo o bastante pra passar"
    description: "test"
`;
    withTempCatalog(yaml, (path) => {
      const { catalog, issues } = loadDilemmaCatalog({ path });
      expect(catalog.archetypes).toHaveLength(0);
      expect(issues.some((i) => i.level === "error" && /sem 'id'/.test(i.message))).toBe(true);
    });
  });

  it("evaluation_focus inválido → error", () => {
    const yaml = `version: 1
archetypes:
  - id: bad_focus
    virtue_tested: x
    evaluation_focus: fake-focus
    applicable_triggers: [step_complete]
    prompt_template: "test prompt longo o bastante pra passar"
    description: "test"
`;
    withTempCatalog(yaml, (path) => {
      const { catalog, issues } = loadDilemmaCatalog({ path });
      expect(catalog.archetypes).toHaveLength(0);
      expect(
        issues.some((i) => i.level === "error" && /'evaluation_focus' inválido/.test(i.message)),
      ).toBe(true);
    });
  });

  it("trigger inválido → error", () => {
    const yaml = `version: 1
archetypes:
  - id: bad_trigger
    virtue_tested: x
    evaluation_focus: raciocinio
    applicable_triggers: [fake_trigger]
    prompt_template: "test prompt longo o bastante pra passar"
    description: "test"
`;
    withTempCatalog(yaml, (path) => {
      const { catalog, issues } = loadDilemmaCatalog({ path });
      expect(catalog.archetypes).toHaveLength(0);
      expect(
        issues.some((i) => i.level === "error" && /trigger inválido/.test(i.message)),
      ).toBe(true);
    });
  });

  it("id duplicado → error, segundo dropado", () => {
    const yaml = `version: 1
archetypes:
  - id: dup
    virtue_tested: x
    evaluation_focus: raciocinio
    applicable_triggers: [step_complete]
    prompt_template: "test prompt longo o bastante pra passar"
    description: "test"
  - id: dup
    virtue_tested: y
    evaluation_focus: raciocinio
    applicable_triggers: [step_complete]
    prompt_template: "outro prompt longo o bastante pra passar"
    description: "test"
`;
    withTempCatalog(yaml, (path) => {
      const { catalog, issues } = loadDilemmaCatalog({ path });
      expect(catalog.archetypes).toHaveLength(1);
      expect(
        issues.some((i) => i.level === "error" && /duplicado/.test(i.message)),
      ).toBe(true);
    });
  });

  it("description ausente → warning, archetype mantido", () => {
    const yaml = `version: 1
archetypes:
  - id: no_desc
    virtue_tested: x
    evaluation_focus: raciocinio
    applicable_triggers: [step_complete]
    prompt_template: "test prompt longo o bastante pra passar"
`;
    withTempCatalog(yaml, (path) => {
      const { catalog, issues } = loadDilemmaCatalog({ path });
      expect(catalog.archetypes).toHaveLength(1);
      expect(
        issues.some((i) => i.level === "warning" && /sem 'description'/.test(i.message)),
      ).toBe(true);
    });
  });

  it("strict mode com errors → throw", () => {
    const yaml = `version: 1
archetypes:
  - virtue_tested: x
    evaluation_focus: raciocinio
    applicable_triggers: [step_complete]
    prompt_template: "test prompt longo o bastante pra passar"
`;
    withTempCatalog(yaml, (path) => {
      expect(() => loadDilemmaCatalog({ path, strict: true })).toThrow(/erros no catálogo/);
    });
  });
});
