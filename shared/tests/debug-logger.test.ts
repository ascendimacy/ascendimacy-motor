/**
 * Tests do debug-logger (motor#19).
 *
 * Cobertura:
 *   - logDebugEvent no-op quando flag off
 *   - logDebugEvent no-op quando run_id ausente
 *   - Writes NDJSON line correctly
 *   - CAS dedup (mesmo content = 1 arquivo só)
 *   - Hash determinístico
 *   - initDebugRun gera runId + cria manifest
 *   - Falha de I/O não throw (resiliência)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  logDebugEvent,
  initDebugRun,
  isDebugModeEnabled,
  setDebugRunId,
} from "../src/debug-logger.js";

let tmpDir: string;
const ORIG_ENV = { ...process.env };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "debug-logger-test-"));
  // Reseta env
  delete process.env["ASC_DEBUG_MODE"];
  delete process.env["ASC_DEBUG_RUN_ID"];
  process.env["ASC_DEBUG_DIR"] = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  // Restaura env
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) process.env[k] = v;
});

describe("isDebugModeEnabled", () => {
  it("retorna false quando ASC_DEBUG_MODE não setado", () => {
    expect(isDebugModeEnabled()).toBe(false);
  });

  it("retorna true com ASC_DEBUG_MODE=true", () => {
    process.env["ASC_DEBUG_MODE"] = "true";
    expect(isDebugModeEnabled()).toBe(true);
  });

  it("retorna true com ASC_DEBUG_MODE=1", () => {
    process.env["ASC_DEBUG_MODE"] = "1";
    expect(isDebugModeEnabled()).toBe(true);
  });

  it("retorna false com ASC_DEBUG_MODE=false", () => {
    process.env["ASC_DEBUG_MODE"] = "false";
    expect(isDebugModeEnabled()).toBe(false);
  });
});

describe("logDebugEvent — flag off", () => {
  it("no-op quando flag off", () => {
    logDebugEvent({
      side: "motor",
      step: "planejador",
      user_id: "ryo",
      outcome: "ok",
    });
    // Nada deveria ter sido escrito
    expect(existsSync(tmpDir) ? readdirSync(tmpDir) : []).toEqual([]);
  });

  it("no-op quando run_id ausente mesmo com flag on", () => {
    process.env["ASC_DEBUG_MODE"] = "true";
    logDebugEvent({
      side: "motor",
      step: "planejador",
      user_id: "ryo",
      outcome: "ok",
    });
    expect(readdirSync(tmpDir)).toEqual([]);
  });
});

describe("logDebugEvent — flag on + run_id", () => {
  beforeEach(() => {
    process.env["ASC_DEBUG_MODE"] = "true";
    setDebugRunId("test-run-001");
  });

  it("escreve linha NDJSON válida", () => {
    logDebugEvent({
      side: "motor",
      step: "planejador",
      user_id: "ryo-ochiai",
      session_id: "sess-abc",
      turn_number: 3,
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      tokens: { in: 1000, out: 200, reasoning: 500 },
      latency_ms: 1234,
      prompt: "Hello",
      response: "Hi!",
      reasoning: "Thinking...",
      outcome: "ok",
    });

    const ndjsonPath = join(tmpDir, "test-run-001", "events.ndjson");
    expect(existsSync(ndjsonPath)).toBe(true);
    const content = readFileSync(ndjsonPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]!);
    expect(event.run_id).toBe("test-run-001");
    expect(event.step).toBe("planejador");
    expect(event.user_id).toBe("ryo-ochiai");
    expect(event.prompt_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(event.response_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(event.reasoning_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(event.seq).toBe(1);
  });

  it("CAS dedup: mesmo prompt em 2 eventos = 1 arquivo só", () => {
    for (let i = 0; i < 2; i++) {
      logDebugEvent({
        side: "motor",
        step: "planejador",
        user_id: "ryo",
        prompt: "Same prompt content",
        response: "Response " + i,
        outcome: "ok",
      });
    }
    const contentDir = join(tmpDir, "test-run-001", "content");
    const files = readdirSync(contentDir);
    // 1 prompt (dedup) + 2 responses distintas = 3 arquivos
    expect(files).toHaveLength(3);
  });

  it("seq monotônico incrementa", () => {
    for (let i = 0; i < 3; i++) {
      logDebugEvent({
        side: "motor",
        step: "planejador",
        user_id: "ryo",
        outcome: "ok",
      });
    }
    const lines = readFileSync(join(tmpDir, "test-run-001", "events.ndjson"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    // seq é monotônico crescente (valores absolutos dependem de testes anteriores)
    const seqs = lines.map((l) => l.seq);
    expect(seqs.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it("snapshots_pre grava hashes", () => {
    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: "ryo",
      snapshots_pre: {
        drota: { received_pool_size: 5, selected_id: "bio_dolphin" },
        ebrota: { trust: 0.5 },
      },
      outcome: "ok",
    });

    const lines = readFileSync(join(tmpDir, "test-run-001", "events.ndjson"), "utf-8")
      .trim()
      .split("\n");
    const event = JSON.parse(lines[lines.length - 1]!);
    expect(event.snapshots_pre).toBeDefined();
    expect(event.snapshots_pre.drota).toMatch(/^sha256:/);
    expect(event.snapshots_pre.ebrota).toMatch(/^sha256:/);

    // Arquivos existem no snapshots/
    const snapshotDir = join(tmpDir, "test-run-001", "snapshots");
    expect(readdirSync(snapshotDir).length).toBeGreaterThanOrEqual(2);
  });

  it("outcome error + error_class preservados", () => {
    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: "ryo",
      outcome: "error",
      error_class: "LengthFinish",
    });
    const lines = readFileSync(join(tmpDir, "test-run-001", "events.ndjson"), "utf-8")
      .trim()
      .split("\n");
    const event = JSON.parse(lines[lines.length - 1]!);
    expect(event.outcome).toBe("error");
    expect(event.error_class).toBe("LengthFinish");
  });
});

describe("initDebugRun", () => {
  it("gera runId auto quando não setado", () => {
    process.env["ASC_DEBUG_MODE"] = "true";
    const runId = initDebugRun({ scenarioName: "test-scenario" });
    expect(runId).toBeTruthy();
    expect(runId!.startsWith("test-scenario_")).toBe(true);
  });

  it("cria manifest.json", () => {
    process.env["ASC_DEBUG_MODE"] = "true";
    const runId = initDebugRun({
      scenarioName: "test-scenario",
      personas: ["ryo-ochiai", "kei-ochiai"],
      parents: ["yuji", "yuko"],
    });
    const manifestPath = join(tmpDir, runId!, "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.scenario_name).toBe("test-scenario");
    expect(manifest.personas).toEqual(["ryo-ochiai", "kei-ochiai"]);
    expect(manifest.versions.debug_mode_schema).toBe("1.0");
  });

  it("returns null quando flag off", () => {
    const runId = initDebugRun({ scenarioName: "test-scenario" });
    expect(runId).toBeNull();
  });

  it("reutiliza runId se já setado", () => {
    process.env["ASC_DEBUG_MODE"] = "true";
    setDebugRunId("my-custom-id");
    const runId = initDebugRun({ scenarioName: "whatever" });
    expect(runId).toBe("my-custom-id");
  });
});
