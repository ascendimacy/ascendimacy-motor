/**
 * G-22 Gap 2 hydration (ops#1033) — getState() com personaId hidrata
 * recentContentUsage a partir de content_usage table (janela 14d).
 *
 * Backward compat: sem personaId, recentContentUsage fica undefined.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getState, closeDb, getDbInstance } from "../src/state-manager.js";
import { recordContentUsage } from "../src/content-usage-repo.js";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

beforeEach(() => {
  closeDb();
  tmpDir = mkdtempSync(join(tmpdir(), "motor-content-usage-test-"));
  process.env["MOTOR_STATE_DIR"] = tmpDir;
});

afterEach(() => {
  closeDb();
  delete process.env["MOTOR_STATE_DIR"];
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("getState × content_usage hydration (G-22 Gap 2)", () => {
  it("backward compat: getState(sessionId) sem personaId → recentContentUsage undefined", () => {
    const state = getState("sess-1");
    expect(state.recentContentUsage).toBeUndefined();
  });

  it("getState com personaId sem usage prévio → recentContentUsage = {}", () => {
    const state = getState("sess-1", "2026-05-14T10:00:00.000Z", "ryo-no-usage");
    expect(state.recentContentUsage).toEqual({});
  });

  it("hidrata record {content_id: times_used} dentro da janela 14d", () => {
    // Bootstrap DB
    getState("sess-1");
    recordContentUsage(getDbInstance(), {
      personaId: "ryo",
      contentId: "item-a",
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    recordContentUsage(getDbInstance(), {
      personaId: "ryo",
      contentId: "item-a",
      nowIso: "2026-05-14T11:00:00.000Z", // → times_used=2
    });
    recordContentUsage(getDbInstance(), {
      personaId: "ryo",
      contentId: "item-b",
      nowIso: "2026-05-14T11:30:00.000Z",
    });

    const state = getState("sess-1", "2026-05-14T12:00:00.000Z", "ryo");
    expect(state.recentContentUsage).toEqual({ "item-a": 2, "item-b": 1 });
  });

  it("isola por personaId (cross-persona não vaza)", () => {
    getState("sess-1");
    recordContentUsage(getDbInstance(), {
      personaId: "ryo",
      contentId: "item-x",
      nowIso: "2026-05-14T10:00:00.000Z",
    });
    recordContentUsage(getDbInstance(), {
      personaId: "kei",
      contentId: "item-y",
      nowIso: "2026-05-14T10:00:00.000Z",
    });

    const ryo = getState("sess-1", "2026-05-14T12:00:00.000Z", "ryo");
    const kei = getState("sess-1", "2026-05-14T12:00:00.000Z", "kei");
    expect(ryo.recentContentUsage).toEqual({ "item-x": 1 });
    expect(kei.recentContentUsage).toEqual({ "item-y": 1 });
  });

  it("filtra rows fora da janela 14d", () => {
    getState("sess-1");
    // Usage 30 dias antes do now — fora da janela 14d
    recordContentUsage(getDbInstance(), {
      personaId: "ryo",
      contentId: "old",
      nowIso: "2026-04-14T10:00:00.000Z",
    });
    // Usage 5 dias antes do now — dentro
    recordContentUsage(getDbInstance(), {
      personaId: "ryo",
      contentId: "recent",
      nowIso: "2026-05-09T10:00:00.000Z",
    });

    const state = getState("sess-1", "2026-05-14T10:00:00.000Z", "ryo");
    expect(state.recentContentUsage).toEqual({ "recent": 1 });
    expect(state.recentContentUsage).not.toHaveProperty("old");
  });

  it("preserva hidratação de kidsHelixState junto (sem regressão G-05)", async () => {
    // Garante que adição do recentContentUsage não quebra outras hydrations
    const { bootstrapKidsHelixStateRow } = await import("../src/kids-helix-state.js");
    getState("sess-1");
    bootstrapKidsHelixStateRow(getDbInstance(), {
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    recordContentUsage(getDbInstance(), {
      personaId: "ryo",
      contentId: "co-existing-item",
      nowIso: "2026-05-16T13:00:00.000Z",
    });

    const state = getState("sess-1", "2026-05-16T14:00:00.000Z", "ryo");
    expect(state.kidsHelixState).toBeDefined();
    expect(state.recentContentUsage).toEqual({ "co-existing-item": 1 });
  });
});
