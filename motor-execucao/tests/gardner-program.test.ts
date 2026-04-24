import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  GARDNER_PROGRAM_DDL,
  getProgramState,
  startProgram,
  advanceProgram,
  pauseProgram,
  resumeProgram,
  recordMissedMilestone,
  resetMissedMilestones,
} from "../src/gardner-program.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(GARDNER_PROGRAM_DDL);
});

afterEach(() => {
  db.close();
});

describe("gardner-program CRUD", () => {
  it("getProgramState de sessão nova retorna default (pré-programa)", () => {
    const s = getProgramState(db, "new");
    expect(s.current_week).toBeNull();
    expect(s.current_phase).toBeNull();
    expect(s.paused).toBe(false);
    expect(s.phases_completed).toBe(0);
  });

  it("startProgram inicia week 1 phase 1", () => {
    const s = startProgram(db, "s1");
    expect(s.current_week).toBe(1);
    expect(s.current_phase).toBe("exploration_in_strength");
    expect(s.paused).toBe(false);
  });

  it("startProgram é idempotente (não reseta se já iniciado)", () => {
    startProgram(db, "s1");
    advanceProgram(db, "s1"); // phase 1 → 2
    const s = startProgram(db, "s1");
    expect(s.current_phase).toBe("translation_via_weakness");
  });

  it("advanceProgram progride phase 1→2→3→week2 phase1", () => {
    startProgram(db, "s1");
    const p2 = advanceProgram(db, "s1");
    expect(p2.current_phase).toBe("translation_via_weakness");
    const p3 = advanceProgram(db, "s1");
    expect(p3.current_phase).toBe("presentation");
    const w2 = advanceProgram(db, "s1");
    expect(w2.current_week).toBe(2);
    expect(w2.current_phase).toBe("exploration_in_strength");
  });

  it("advanceProgram throws quando pausado", () => {
    startProgram(db, "s1");
    pauseProgram(db, "s1", "test");
    expect(() => advanceProgram(db, "s1")).toThrow(/paused/);
  });

  it("pauseProgram marca paused + reason", () => {
    startProgram(db, "s1");
    const s = pauseProgram(db, "s1", "emotional_brejo");
    expect(s.paused).toBe(true);
    expect(s.paused_reason).toBe("emotional_brejo");
  });

  it("resumeProgram limpa paused + reason", () => {
    startProgram(db, "s1");
    pauseProgram(db, "s1", "emotional_brejo");
    const s = resumeProgram(db, "s1");
    expect(s.paused).toBe(false);
    expect(s.paused_reason).toBeUndefined();
  });

  it("recordMissedMilestone incrementa contador; 2 consecutivos pausa", () => {
    startProgram(db, "s1");
    const s1 = recordMissedMilestone(db, "s1");
    expect(s1.consecutive_missed_milestones).toBe(1);
    expect(s1.paused).toBe(false);
    const s2 = recordMissedMilestone(db, "s1");
    expect(s2.consecutive_missed_milestones).toBe(2);
    expect(s2.paused).toBe(true);
    expect(s2.paused_reason).toBe("missed_milestones");
  });

  it("resetMissedMilestones zera contador", () => {
    startProgram(db, "s1");
    recordMissedMilestone(db, "s1");
    resetMissedMilestones(db, "s1");
    const s = getProgramState(db, "s1");
    expect(s.consecutive_missed_milestones).toBe(0);
  });

  it("sessões isoladas — estado de s1 não vaza pra s2", () => {
    startProgram(db, "s1");
    advanceProgram(db, "s1");
    const s2 = getProgramState(db, "s2");
    expect(s2.current_week).toBeNull();
  });
});
