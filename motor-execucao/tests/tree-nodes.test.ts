import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  TREE_NODES_DDL,
  upsertNode,
  getNodes,
  getStatusMatrix,
  applyStatusTransition,
} from "../src/tree-nodes.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(TREE_NODES_DDL);
});

afterEach(() => {
  db.close();
});

describe("tree_nodes CRUD", () => {
  it("upsert inserts a new node", () => {
    const node = upsertNode(db, {
      sessionId: "s1",
      zone: "status",
      key: "emotional",
      value: "baia",
    });
    expect(node.sessionId).toBe("s1");
    expect(node.zone).toBe("status");
    expect(node.key).toBe("emotional");
    expect(node.value).toBe("baia");
    expect(node.state).toBe("seed");
  });

  it("upsert is idempotent on UNIQUE(session_id, zone, key)", () => {
    upsertNode(db, { sessionId: "s1", zone: "status", key: "emotional", value: "baia" });
    upsertNode(db, { sessionId: "s1", zone: "status", key: "emotional", value: "pasto", state: "done" });
    const nodes = getNodes(db, "s1", { zone: "status" });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.value).toBe("pasto");
    expect(nodes[0]!.state).toBe("done");
  });

  it("different (zone, key) create distinct rows", () => {
    upsertNode(db, { sessionId: "s1", zone: "status", key: "emotional", value: "baia" });
    upsertNode(db, { sessionId: "s1", zone: "status", key: "cognitive_math", value: "baia" });
    expect(getNodes(db, "s1", { zone: "status" })).toHaveLength(2);
  });

  it("different sessions are isolated", () => {
    upsertNode(db, { sessionId: "s1", zone: "status", key: "emotional", value: "brejo" });
    upsertNode(db, { sessionId: "s2", zone: "status", key: "emotional", value: "pasto" });
    expect(getStatusMatrix(db, "s1")["emotional"]).toBe("brejo");
    expect(getStatusMatrix(db, "s2")["emotional"]).toBe("pasto");
  });
});

describe("getStatusMatrix — hydration", () => {
  it("returns default baia for dimensions not persisted", () => {
    const matrix = getStatusMatrix(db, "new_session");
    expect(matrix["emotional"]).toBe("baia");
    expect(matrix["social_with_ebrota"]).toBe("baia");
  });

  it("overrides default with persisted values", () => {
    upsertNode(db, { sessionId: "s1", zone: "status", key: "emotional", value: "pasto" });
    const matrix = getStatusMatrix(db, "s1");
    expect(matrix["emotional"]).toBe("pasto");
    // other canonical dims still baia
    expect(matrix["social_with_ebrota"]).toBe("baia");
  });

  it("ignores nodes with non-StatusValue payload (defensive)", () => {
    upsertNode(db, { sessionId: "s1", zone: "status", key: "weird", value: "lake" });
    const matrix = getStatusMatrix(db, "s1");
    expect(matrix["weird"]).toBeUndefined();
  });
});

describe("applyStatusTransition — enforces invariant brejo→baia→pasto", () => {
  it("first write accepts any value", () => {
    const r = applyStatusTransition(db, "s1", "emotional", "brejo");
    expect(r.applied).toBe("brejo");
    expect(r.accepted).toBe(true);
    expect(getStatusMatrix(db, "s1")["emotional"]).toBe("brejo");
  });

  it("brejo → pasto is rejected, forced to baia and persisted as baia", () => {
    applyStatusTransition(db, "s1", "emotional", "brejo");
    const r = applyStatusTransition(db, "s1", "emotional", "pasto");
    expect(r.accepted).toBe(false);
    expect(r.applied).toBe("baia");
    expect(getStatusMatrix(db, "s1")["emotional"]).toBe("baia");
  });

  it("pasto → brejo is rejected, forced to baia", () => {
    applyStatusTransition(db, "s1", "cognitive_math", "pasto");
    const r = applyStatusTransition(db, "s1", "cognitive_math", "brejo");
    expect(r.accepted).toBe(false);
    expect(r.applied).toBe("baia");
  });

  it("brejo → baia → pasto is accepted in 2 steps", () => {
    applyStatusTransition(db, "s1", "emotional", "brejo");
    const r1 = applyStatusTransition(db, "s1", "emotional", "baia");
    expect(r1.accepted).toBe(true);
    const r2 = applyStatusTransition(db, "s1", "emotional", "pasto");
    expect(r2.accepted).toBe(true);
    expect(getStatusMatrix(db, "s1")["emotional"]).toBe("pasto");
  });

  it("no-op when target === current", () => {
    applyStatusTransition(db, "s1", "emotional", "baia");
    const r = applyStatusTransition(db, "s1", "emotional", "baia");
    expect(r.accepted).toBe(true);
    expect(r.reason).toBe("no_op");
  });
});
