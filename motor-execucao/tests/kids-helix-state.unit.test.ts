/**
 * Unit tests pra kids_helix_state SQLite repo (G-05, ops#1091).
 *
 * Cobre: DDL, getKidsHelixState, updateKidsHelixState, bootstrapKidsHelixStateRow.
 * Round-trip serialization (CSVs, previous_pair null handling, vacation_trigger).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  KIDS_HELIX_STATE_DDL,
  bootstrapKidsHelixStateRow,
  getKidsHelixState,
  updateKidsHelixState,
} from "../src/kids-helix-state.js";
import { defaultKidsHelixState } from "@ascendimacy/shared";

const NOW = "2026-05-16T12:00:00.000Z";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(KIDS_HELIX_STATE_DDL);
});

afterEach(() => {
  db.close();
});

describe("kids_helix_state DDL", () => {
  it("getKidsHelixState retorna null pra persona ausente", () => {
    expect(getKidsHelixState(db, "ghost")).toBeNull();
  });

  it("bootstrap cria row + retorna state default", () => {
    const state = bootstrapKidsHelixStateRow(db, {
      personaId: "ryo",
      nowIso: NOW,
    });
    expect(state.persona_id).toBe("ryo");
    expect(state.active_pair).toEqual(["SA", "SOC"]);
    expect(state.queue).toEqual(["SM", "REL", "DM"]);
    expect(state.mode).toBe("active");
    expect(state.cycles_completed).toBe(0);
    expect(state.previous_pair).toBeNull();
  });

  it("bootstrap é idempotente (não sobrescreve existing)", () => {
    const first = bootstrapKidsHelixStateRow(db, {
      personaId: "ryo",
      nowIso: NOW,
    });
    // Modify and persist
    const modified = updateKidsHelixState(
      db,
      { ...first, cycles_completed: 5, current_day: 7 },
      "2026-05-17T00:00:00.000Z",
    );
    expect(modified.cycles_completed).toBe(5);

    // Bootstrap again — should return existing, NOT reset.
    const second = bootstrapKidsHelixStateRow(db, {
      personaId: "ryo",
      nowIso: "2026-05-18T00:00:00.000Z",
    });
    expect(second.cycles_completed).toBe(5);
    expect(second.current_day).toBe(7);
  });

  it("update + get round-trip preserva todos campos", () => {
    const fresh = defaultKidsHelixState({
      personaId: "kei",
      nowIso: NOW,
      firstPair: ["REL", "DM"],
    });
    const persisted = updateKidsHelixState(
      db,
      {
        ...fresh,
        previous_pair: ["SA", "SOC"],
        cycles_completed: 3,
        current_day: 8,
        mode: "buffer",
        completed: ["SA", "SOC"],
        deferred: ["SM"],
        vacation_trigger: "parental_request",
        vacation_started_at: "2026-05-10T00:00:00.000Z",
      },
      NOW,
    );
    const loaded = getKidsHelixState(db, "kei");
    expect(loaded).not.toBeNull();
    expect(loaded!.active_pair).toEqual(["REL", "DM"]);
    expect(loaded!.previous_pair).toEqual(["SA", "SOC"]);
    expect(loaded!.cycles_completed).toBe(3);
    expect(loaded!.current_day).toBe(8);
    expect(loaded!.mode).toBe("buffer");
    expect(loaded!.completed).toEqual(["SA", "SOC"]);
    expect(loaded!.deferred).toEqual(["SM"]);
    expect(loaded!.vacation_trigger).toBe("parental_request");
    expect(loaded!.vacation_started_at).toBe("2026-05-10T00:00:00.000Z");
    void persisted;
  });

  it("CSV vazio (queue/completed/deferred) round-trips como array vazio", () => {
    bootstrapKidsHelixStateRow(db, {
      personaId: "p1",
      firstPair: ["SA", "SM"],
      nowIso: NOW,
    });
    const state = getKidsHelixState(db, "p1");
    expect(state).not.toBeNull();
    // Bootstrap deixa queue=[SOC, REL, DM], completed=[], deferred=[]
    expect(state!.completed).toEqual([]);
    expect(state!.deferred).toEqual([]);
  });

  it("previous_pair null round-trips (sem coluna NULL leak)", () => {
    bootstrapKidsHelixStateRow(db, {
      personaId: "p1",
      nowIso: NOW,
    });
    const state = getKidsHelixState(db, "p1");
    expect(state!.previous_pair).toBeNull();
  });

  it("update sobrescreve previous_pair de não-null pra null", () => {
    const base = bootstrapKidsHelixStateRow(db, {
      personaId: "p1",
      nowIso: NOW,
    });
    updateKidsHelixState(db, { ...base, previous_pair: ["SA", "SOC"] }, NOW);
    expect(getKidsHelixState(db, "p1")!.previous_pair).toEqual(["SA", "SOC"]);
    updateKidsHelixState(db, { ...base, previous_pair: null }, NOW);
    expect(getKidsHelixState(db, "p1")!.previous_pair).toBeNull();
  });

  it("update preserva persona_id (no spillover entre personas)", () => {
    bootstrapKidsHelixStateRow(db, { personaId: "ryo", nowIso: NOW });
    bootstrapKidsHelixStateRow(db, { personaId: "kei", nowIso: NOW });
    expect(getKidsHelixState(db, "ryo")!.persona_id).toBe("ryo");
    expect(getKidsHelixState(db, "kei")!.persona_id).toBe("kei");
  });
});
