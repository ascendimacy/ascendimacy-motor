/**
 * Tests MapFramework registry — projeções multi-framework (sub-fase 8.3).
 */
import { describe, it, expect } from "vitest";
import {
  computeMapPositions,
  listFrameworks,
  getFramework,
  registerFramework,
  resetFrameworkRegistry,
  type SubjectKnowledgeEntry,
  type MapFramework,
} from "../src/index.js";

const NOW = "2026-05-25T18:00:00.000Z";

const makeEntry = (
  type: SubjectKnowledgeEntry["type"],
  payload: Record<string, unknown>,
): SubjectKnowledgeEntry => ({
  id: `id-${Math.random()}`,
  subject_id: "ryo",
  type,
  source: "self_declared",
  confidence: 0.9,
  confirmed_at: NOW,
  alignment: "unknown",
  payload: { kind: type, ...payload } as SubjectKnowledgeEntry["payload"],
  turn_ref: "s1__t1",
  session_id: "s1",
  created_at: NOW,
});

describe("MapFramework registry — default frameworks", () => {
  it("registra os 4 frameworks v1 por default", () => {
    const fws = listFrameworks();
    const ids = fws.map((fw) => fw.id);
    expect(ids).toContain("valores_classicos");
    expect(ids).toContain("gardner");
    expect(ids).toContain("casel");
    expect(ids).toContain("dreyfus_by_domain");
  });

  it("getFramework retorna instância por ID", () => {
    const fw = getFramework("valores_classicos");
    expect(fw?.display_name).toContain("Valores Clássicos");
    expect(fw?.dimensions.length).toBe(12);
  });

  it("getFramework retorna undefined pra ID inexistente", () => {
    expect(getFramework("inexistente")).toBeUndefined();
  });

  it("render_hint definido em todos defaults", () => {
    for (const fw of listFrameworks()) {
      expect(["radar", "bar", "tree", "list"]).toContain(fw.render_hint);
    }
  });
});

describe("valores_classicos — projeção", () => {
  it("soma pontos de presented_concept por axis_id", () => {
    const entries = [
      makeEntry("presented_concept", {
        concept_id: "x",
        keywords: ["x"],
        lineage_anchor: "estoica/x",
        axis_id: 3,
        family: "carater",
        points: 1,
      }),
      makeEntry("presented_concept", {
        concept_id: "y",
        keywords: ["y"],
        lineage_anchor: "zen/y",
        axis_id: 3,
        family: "carater",
        points: 1,
      }),
      makeEntry("presented_concept", {
        concept_id: "z",
        keywords: ["z"],
        lineage_anchor: "paideia/z",
        axis_id: 11,
        family: "cognicao_si",
        points: 1,
      }),
    ];
    const pos = computeMapPositions({
      subjectId: "ryo",
      entries,
      frameworkIds: ["valores_classicos"],
    });
    const valores = pos.positions["valores_classicos"];
    expect(valores["axis_3"]).toBe(2);
    expect(valores["axis_11"]).toBe(1);
    expect(valores["axis_1"]).toBe(0); // sem entries
  });

  it("não conta entries de outros types (interest, boundary)", () => {
    const entries = [
      makeEntry("interest", { label: "tênis" }),
      makeEntry("boundary_event", {
        signal_type: "deflection_thematic",
        topic_category: "x",
        intensity: "low",
        motor_response: "muda_tema",
        severity_band: "routine",
      }),
    ];
    const pos = computeMapPositions({
      subjectId: "ryo",
      entries,
      frameworkIds: ["valores_classicos"],
    });
    // Todos axes ficam zero
    for (let i = 1; i <= 12; i++) {
      expect(pos.positions["valores_classicos"][`axis_${i}`]).toBe(0);
    }
  });
});

