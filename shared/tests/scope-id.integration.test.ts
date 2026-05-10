/**
 * Integration tests para scope_id em NDJSON real.
 *
 * Sprint 0 PR3 (motor#75). Story ops#502 (S-N-01-01).
 * Issue âncora: ops#398 (F1-G5).
 *
 * Cenário central: 2 scopes em mesmo NDJSON (simulado), valida que cada
 * scope_id tem seq monotônico sem gaps/dups, e que reconstrução cronológica
 * por escopo permite distinguir eventos sem ambiguidade.
 *
 * Real concurrent test (2 personas em paralelo) → cost-calc.llm-local.integration
 * (rodada manual quando stack qwen3 up).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logDebugEvent, setDebugRunId } from "../src/debug-logger.js";

let tmpDir: string;
const ORIG_ENV = { ...process.env };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "scope-id-int-"));
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

interface ParsedEvent {
  scope_id: string;
  seq: number;
  step: string;
  [k: string]: unknown;
}

function readEvents(runId: string): ParsedEvent[] {
  const ndjsonPath = join(tmpDir, runId, "events.ndjson");
  return readFileSync(ndjsonPath, "utf-8")
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as ParsedEvent);
}

describe("scope_id pareamento — 2 scopes em mesmo NDJSON", () => {
  it("simula 2 processos escrevendo no mesmo run_id, scope_ids distintos", () => {
    const sharedRunId = "yuji-pilot-shared";
    setDebugRunId(sharedRunId);
    process.env["ASC_DEBUG_RUN_ID"] = sharedRunId;

    // Process A: scope_id = scope-A
    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: "ryo",
      scope_id: "scope-A",
      outcome: "ok",
    });
    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: "ryo",
      scope_id: "scope-A",
      outcome: "ok",
    });
    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: "ryo",
      scope_id: "scope-A",
      outcome: "ok",
    });

    // Process B: scope_id = scope-B (interleaved)
    logDebugEvent({
      side: "sts",
      step: "persona-sim",
      user_id: "kei",
      scope_id: "scope-B",
      outcome: "ok",
    });
    logDebugEvent({
      side: "sts",
      step: "persona-sim",
      user_id: "kei",
      scope_id: "scope-B",
      outcome: "ok",
    });

    const events = readEvents(sharedRunId);
    expect(events).toHaveLength(5);

    const byScope = new Map<string, ParsedEvent[]>();
    for (const e of events) {
      const list = byScope.get(e.scope_id) ?? [];
      list.push(e);
      byScope.set(e.scope_id, list);
    }

    expect(byScope.size).toBe(2);
    const scopeAEvents = byScope.get("scope-A")!;
    const scopeBEvents = byScope.get("scope-B")!;

    // Cada scope tem seq monotônico próprio (1, 2, 3 para A; 1, 2 para B)
    expect(scopeAEvents.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(scopeBEvents.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("scopes diferentes podem ter mesmo seq sem ambiguidade (chave é par scope+seq)", () => {
    const runId = "pareamento-test";
    setDebugRunId(runId);
    process.env["ASC_DEBUG_RUN_ID"] = runId;

    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: "ryo",
      scope_id: "alpha",
      outcome: "ok",
    });
    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: "kei",
      scope_id: "beta",
      outcome: "ok",
    });

    const events = readEvents(runId);
    // Ambos têm seq=1, mas scope_id diferente
    expect(events[0]!.seq).toBe(1);
    expect(events[1]!.seq).toBe(1);
    expect(events[0]!.scope_id).not.toBe(events[1]!.scope_id);

    // Chave única é (scope_id, seq)
    const keys = events.map((e) => `${e.scope_id}#${e.seq}`);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(events.length);
  });

  it("reconstrução cronológica por scope sem gaps em scope individual", () => {
    const runId = "no-gaps";
    setDebugRunId(runId);
    process.env["ASC_DEBUG_RUN_ID"] = runId;

    // 10 events alternados entre 2 scopes
    for (let i = 0; i < 10; i++) {
      const scope = i % 2 === 0 ? "scope-X" : "scope-Y";
      logDebugEvent({
        side: "motor",
        step: "drota",
        user_id: scope === "scope-X" ? "ryo" : "kei",
        scope_id: scope,
        outcome: "ok",
      });
    }

    const events = readEvents(runId);
    const scopeX = events.filter((e) => e.scope_id === "scope-X").map((e) => e.seq);
    const scopeY = events.filter((e) => e.scope_id === "scope-Y").map((e) => e.seq);

    // 5 events por scope, seq 1..5 sem gaps
    expect(scopeX).toEqual([1, 2, 3, 4, 5]);
    expect(scopeY).toEqual([1, 2, 3, 4, 5]);
  });

  it("mesmo scope_id em emissões consecutivas = seq incrementando", () => {
    const runId = "monotonic-single-scope";
    setDebugRunId(runId);
    process.env["ASC_DEBUG_RUN_ID"] = runId;

    for (let i = 0; i < 7; i++) {
      logDebugEvent({
        side: "motor",
        step: "drota",
        user_id: "ryo",
        scope_id: "single",
        outcome: "ok",
      });
    }

    const events = readEvents(runId);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("backward compat — schema com scope_id sempre populado", () => {
  it("scope_id é obrigatório no NDJSON output (não null nem ausente)", () => {
    const runId = "schema-required";
    setDebugRunId(runId);
    process.env["ASC_DEBUG_RUN_ID"] = runId;

    // Caller não passa scope_id → auto-gen
    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: "ryo",
      outcome: "ok",
    });

    const events = readEvents(runId);
    expect(events[0]!.scope_id).toBeDefined();
    expect(events[0]!.scope_id).not.toBeNull();
    expect(typeof events[0]!.scope_id).toBe("string");
    expect((events[0]!.scope_id as string).length).toBeGreaterThan(0);
  });

  it("auto-gen scope_id começa com run_id", () => {
    const runId = "prefix-check-2026";
    setDebugRunId(runId);
    process.env["ASC_DEBUG_RUN_ID"] = runId;

    logDebugEvent({ side: "motor", step: "drota", user_id: "ryo", outcome: "ok" });

    const events = readEvents(runId);
    expect((events[0]!.scope_id as string).startsWith(runId)).toBe(true);
  });
});
