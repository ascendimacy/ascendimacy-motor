import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb } from "../src/db.js";
import { createBffServer, type BffServer } from "../src/server.js";
import {
  createMockDaemonClient,
  type MockDaemonClient,
} from "../src/daemon-client.js";
import type { Database as DatabaseType } from "better-sqlite3";

let db: DatabaseType;
let daemon: MockDaemonClient;
let server: BffServer;

beforeEach(() => {
  db = initDb({ dbPath: ":memory:" });
  daemon = createMockDaemonClient();
  server = createBffServer({ daemon, db, logger: false });
});
afterEach(async () => {
  await server.close();
});

function seedPresentedConcept(subjectId: string, axis: number, i: number) {
  db.prepare(
    `INSERT INTO subject_knowledge (
      id, subject_id, type, source, confidence, confirmed_at,
      alignment, payload_json, turn_ref, session_id, created_at
    ) VALUES (?, ?, 'presented_concept', 'motor_inferred', 1.0, ?, 'unknown', ?, ?, ?, ?)`,
  ).run(
    `pc-${i}`,
    subjectId,
    `s1__t${i}`,
    JSON.stringify({
      kind: "presented_concept",
      concept_id: `c-${i}`,
      keywords: ["x"],
      lineage_anchor: "estoica/x",
      axis_id: axis,
      family: axis <= 4 ? "carater" : axis <= 8 ? "disposicao" : "cognicao_si",
      points: 1,
    }),
    `s1__t${i}`,
    "s1",
    new Date(2026, 4, 25, 10, i).toISOString(),
  );
}

const inject = async (url: string) => {
  const res = await server.fastify.inject({ method: "GET", url });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

describe("GET /frameworks", () => {
  it("retorna lista dos 4 frameworks v1", async () => {
    const r = await inject("/frameworks");
    expect(r.status).toBe(200);
    const ids = r.body.frameworks.map((fw: { id: string }) => fw.id);
    expect(ids).toContain("valores_classicos");
    expect(ids).toContain("gardner");
    expect(ids).toContain("casel");
    expect(ids).toContain("dreyfus_by_domain");
  });

  it("cada framework tem display_name + dimensions + render_hint", async () => {
    const r = await inject("/frameworks");
    for (const fw of r.body.frameworks) {
      expect(typeof fw.display_name).toBe("string");
      expect(Array.isArray(fw.dimensions)).toBe(true);
      expect(["radar", "bar", "tree", "list"]).toContain(fw.render_hint);
    }
  });
});

describe("GET /subjects/:id/maps", () => {
  it("retorna projeções em todos os frameworks por default", async () => {
    seedPresentedConcept("ryo", 3, 1);
    seedPresentedConcept("ryo", 3, 2);
    seedPresentedConcept("ryo", 11, 3);
    const r = await inject("/subjects/ryo/maps");
    expect(r.status).toBe(200);
    const positions = r.body.maps.positions;
    expect(Object.keys(positions).sort()).toEqual([
      "casel",
      "dreyfus_by_domain",
      "gardner",
      "valores_classicos",
    ]);
    expect(positions.valores_classicos.axis_3).toBe(2);
    expect(positions.valores_classicos.axis_11).toBe(1);
  });

  it("filter ?framework=X retorna só esse framework", async () => {
    seedPresentedConcept("ryo", 3, 1);
    const r = await inject("/subjects/ryo/maps?framework=valores_classicos");
    expect(Object.keys(r.body.maps.positions)).toEqual(["valores_classicos"]);
  });

  it("filter ?framework=X,Y retorna só esses", async () => {
    const r = await inject("/subjects/ryo/maps?framework=casel,gardner");
    const keys = Object.keys(r.body.maps.positions).sort();
    expect(keys).toEqual(["casel", "gardner"]);
  });

  it("sujeito sem entries retorna positions zeradas", async () => {
    const r = await inject("/subjects/none/maps?framework=valores_classicos");
    expect(r.status).toBe(200);
    for (let i = 1; i <= 12; i++) {
      expect(r.body.maps.positions.valores_classicos[`axis_${i}`]).toBe(0);
    }
  });

  it("casel projection usa axis→casel mapping", async () => {
    seedPresentedConcept("ryo", 1, 1); // axis 1 → DM
    seedPresentedConcept("ryo", 7, 2); // axis 7 → REL
    const r = await inject("/subjects/ryo/maps?framework=casel");
    expect(r.body.maps.positions.casel.DM).toBe(1);
    expect(r.body.maps.positions.casel.REL).toBe(1);
    expect(r.body.maps.positions.casel.SA).toBe(0);
  });
});
