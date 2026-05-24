import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { initDb } from "../src/db.js";
import {
  listRecentJunDecisions,
  recordJunDecision,
} from "../src/decisions.js";

let db: DatabaseType;

beforeEach(() => {
  db = initDb({ dbPath: ":memory:" });
});

afterEach(() => {
  db.close();
});

describe("recordJunDecision", () => {
  it("insere row + retorna id", () => {
    const res = recordJunDecision(db, {
      sessionId: "s1",
      turn: 0,
      decision: "approve",
      originalText: "x",
      finalText: "x",
    });
    expect("id" in res).toBe(true);
    if ("id" in res) expect(res.id).toBe(1);
  });

  it("decision constraint rejeita valor inválido", () => {
    const res = recordJunDecision(db, {
      sessionId: "s1",
      turn: 0,
      decision: "invalid" as never,
    });
    expect("error" in res).toBe(true);
  });

  it("now() injetável pra timestamp determinístico", () => {
    recordJunDecision(
      db,
      {
        sessionId: "s1",
        turn: 0,
        decision: "approve",
      },
      () => "2026-05-24T13:00:00.000Z",
    );
    const recent = listRecentJunDecisions(db, "s1");
    expect(recent[0]!.recordedAt).toBe("2026-05-24T13:00:00.000Z");
  });
});

describe("listRecentJunDecisions", () => {
  it("retorna decisions em ordem DESC recordedAt", () => {
    let i = 0;
    const now = () =>
      `2026-05-24T13:00:${String(i++).padStart(2, "0")}.000Z`;
    recordJunDecision(db, { sessionId: "s1", turn: 0, decision: "approve" }, now);
    recordJunDecision(db, { sessionId: "s1", turn: 1, decision: "edit" }, now);
    recordJunDecision(db, { sessionId: "s1", turn: 2, decision: "reject" }, now);
    const list = listRecentJunDecisions(db, "s1");
    expect(list.map((d) => d.decision)).toEqual(["reject", "edit", "approve"]);
  });

  it("per-session isolation", () => {
    recordJunDecision(db, { sessionId: "s1", turn: 0, decision: "approve" });
    recordJunDecision(db, { sessionId: "s2", turn: 0, decision: "reject" });
    expect(listRecentJunDecisions(db, "s1")).toHaveLength(1);
    expect(listRecentJunDecisions(db, "s2")).toHaveLength(1);
    expect(listRecentJunDecisions(db, "s3")).toHaveLength(0);
  });

  it("limit respeitado", () => {
    for (let i = 0; i < 5; i++) {
      recordJunDecision(db, { sessionId: "s1", turn: i, decision: "approve" });
    }
    expect(listRecentJunDecisions(db, "s1", 3)).toHaveLength(3);
  });
});
