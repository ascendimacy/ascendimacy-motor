/**
 * Unit tests para helix-events emitters.
 *
 * Sprint 0 PR4 (motor#77). Story ops#503 (S-N-01-02).
 * Capability ops#482 (C-N-01). Issue âncora ops#398 (F1-G5).
 *
 * Validação contratual: cada emitter requer correlationContext
 * (session_id + turn_number) que é repassado ao NDJSON.
 *
 * Atualmente não há callers de produção dos emitters; este test garante
 * que quando wiring for adicionado (motor#37 follow-up), o correlation
 * context será propagado por TypeScript constraint.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emitHelixCycleStarted,
  emitRetrievalTriggered,
  emitBossCompleted,
  emitCycleCompleted,
  emitPairDeferred,
} from "../src/helix-events.js";
import { setDebugRunId } from "../src/debug-logger.js";
import type { HelixState } from "../src/helix-state.js";

let tmpDir: string;
const ORIG_ENV = { ...process.env };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "helix-events-unit-"));
  delete process.env["ASC_DEBUG_MODE"];
  delete process.env["ASC_DEBUG_RUN_ID"];
  delete process.env["ASC_DEBUG_SCOPE_ID"];
  process.env["ASC_DEBUG_DIR"] = tmpDir;
  process.env["ASC_DEBUG_MODE"] = "true";
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) process.env[k] = v;
});

function makeState(): HelixState {
  return {
    userId: "ryo",
    activeDimension: "SA",
    activeLevel: "developing",
    cycleStart: "2026-05-08",
    progress: 0.3,
    cycleDay: 6,
    estimatedCycleDays: 18,
    queue: ["SOC", "SM", "REL", "DM"],
    completed: [],
    deferred: [],
    previousDimension: null,
    retrievalDone: false,
    vacationModeActive: false,
  };
}

function readEvents(runId: string): Record<string, unknown>[] {
  const ndjsonPath = join(tmpDir, runId, "events.ndjson");
  return readFileSync(ndjsonPath, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

describe("emitHelixCycleStarted — session_id + turn_number propagation", () => {
  it("populates session_id e turn_number quando correlationContext é fornecido", () => {
    setDebugRunId("helix-test-1");
    emitHelixCycleStarted(makeState(), { session_id: "sess-abc", turn_number: 5 });
    const events = readEvents("helix-test-1");
    expect(events[0]!.session_id).toBe("sess-abc");
    expect(events[0]!.turn_number).toBe(5);
    expect(events[0]!.step).toBe("helix.cycle.started");
  });
});

describe("emitRetrievalTriggered — correlation context", () => {
  it("populates session_id + turn_number", () => {
    setDebugRunId("helix-test-2");
    emitRetrievalTriggered(makeState(), "SM", { session_id: "sess-xyz", turn_number: 12 });
    const events = readEvents("helix-test-2");
    expect(events[0]!.session_id).toBe("sess-xyz");
    expect(events[0]!.turn_number).toBe(12);
    expect(events[0]!.step).toBe("helix.retrieval.triggered");
  });
});

describe("emitBossCompleted — correlation context", () => {
  it("populates session_id + turn_number", () => {
    setDebugRunId("helix-test-3");
    emitBossCompleted(makeState(), "REL", { session_id: "boss-sess", turn_number: 22 });
    const events = readEvents("helix-test-3");
    expect(events[0]!.session_id).toBe("boss-sess");
    expect(events[0]!.turn_number).toBe(22);
    expect(events[0]!.step).toBe("helix.boss.completed");
  });
});

describe("emitCycleCompleted — correlation context", () => {
  it("populates session_id + turn_number", () => {
    setDebugRunId("helix-test-4");
    emitCycleCompleted(makeState(), { session_id: "cycle-sess", turn_number: 30 });
    const events = readEvents("helix-test-4");
    expect(events[0]!.session_id).toBe("cycle-sess");
    expect(events[0]!.turn_number).toBe(30);
    expect(events[0]!.step).toBe("helix.cycle.completed");
  });
});

describe("emitPairDeferred — correlation context", () => {
  it("populates session_id + turn_number", () => {
    setDebugRunId("helix-test-5");
    emitPairDeferred(makeState(), "DM", "queue empty", {
      session_id: "deferred-sess",
      turn_number: 7,
    });
    const events = readEvents("helix-test-5");
    expect(events[0]!.session_id).toBe("deferred-sess");
    expect(events[0]!.turn_number).toBe(7);
    expect(events[0]!.step).toBe("helix.pair.deferred");
  });
});

describe("100% coverage — todos os helix.* events têm correlation context populado", () => {
  it("nenhum helix.* event emite com session_id ou turn_number null", () => {
    setDebugRunId("coverage-test");
    const ctx = { session_id: "sess-coverage", turn_number: 1 };
    const state = makeState();

    emitHelixCycleStarted(state, ctx);
    emitRetrievalTriggered(state, "SM", { ...ctx, turn_number: 2 });
    emitBossCompleted(state, "REL", { ...ctx, turn_number: 3 });
    emitCycleCompleted(state, { ...ctx, turn_number: 4 });
    emitPairDeferred(state, "DM", "test reason", { ...ctx, turn_number: 5 });

    const events = readEvents("coverage-test");
    expect(events).toHaveLength(5);
    for (const event of events) {
      expect(event.session_id).not.toBeNull();
      expect(event.turn_number).not.toBeNull();
      expect(event.session_id).toBeTruthy();
      expect(typeof event.turn_number).toBe("number");
    }
  });
});
