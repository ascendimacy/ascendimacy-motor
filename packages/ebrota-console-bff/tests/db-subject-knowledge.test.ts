/**
 * Tests do schema Subject Knowledge no BFF SQLite (spec 2026-05-25 Fase 1).
 * Valida que as 3 tabelas novas criam, indexam, e aceitam payload válido.
 *
 * Writers e endpoints entregues em Fases 2/3/5/6 — aqui é só schema.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb } from "../src/db.js";
import type { Database as DatabaseType } from "better-sqlite3";

let db: DatabaseType;

beforeEach(() => {
  db = initDb({ dbPath: ":memory:" });
});

afterEach(() => {
  db.close();
});

const tableExists = (name: string): boolean => {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { name: string } | undefined;
  return row !== undefined;
};

const indexExists = (name: string): boolean => {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
    .get(name) as { name: string } | undefined;
  return row !== undefined;
};

describe("subject_knowledge schema", () => {
  it("cria tabela com colunas e índices esperados", () => {
    expect(tableExists("subject_knowledge")).toBe(true);
    expect(indexExists("idx_sk_subject_type")).toBe(true);
    expect(indexExists("idx_sk_session")).toBe(true);
    expect(indexExists("idx_sk_created_at")).toBe(true);
  });

  it("aceita insert de interest discovery", () => {
    db.prepare(
      `INSERT INTO subject_knowledge (
        id, subject_id, type, source, confidence, alignment,
        payload_json, turn_ref, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sk-1",
      "ryo",
      "interest",
      "self_declared",
      0.95,
      "unknown",
      JSON.stringify({ kind: "interest", label: "Dragon Ball", intensity: "high" }),
      "sess1__turn0",
      "sess1",
    );
    const row = db
      .prepare("SELECT * FROM subject_knowledge WHERE id=?")
      .get("sk-1") as { type: string; payload_json: string };
    expect(row.type).toBe("interest");
    const payload = JSON.parse(row.payload_json);
    expect(payload.label).toBe("Dragon Ball");
  });

  it("aceita boundary_event com severity_band", () => {
    db.prepare(
      `INSERT INTO subject_knowledge (
        id, subject_id, type, source, confidence,
        payload_json, turn_ref, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sk-2",
      "ryo",
      "boundary_event",
      "motor_inferred",
      0.85,
      JSON.stringify({
        kind: "boundary_event",
        signal_type: "deflection_thematic",
        topic_category: "tema_escolar_recente",
        intensity: "mid",
        motor_response: "muda_tema",
        severity_band: "routine",
      }),
      "sess1__turn3",
      "sess1",
    );
    const row = db
      .prepare("SELECT payload_json FROM subject_knowledge WHERE id=?")
      .get("sk-2") as { payload_json: string };
    const p = JSON.parse(row.payload_json);
    expect(p.severity_band).toBe("routine");
    expect(p.topic_category).toBe("tema_escolar_recente");
  });

  it("rejeita type inválido", () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO subject_knowledge (
            id, subject_id, type, source, confidence,
            payload_json, turn_ref, session_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "sk-bad",
          "ryo",
          "fake_type",
          "self_declared",
          0.5,
          "{}",
          "t",
          "s",
        ),
    ).toThrow();
  });

  it("rejeita source inválido", () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO subject_knowledge (
            id, subject_id, type, source, confidence,
            payload_json, turn_ref, session_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "sk-bad",
          "ryo",
          "interest",
          "made_up",
          0.5,
          "{}",
          "t",
          "s",
        ),
    ).toThrow();
  });
});

describe("subject_proposed schema", () => {
  it("cria tabela", () => {
    expect(tableExists("subject_proposed")).toBe(true);
  });

  it("aceita upsert de proposed", () => {
    db.prepare(
      `INSERT INTO subject_proposed (
        subject_id, version, axes_active, complements_per_axis,
        reasoning_log, ratified_at, last_modified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "ryo",
      1,
      JSON.stringify([3, 4, 7]),
      JSON.stringify({ 3: ["andreia", "yuki"], 4: ["shoshin"], 7: ["hesed"] }),
      JSON.stringify({
        3: "autoconfiança pedida + complemento bushido por afinidade",
        4: "balanço autoconfiança via shoshin (zen)",
        7: "empatia pedida + hesed (hebraica)",
      }),
      null,
      new Date().toISOString(),
    );
    const row = db
      .prepare("SELECT * FROM subject_proposed WHERE subject_id=?")
      .get("ryo") as { version: number; axes_active: string };
    expect(row.version).toBe(1);
    expect(JSON.parse(row.axes_active)).toEqual([3, 4, 7]);
  });
});

describe("vertical_affinity_signals schema", () => {
  it("cria tabela com índices", () => {
    expect(tableExists("vertical_affinity_signals")).toBe(true);
    expect(indexExists("idx_vas_subject")).toBe(true);
    expect(indexExists("idx_vas_score")).toBe(true);
  });

  it("aceita inserts e ordena por score", () => {
    db.prepare(
      `INSERT INTO vertical_affinity_signals (
        id, subject_id, vertical_kind, vertical_id,
        score_affinity, evidence_count, last_seen_at, in_base
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("vas-1", "ryo", "lineage", "estoica", 0.7, 3, "2026-05-25", 0);
    db.prepare(
      `INSERT INTO vertical_affinity_signals (
        id, subject_id, vertical_kind, vertical_id,
        score_affinity, evidence_count, last_seen_at, in_base
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("vas-2", "ryo", "axis", "6", 0.5, 2, "2026-05-25", 0);

    const rows = db
      .prepare(
        "SELECT vertical_id FROM vertical_affinity_signals WHERE subject_id=? ORDER BY score_affinity DESC",
      )
      .all("ryo") as Array<{ vertical_id: string }>;
    expect(rows.map((r) => r.vertical_id)).toEqual(["estoica", "6"]);
  });

  it("rejeita vertical_kind inválido", () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO vertical_affinity_signals (
            id, subject_id, vertical_kind, vertical_id,
            score_affinity, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("vas-x", "ryo", "wrong", "abc", 0.5, "2026-05-25"),
    ).toThrow();
  });
});