describe("casel — projeção via axis→casel mapping", () => {
  it("axis 1 (Prudência) → DM", () => {
    const entries = [
      makeEntry("presented_concept", {
        concept_id: "x",
        keywords: ["x"],
        lineage_anchor: "estoica/x",
        axis_id: 1,
        family: "carater",
        points: 1,
      }),
    ];
    const pos = computeMapPositions({
      subjectId: "ryo",
      entries,
      frameworkIds: ["casel"],
    });
    expect(pos.positions["casel"]["DM"]).toBe(1);
    expect(pos.positions["casel"]["SA"]).toBe(0);
  });

  it("axis 11 (Autoconhecimento) → SA", () => {
    const entries = [
      makeEntry("presented_concept", {
        concept_id: "x",
        keywords: ["x"],
        lineage_anchor: "paideia/gnothi_seauton",
        axis_id: 11,
        family: "cognicao_si",
        points: 1,
      }),
    ];
    const pos = computeMapPositions({
      subjectId: "ryo",
      entries,
      frameworkIds: ["casel"],
    });
    expect(pos.positions["casel"]["SA"]).toBe(1);
  });

  it("axis 7 (Compaixão) → REL", () => {
    const entries = [
      makeEntry("presented_concept", {
        concept_id: "x",
        keywords: ["x"],
        lineage_anchor: "hebraica/hesed",
        axis_id: 7,
        family: "disposicao",
        points: 1,
      }),
    ];
    const pos = computeMapPositions({
      subjectId: "ryo",
      entries,
      frameworkIds: ["casel"],
    });
    expect(pos.positions["casel"]["REL"]).toBe(1);
  });
});

describe("gardner — projeção via interest matching", () => {
  it("interest com label 'linguistic' incrementa channel", () => {
    const entries = [
      makeEntry("interest", { label: "linguistic" }),
    ];
    const pos = computeMapPositions({
      subjectId: "ryo",
      entries,
      frameworkIds: ["gardner"],
    });
    expect(pos.positions["gardner"]["linguistic"]).toBe(1);
  });

  it("não conta interest sem match a channel", () => {
    const entries = [makeEntry("interest", { label: "futebol" })];
    const pos = computeMapPositions({
      subjectId: "ryo",
      entries,
      frameworkIds: ["gardner"],
    });
    const gardner = pos.positions["gardner"];
    for (const channelKey of Object.keys(gardner)) {
      expect(gardner[channelKey]).toBe(0);
    }
  });
});

describe("dreyfus_by_domain — projeção heurística", () => {
  it("mais menções → level upgrade", () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry("interest", { label: "matematica" }),
    );
    const pos = computeMapPositions({
      subjectId: "ryo",
      entries,
      frameworkIds: ["dreyfus_by_domain"],
    });
    const mat = pos.positions["dreyfus_by_domain"]["matematica"] as
      | { mentions: number; level: string }
      | undefined;
    expect(mat?.mentions).toBe(5);
    expect(mat?.level).toBe("practitioner"); // >=4
  });
});

describe("computeMapPositions — filtros e composição", () => {
  it("sem frameworkIds: roda todos os registrados", () => {
    const pos = computeMapPositions({
      subjectId: "ryo",
      entries: [],
    });
    expect(Object.keys(pos.positions).sort()).toEqual([
      "casel",
      "dreyfus_by_domain",
      "gardner",
      "valores_classicos",
    ]);
  });

  it("frameworkIds filtra subset", () => {
    const pos = computeMapPositions({
      subjectId: "ryo",
      entries: [],
      frameworkIds: ["gardner"],
    });
    expect(Object.keys(pos.positions)).toEqual(["gardner"]);
  });

  it("framework inexistente é ignorado silenciosamente", () => {
    const pos = computeMapPositions({
      subjectId: "ryo",
      entries: [],
      frameworkIds: ["inexistente", "casel"],
    });
    expect(Object.keys(pos.positions)).toEqual(["casel"]);
  });

  it("subject_id + computed_at preservados", () => {
    const pos = computeMapPositions({
      subjectId: "ryo",
      entries: [],
    });
    expect(pos.subject_id).toBe("ryo");
    expect(typeof pos.computed_at).toBe("string");
  });
});

describe("registerFramework — custom framework", () => {
  it("registra novo framework e retorna em listFrameworks", () => {
    const custom: MapFramework = {
      id: "test_custom",
      display_name: "Teste Custom",
      dimensions: ["d1", "d2"],
      render_hint: "list",
      project: () => new Map([["d1", 42]]),
    };
    registerFramework(custom);
    expect(getFramework("test_custom")).toBeDefined();
    resetFrameworkRegistry();
    expect(getFramework("test_custom")).toBeUndefined();
  });

  it("projeção custom é usada em computeMapPositions", () => {
    const custom: MapFramework = {
      id: "always_42",
      display_name: "Always 42",
      dimensions: ["x"],
      render_hint: "list",
      project: () => new Map([["x", 42]]),
    };
    registerFramework(custom);
    const pos = computeMapPositions({
      subjectId: "ryo",
      entries: [],
      frameworkIds: ["always_42"],
    });
    expect(pos.positions["always_42"]["x"]).toBe(42);
    resetFrameworkRegistry();
  });
});
