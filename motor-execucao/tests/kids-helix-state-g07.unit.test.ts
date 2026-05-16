/**
 * Unit tests pra G-07 (ops#1020) — persistência triggers_fired_csv +
 * idempotência da self-healing migration ALTER TABLE.
 *
 * Cobre:
 *  - DDL inclui triggers_fired_csv NOT NULL DEFAULT ''.
 *  - Round-trip: state com triggers fired → load preserva array exato.
 *  - Empty array round-trips como "" → [].
 *  - Multi-trigger CSV preserva ordem.
 *  - Self-healing migration: DB com schema antigo recebe ALTER TABLE
 *    idempotente (sem erro em segunda invocação).
 *  - Bootstrap fresh → triggers_fired_this_cycle = [].
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  KIDS_HELIX_STATE_DDL,
  _resetG07MigrationFlagForTests,
  bootstrapKidsHelixStateRow,
  getKidsHelixState,
  updateKidsHelixState,
} from "../src/kids-helix-state.js";
import {
  defaultKidsHelixState,
  KIDS_HELIX_CADENCE_TRIGGERS,
} from "@ascendimacy/shared";

const NOW = "2026-05-16T12:00:00.000Z";

let db: Database.Database;

beforeEach(() => {
  _resetG07MigrationFlagForTests();
  db = new Database(":memory:");
  db.exec(KIDS_HELIX_STATE_DDL);
});

afterEach(() => {
  db.close();
});

describe("G-07 triggers_fired_csv persistence (ops#1020)", () => {
  it("bootstrap fresh tem triggers_fired_this_cycle = []", () => {
    const state = bootstrapKidsHelixStateRow(db, {
      personaId: "ryo",
      nowIso: NOW,
    });
    expect(state.triggers_fired_this_cycle).toEqual([]);
  });

  it("update + get round-trip preserva array vazio", () => {
    bootstrapKidsHelixStateRow(db, { personaId: "p1", nowIso: NOW });
    const loaded = getKidsHelixState(db, "p1");
    expect(loaded).not.toBeNull();
    expect(loaded!.triggers_fired_this_cycle).toEqual([]);
  });

  it("update com triggers fired persiste exato no get", () => {
    const fresh = defaultKidsHelixState({
      personaId: "kei",
      nowIso: NOW,
    });
    updateKidsHelixState(
      db,
      {
        ...fresh,
        triggers_fired_this_cycle: ["retrieval_50", "midcycle_assessment_7"],
        current_day: 7,
      },
      NOW,
    );
    const loaded = getKidsHelixState(db, "kei");
    expect(loaded).not.toBeNull();
    expect(loaded!.triggers_fired_this_cycle).toEqual([
      "retrieval_50",
      "midcycle_assessment_7",
    ]);
    expect(loaded!.current_day).toBe(7);
  });

  it("preserva ordem cronológica dos triggers", () => {
    const fresh = defaultKidsHelixState({
      personaId: "kei",
      nowIso: NOW,
    });
    updateKidsHelixState(
      db,
      {
        ...fresh,
        triggers_fired_this_cycle: [
          "midcycle_assessment_7",
          "retrieval_50",
          "boss_fight_100",
        ],
      },
      NOW,
    );
    const loaded = getKidsHelixState(db, "kei");
    expect(loaded!.triggers_fired_this_cycle).toEqual([
      "midcycle_assessment_7",
      "retrieval_50",
      "boss_fight_100",
    ]);
  });

  it("filtra triggers desconhecidos no parse (defensive)", () => {
    // Injeta CSV com lixo direto no SQL pra simular dado corrompido.
    db.prepare(
      `INSERT INTO kids_helix_state
        (persona_id, active_pair_0, active_pair_1, cycle_started_at,
         current_day, mode, cycles_completed, queue_csv, completed_csv,
         deferred_csv, triggers_fired_csv, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "corrupted",
      "SA",
      "SOC",
      NOW,
      7,
      "active",
      0,
      "",
      "",
      "",
      "retrieval_50,UNKNOWN_TRIGGER,boss_fight_100",
      NOW,
    );
    const loaded = getKidsHelixState(db, "corrupted");
    expect(loaded!.triggers_fired_this_cycle).toEqual([
      "retrieval_50",
      "boss_fight_100",
    ]);
  });

  it("triggers_fired_csv NULL no DB → array vazio no state (defensive)", () => {
    db.prepare(
      `INSERT INTO kids_helix_state
        (persona_id, active_pair_0, active_pair_1, cycle_started_at,
         current_day, mode, cycles_completed, queue_csv, completed_csv,
         deferred_csv, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("nulltrig", "SA", "SOC", NOW, 0, "active", 0, "", "", "", NOW);
    const loaded = getKidsHelixState(db, "nulltrig");
    expect(loaded!.triggers_fired_this_cycle).toEqual([]);
  });

  it("update sobrescreve triggers (não acumula)", () => {
    const base = bootstrapKidsHelixStateRow(db, {
      personaId: "p1",
      nowIso: NOW,
    });
    updateKidsHelixState(
      db,
      {
        ...base,
        triggers_fired_this_cycle: ["retrieval_50"],
      },
      NOW,
    );
    updateKidsHelixState(
      db,
      {
        ...base,
        triggers_fired_this_cycle: ["boss_fight_100"], // overrides
      },
      NOW,
    );
    const loaded = getKidsHelixState(db, "p1");
    expect(loaded!.triggers_fired_this_cycle).toEqual(["boss_fight_100"]);
  });

  it("all canonical triggers round-trip corretamente", () => {
    const fresh = defaultKidsHelixState({
      personaId: "all-trigs",
      nowIso: NOW,
    });
    updateKidsHelixState(
      db,
      {
        ...fresh,
        triggers_fired_this_cycle: [...KIDS_HELIX_CADENCE_TRIGGERS],
      },
      NOW,
    );
    const loaded = getKidsHelixState(db, "all-trigs");
    expect(loaded!.triggers_fired_this_cycle).toEqual([
      ...KIDS_HELIX_CADENCE_TRIGGERS,
    ]);
  });
});

describe("G-07 self-healing migration (ALTER TABLE idempotency)", () => {
  it("DDL nova é idempotente quando aplicada 2x", () => {
    // Roda DDL de novo (já rodou no beforeEach).
    expect(() => db.exec(KIDS_HELIX_STATE_DDL)).not.toThrow();
  });

  it("ensureG07Migration roda ALTER TABLE silencioso quando coluna já existe", () => {
    // getKidsHelixState dispara ensureG07Migration internamente.
    // Como DDL nova já cria triggers_fired_csv, ALTER TABLE deve raise
    // "duplicate column name" que é capturado silenciosamente.
    expect(() => getKidsHelixState(db, "ghost")).not.toThrow();
    // Segunda chamada: cache flag já true, ALTER nem corre.
    expect(() => getKidsHelixState(db, "ghost")).not.toThrow();
  });

  it("DB com schema antigo (sem triggers_fired_csv) é migrado no primeiro get", () => {
    // Cria DB com schema PRE-G07 (sem triggers_fired_csv).
    const oldDb = new Database(":memory:");
    oldDb.exec(`
      CREATE TABLE IF NOT EXISTS kids_helix_state (
        persona_id TEXT PRIMARY KEY,
        active_pair_0 TEXT NOT NULL,
        active_pair_1 TEXT NOT NULL,
        cycle_started_at TEXT NOT NULL,
        current_day INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'active',
        previous_pair_0 TEXT,
        previous_pair_1 TEXT,
        cycles_completed INTEGER NOT NULL DEFAULT 0,
        queue_csv TEXT NOT NULL DEFAULT '',
        completed_csv TEXT NOT NULL DEFAULT '',
        deferred_csv TEXT NOT NULL DEFAULT '',
        vacation_trigger TEXT,
        vacation_started_at TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    // Insere uma linha pré-G07
    oldDb
      .prepare(
        `INSERT INTO kids_helix_state
          (persona_id, active_pair_0, active_pair_1, cycle_started_at,
           current_day, mode, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("legacy", "SA", "SOC", NOW, 0, "active", NOW);
    _resetG07MigrationFlagForTests();
    const loaded = getKidsHelixState(oldDb, "legacy");
    expect(loaded).not.toBeNull();
    expect(loaded!.triggers_fired_this_cycle).toEqual([]);
    oldDb.close();
  });
});
