/**
 * Migration bootstrap: getState() com personaId hidrata kidsHelixState
 * quando row presente, e backward-compat sem personaId.
 *
 * G-05, ops#1091 Step 4 — "Migration: bootstrap state quando persona nova".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getState, closeDb, getDbInstance } from "../src/state-manager.js";
import { bootstrapKidsHelixStateRow } from "../src/kids-helix-state.js";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

beforeEach(() => {
  closeDb();
  tmpDir = mkdtempSync(join(tmpdir(), "motor-helix-test-"));
  process.env["MOTOR_STATE_DIR"] = tmpDir;
});

afterEach(() => {
  closeDb();
  delete process.env["MOTOR_STATE_DIR"];
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("getState × kids_helix_state hydration (G-05)", () => {
  it("backward compat: getState(sessionId) sem personaId → kidsHelixState undefined", () => {
    const state = getState("sess-1");
    expect(state.kidsHelixState).toBeUndefined();
  });

  it("getState(sessionId, undefined, personaId) sem bootstrap → kidsHelixState undefined", () => {
    const state = getState("sess-1", undefined, "ryo-no-row");
    expect(state.kidsHelixState).toBeUndefined();
  });

  it("após bootstrap, getState hidrata kidsHelixState com active_pair fallback", () => {
    // Cria DB primeiro (getState bootstrap)
    getState("sess-1");
    // Bootstrap helix row via repo
    bootstrapKidsHelixStateRow(getDbInstance(), {
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const state = getState("sess-1", undefined, "ryo");
    expect(state.kidsHelixState).toBeDefined();
    expect(state.kidsHelixState!.active_pair).toEqual(["SA", "SOC"]);
    expect(state.kidsHelixState!.mode).toBe("active");
    expect(state.kidsHelixState!.current_day).toBe(0);
  });

  it("personas distintas: hydration isolada por personaId", () => {
    getState("sess-1");
    bootstrapKidsHelixStateRow(getDbInstance(), {
      personaId: "ryo",
      firstPair: ["DM", "REL"],
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    bootstrapKidsHelixStateRow(getDbInstance(), {
      personaId: "kei",
      firstPair: ["SM", "SA"],
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const ryoState = getState("sess-1", undefined, "ryo");
    const keiState = getState("sess-1", undefined, "kei");
    expect(ryoState.kidsHelixState!.active_pair).toEqual(["DM", "REL"]);
    expect(keiState.kidsHelixState!.active_pair).toEqual(["SM", "SA"]);
  });
});
