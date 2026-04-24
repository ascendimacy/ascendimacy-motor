import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  PARENT_DECISIONS_DDL,
  setParentDecision,
  listParentDecisions,
  getDecisionMap,
  getPinnedIds,
  getRejectedIds,
} from "../src/parent-decisions.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(PARENT_DECISIONS_DDL);
});

afterEach(() => {
  db.close();
});

describe("parent-decisions CRUD", () => {
  it("setParentDecision inserts new row", () => {
    const d = setParentDecision(db, {
      session_id: "s1",
      content_id: "h1",
      status: "approved",
    });
    expect(d.status).toBe("approved");
    expect(d.session_id).toBe("s1");
    expect(d.content_id).toBe("h1");
  });

  it("setParentDecision is idempotent on UNIQUE(session, content)", () => {
    setParentDecision(db, { session_id: "s1", content_id: "h1", status: "approved" });
    setParentDecision(db, { session_id: "s1", content_id: "h1", status: "rejected", reason: "mudei de ideia" });
    const list = listParentDecisions(db, "s1");
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe("rejected");
    expect(list[0]!.reason).toBe("mudei de ideia");
  });

  it("different sessions are isolated", () => {
    setParentDecision(db, { session_id: "s1", content_id: "h1", status: "pinned" });
    setParentDecision(db, { session_id: "s2", content_id: "h1", status: "rejected" });
    expect(listParentDecisions(db, "s1")[0]!.status).toBe("pinned");
    expect(listParentDecisions(db, "s2")[0]!.status).toBe("rejected");
  });

  it("getDecisionMap indexes by content_id", () => {
    setParentDecision(db, { session_id: "s1", content_id: "h1", status: "pinned" });
    setParentDecision(db, { session_id: "s1", content_id: "h2", status: "rejected" });
    const map = getDecisionMap(db, "s1");
    expect(map.get("h1")?.status).toBe("pinned");
    expect(map.get("h2")?.status).toBe("rejected");
  });
});

describe("parent-decisions expiry", () => {
  it("getPinnedIds filters expired", () => {
    setParentDecision(db, {
      session_id: "s1",
      content_id: "h1",
      status: "pinned",
      expires_at: "2020-01-01T00:00:00Z",
    });
    setParentDecision(db, {
      session_id: "s1",
      content_id: "h2",
      status: "pinned",
      expires_at: "2099-01-01T00:00:00Z",
    });
    const pinned = getPinnedIds(db, "s1", "2026-04-24T00:00:00Z");
    expect(pinned.has("h1")).toBe(false);
    expect(pinned.has("h2")).toBe(true);
  });

  it("getRejectedIds filters expired", () => {
    setParentDecision(db, {
      session_id: "s1",
      content_id: "h1",
      status: "rejected",
      expires_at: "2020-01-01T00:00:00Z",
    });
    setParentDecision(db, {
      session_id: "s1",
      content_id: "h2",
      status: "rejected",
    });
    const rejected = getRejectedIds(db, "s1", "2026-04-24T00:00:00Z");
    expect(rejected.has("h1")).toBe(false);
    expect(rejected.has("h2")).toBe(true);
  });

  it("null expires_at nunca expira", () => {
    setParentDecision(db, { session_id: "s1", content_id: "h1", status: "pinned" });
    const pinned = getPinnedIds(db, "s1");
    expect(pinned.has("h1")).toBe(true);
  });
});
