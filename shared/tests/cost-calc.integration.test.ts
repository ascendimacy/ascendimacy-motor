/**
 * Integration tests para cost_usd_est em DebugEventLine.
 *
 * Sprint 0 PR1 (motor#71). Story ops#499 (S-J-01-02).
 * Capability ops#483 (C-J-01). Issue âncora ops#403 (F1-A006).
 *
 * Verifica que logDebugEvent computa cost_usd_est automaticamente quando
 * caller fornece model + tokens mas não fornece cost_usd_est explicitamente.
 *
 * Antes deste PR: cost_usd_est = null em 378/378 events em runs reais.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logDebugEvent, setDebugRunId } from "../src/debug-logger.js";
import { getPricesForModel } from "../src/llm-config.js";

let tmpDir: string;
const ORIG_ENV = { ...process.env };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cost-calc-integration-"));
  delete process.env["ASC_DEBUG_MODE"];
  delete process.env["ASC_DEBUG_RUN_ID"];
  process.env["ASC_DEBUG_DIR"] = tmpDir;
  process.env["ASC_DEBUG_MODE"] = "true";
  setDebugRunId("cost-test-run");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) process.env[k] = v;
});

function readLastEvent(): Record<string, unknown> {
  const ndjson = readFileSync(join(tmpDir, "cost-test-run", "events.ndjson"), "utf-8");
  const lines = ndjson.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]!);
}

describe("logDebugEvent — auto-compute cost_usd_est quando ausente", () => {
  it("calcula cost para chamada Kimi com tokens reais (cenário planejador da run nagareyama)", () => {
    logDebugEvent({
      side: "motor",
      step: "planejador",
      user_id: "ryo",
      model: "moonshotai/Kimi-K2.5",
      provider: "infomaniak",
      tokens: { in: 1648, out: 48 },
      outcome: "ok",
    });

    const event = readLastEvent();
    const prices = getPricesForModel("moonshotai/Kimi-K2.5")!;
    const expected = 1648 * prices.price_in_per_token + 48 * prices.price_out_per_token;
    expect(event.cost_usd_est).toBeCloseTo(expected, 10);
    expect(event.cost_usd_est).not.toBeNull();
    expect(event.cost_usd_est as number).toBeGreaterThan(0);
  });

  it("calcula cost para chamada persona-sim Kimi (cenário 2854/62)", () => {
    logDebugEvent({
      side: "sts",
      step: "persona-sim",
      user_id: "ryo",
      model: "moonshotai/Kimi-K2.5",
      tokens: { in: 2854, out: 62 },
      outcome: "ok",
    });

    const event = readLastEvent();
    expect(event.cost_usd_est).not.toBeNull();
    expect(event.cost_usd_est as number).toBeGreaterThan(0);
  });

  it("calcula cost para mistral3 (signal-extractor)", () => {
    logDebugEvent({
      side: "motor",
      step: "signal-extractor",
      user_id: "ryo",
      model: "mistral3",
      tokens: { in: 800, out: 100 },
      outcome: "ok",
    });

    const event = readLastEvent();
    expect(event.cost_usd_est).not.toBeNull();
    expect(event.cost_usd_est as number).toBeGreaterThan(0);
  });

  it("cost = 0 para qwen3-8b (LLM local sem custo)", () => {
    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: "ryo",
      model: "qwen3-8b",
      tokens: { in: 1500, out: 300 },
      outcome: "ok",
    });

    const event = readLastEvent();
    expect(event.cost_usd_est).toBe(0);
  });

  it("cost = null quando model é null (no LLM call)", () => {
    logDebugEvent({
      side: "motor",
      step: "execute_playbook",
      user_id: "ryo",
      model: null,
      tokens: null,
      outcome: "ok",
    });

    const event = readLastEvent();
    expect(event.cost_usd_est).toBeNull();
  });

  it("cost = null quando modelo é desconhecido (warn na console)", () => {
    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: "ryo",
      model: "modelo-fantasma-zzz",
      tokens: { in: 100, out: 50 },
      outcome: "ok",
    });

    const event = readLastEvent();
    expect(event.cost_usd_est).toBeNull();
  });

  it("respeita cost_usd_est explícito do caller (override manual)", () => {
    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: "ryo",
      model: "moonshotai/Kimi-K2.5",
      tokens: { in: 1000, out: 500 },
      cost_usd_est: 0.42, // valor explícito do caller — deve ser preservado
      outcome: "ok",
    });

    const event = readLastEvent();
    expect(event.cost_usd_est).toBe(0.42);
  });

  it("cost = null quando tokens ausentes (mesmo com modelo conhecido)", () => {
    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: "ryo",
      model: "moonshotai/Kimi-K2.5",
      tokens: null,
      outcome: "ok",
    });

    const event = readLastEvent();
    // Sem tokens, não dá pra calcular — mantém null
    expect(event.cost_usd_est).toBeNull();
  });
});

describe("Coverage rate — cenário F1-A006 reproduzido", () => {
  it("simula run de 10 events: ≥95% cobertura quando model+tokens presentes", () => {
    const models = [
      "moonshotai/Kimi-K2.5",
      "moonshotai/Kimi-K2.5",
      "moonshotai/Kimi-K2.5",
      "mistral3",
      "mistral3",
      "claude-haiku-4-5-20251001",
      "qwen3-8b",
      "qwen3-8b",
      "moonshotai/Kimi-K2.5",
      "mistral3",
    ];

    for (const model of models) {
      logDebugEvent({
        side: "motor",
        step: "drota",
        user_id: "ryo",
        model,
        tokens: { in: 500, out: 100 },
        outcome: "ok",
      });
    }

    const ndjson = readFileSync(join(tmpDir, "cost-test-run", "events.ndjson"), "utf-8");
    const events = ndjson
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const withTokens = events.filter((e) => {
      const t = e.tokens as { in?: number; out?: number } | null;
      return t && ((t.in ?? 0) > 0 || (t.out ?? 0) > 0);
    });
    const populated = withTokens.filter((e) => e.cost_usd_est !== null);
    const rate = populated.length / withTokens.length;
    // Critério de aceitação ops#403: ≥95% events com tokens > 0 têm cost populado
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });
});
