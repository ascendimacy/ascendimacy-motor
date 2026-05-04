import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  HELIX_STATE_DDL,
  loadHelixState,
  saveHelixState,
  sqliteHelixRepo,
} from "../src/helix-repo.js";
import { initHelix } from "@ascendimacy/shared";
import type { HelixState } from "@ascendimacy/shared";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(HELIX_STATE_DDL);
});

afterEach(() => {
  db.close();
});

describe("loadHelixState", () => {
  it("returns null when child has no state", () => {
    expect(loadHelixState(db, "ryo-001")).toBeNull();
  });

  it("returns persisted state after save", () => {
    const state = initHelix("ryo-001", "SA");
    saveHelixState(db, state);
    const loaded = loadHelixState(db, "ryo-001");
    expect(loaded).not.toBeNull();
    expect(loaded?.userId).toBe("ryo-001");
    expect(loaded?.activeDimension).toBe("SA");
    expect(loaded?.activeLevel).toBe("emerging");
    expect(loaded?.progress).toBe(0);
    expect(loaded?.cycleDay).toBe(1);
    expect(loaded?.queue).toEqual(["SOC", "SM", "REL", "DM"]);
    expect(loaded?.completed).toEqual([]);
    expect(loaded?.deferred).toEqual([]);
    expect(loaded?.previousDimension).toBeNull();
    expect(loaded?.retrievalDone).toBe(false);
    expect(loaded?.vacationModeActive).toBe(false);
  });
});

describe("saveHelixState upsert", () => {
  it("updates existing row instead of inserting duplicate", () => {
    const state = initHelix("ryo-001", "SA");
    saveHelixState(db, state);
    saveHelixState(db, { ...state, progress: 0.6, retrievalDone: true });
    const loaded = loadHelixState(db, "ryo-001");
    expect(loaded?.progress).toBe(0.6);
    expect(loaded?.retrievalDone).toBe(true);
    const count = db.prepare("SELECT COUNT(*) AS n FROM kids_helix_state").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("isolates state by child_id", () => {
    saveHelixState(db, initHelix("ryo-001", "SA"));
    saveHelixState(db, initHelix("kei-001", "SOC"));
    expect(loadHelixState(db, "ryo-001")?.activeDimension).toBe("SA");
    expect(loadHelixState(db, "kei-001")?.activeDimension).toBe("SOC");
  });

  it("roundtrips deferred and completed arrays", () => {
    const base = initHelix("ryo-001", "SA");
    const enriched: HelixState = {
      ...base,
      completed: ["SA", "SOC"],
      deferred: [{ dimension: "DM", reason: "pair_did_not_activate", retryAfter: "2026-06-01" }],
      previousDimension: "SOC",
      retrievalDone: true,
    };
    saveHelixState(db, enriched);
    const loaded = loadHelixState(db, "ryo-001");
    expect(loaded?.completed).toEqual(["SA", "SOC"]);
    expect(loaded?.deferred).toEqual([{ dimension: "DM", reason: "pair_did_not_activate", retryAfter: "2026-06-01" }]);
    expect(loaded?.previousDimension).toBe("SOC");
  });
});

describe("sqliteHelixRepo adapter", () => {
  it("implements HelixRepo interface (load/save async)", async () => {
    const repo = sqliteHelixRepo(db);
    expect(await repo.load("ryo-001")).toBeNull();
    await repo.save(initHelix("ryo-001", "SA"));
    const loaded = await repo.load("ryo-001");
    expect(loaded?.activeDimension).toBe("SA");
  });
});
