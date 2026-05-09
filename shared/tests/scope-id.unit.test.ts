/**
 * Unit tests para scope_id em debug-logger.
 *
 * Sprint 0 PR3 (motor#75). Story ops#502 (S-N-01-01).
 * Capability: ops#482 (C-N-01).
 *
 * Validação:
 *  - getDebugScopeId() retorna string consistente dentro do processo
 *  - setDebugRunId regenera scope_id (UUID-based)
 *  - Override via ASC_DEBUG_SCOPE_ID env var
 *  - Counter per-scope: cada scope_id tem seu próprio seq monotônico
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logDebugEvent, setDebugRunId, getDebugScopeId } from "../src/debug-logger.js";

let tmpDir: string;
const ORIG_ENV = { ...process.env };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "scope-id-unit-"));
  delete process.env["ASC_DEBUG_MODE"];
  delete process.env["ASC_DEBUG_RUN_ID"];
  delete process.env["ASC_DEBUG_SCOPE_ID"];
  process.env["ASC_DEBUG_DIR"] = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) process.env[k] = v;
});

describe("getDebugScopeId — geração", () => {
  it("retorna string não-vazia", () => {
    setDebugRunId("test-scope-gen");
    const scopeId = getDebugScopeId();
    expect(typeof scopeId).toBe("string");
    expect(scopeId.length).toBeGreaterThan(0);
  });

  it("scope_id inclui run_id como prefixo", () => {
    setDebugRunId("yuji-pilot-001");
    const scopeId = getDebugScopeId();
    expect(scopeId.startsWith("yuji-pilot-001")).toBe(true);
  });

  it("é estável dentro de uma chamada de setDebugRunId (idempotente)", () => {
    setDebugRunId("stability-test");
    const a = getDebugScopeId();
    const b = getDebugScopeId();
    const c = getDebugScopeId();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("setDebugRunId com novo run_id regenera scope (fresh UUID)", () => {
    setDebugRunId("run-A");
    const scopeA = getDebugScopeId();
    setDebugRunId("run-B");
    const scopeB = getDebugScopeId();
    expect(scopeA).not.toBe(scopeB);
    expect(scopeA.startsWith("run-A")).toBe(true);
    expect(scopeB.startsWith("run-B")).toBe(true);
  });

  it("setDebugRunId com mesmo run_id ainda regenera scope (fresh UUID, sufix diferente)", () => {
    // Cenário: process reinicia mesma run após crash. Fresh scope distingue
    // "antes" e "depois" do crash em NDJSON consolidado.
    setDebugRunId("same-run-id");
    const scope1 = getDebugScopeId();
    setDebugRunId("same-run-id");
    const scope2 = getDebugScopeId();
    expect(scope1).not.toBe(scope2);
    expect(scope1.startsWith("same-run-id")).toBe(true);
    expect(scope2.startsWith("same-run-id")).toBe(true);
  });
});

describe("ASC_DEBUG_SCOPE_ID override", () => {
  it("env var override wins sobre auto-gen", () => {
    setDebugRunId("auto-run");
    process.env["ASC_DEBUG_SCOPE_ID"] = "manual-scope-xyz";
    const scopeId = getDebugScopeId();
    expect(scopeId).toBe("manual-scope-xyz");
  });

  it("remover env var reverte para auto-gen", () => {
    setDebugRunId("revert-run");
    process.env["ASC_DEBUG_SCOPE_ID"] = "override";
    expect(getDebugScopeId()).toBe("override");
    delete process.env["ASC_DEBUG_SCOPE_ID"];
    const auto = getDebugScopeId();
    expect(auto).not.toBe("override");
    expect(auto.startsWith("revert-run")).toBe(true);
  });
});

describe("counter per-scope monotônico", () => {
  beforeEach(() => {
    process.env["ASC_DEBUG_MODE"] = "true";
  });

  function readEvents(runId: string): Record<string, unknown>[] {
    const ndjsonPath = join(tmpDir, runId, "events.ndjson");
    const content = readFileSync(ndjsonPath, "utf-8");
    return content
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  }

  it("cada scope tem seq começando em 1 e monotônico", () => {
    setDebugRunId("counter-test-1");
    for (let i = 0; i < 5; i++) {
      logDebugEvent({ side: "motor", step: "drota", user_id: "ryo", outcome: "ok" });
    }
    const events = readEvents("counter-test-1");
    expect(events).toHaveLength(5);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("scope diferente reinicia counter em 1", () => {
    setDebugRunId("counter-A");
    logDebugEvent({ side: "motor", step: "drota", user_id: "ryo", outcome: "ok" });
    logDebugEvent({ side: "motor", step: "drota", user_id: "ryo", outcome: "ok" });
    const eventsA = readEvents("counter-A");
    expect(eventsA.map((e) => e.seq)).toEqual([1, 2]);

    setDebugRunId("counter-B");
    logDebugEvent({ side: "motor", step: "drota", user_id: "ryo", outcome: "ok" });
    const eventsB = readEvents("counter-B");
    expect(eventsB.map((e) => e.seq)).toEqual([1]);
  });

  it("cada event carrega scope_id populado", () => {
    setDebugRunId("scope-populated");
    logDebugEvent({ side: "motor", step: "drota", user_id: "ryo", outcome: "ok" });
    const events = readEvents("scope-populated");
    expect(events[0]!.scope_id).toBeDefined();
    expect(typeof events[0]!.scope_id).toBe("string");
    expect((events[0]!.scope_id as string).startsWith("scope-populated")).toBe(true);
  });

  it("caller pode override scope_id por event individual", () => {
    setDebugRunId("override-per-event");
    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: "ryo",
      scope_id: "custom-scope-xyz",
      outcome: "ok",
    });
    const events = readEvents("override-per-event");
    expect(events[0]!.scope_id).toBe("custom-scope-xyz");
  });
});
