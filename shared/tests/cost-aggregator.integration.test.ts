/**
 * Cost aggregator integration tests — NDJSON parse + aggregate end-to-end.
 *
 * Sprint 0 PR2 (motor#73). Story ops#501 (S-J-01-04).
 *
 * Verifica: parse NDJSON real, aplica filtros, agrega — fluxo end-to-end
 * que será usado em scripts de relatório operacional do piloto.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregateCostsFromNdjson } from "../src/cost-aggregator.js";

let tmpDir: string;
let ndjsonPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cost-aggregator-int-"));
  ndjsonPath = join(tmpDir, "events.ndjson");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeNdjson(events: Record<string, unknown>[]): void {
  const lines = events.map((e) => JSON.stringify(e)).join("\n");
  writeFileSync(ndjsonPath, lines + "\n", "utf-8");
}

describe("aggregateCostsFromNdjson — parse real NDJSON", () => {
  it("parsea arquivo NDJSON e agrega corretamente", () => {
    writeNdjson([
      {
        run_id: "test-run",
        seq: 1,
        ts: "2026-05-08T10:00:00.000Z",
        side: "motor",
        step: "drota",
        user_id: "ryo",
        model: "moonshotai/Kimi-K2.5",
        tokens: { in: 1000, out: 200, reasoning: 0 },
        cost_usd_est: 0.00027,
      },
      {
        run_id: "test-run",
        seq: 2,
        ts: "2026-05-08T10:01:00.000Z",
        side: "motor",
        step: "signal-extractor",
        user_id: "ryo",
        model: "mistral3",
        tokens: { in: 500, out: 100, reasoning: 0 },
        cost_usd_est: 0.00016,
      },
    ]);

    const result = aggregateCostsFromNdjson(ndjsonPath);
    expect(result.event_count).toBe(2);
    expect(result.total_cost_usd).toBeCloseTo(0.00043, 10);
    expect(result.total_tokens_in).toBe(1500);
    expect(result.by_model).toHaveProperty("moonshotai/Kimi-K2.5");
    expect(result.by_model).toHaveProperty("mistral3");
  });

  it("ignora linhas vazias e malformadas (JSON inválido) sem crashar", () => {
    const lines = [
      JSON.stringify({
        run_id: "test",
        seq: 1,
        ts: "2026-05-08T10:00:00.000Z",
        side: "motor",
        step: "drota",
        user_id: "ryo",
        model: "kimi",
        tokens: { in: 100, out: 50, reasoning: 0 },
        cost_usd_est: 0.0001,
      }),
      "", // linha vazia
      "not valid json {{{", // malformado
      JSON.stringify({
        run_id: "test",
        seq: 2,
        ts: "2026-05-08T10:01:00.000Z",
        side: "motor",
        step: "drota",
        user_id: "ryo",
        model: "kimi",
        tokens: { in: 200, out: 100, reasoning: 0 },
        cost_usd_est: 0.0002,
      }),
    ];
    writeFileSync(ndjsonPath, lines.join("\n"), "utf-8");

    const result = aggregateCostsFromNdjson(ndjsonPath);
    expect(result.event_count).toBe(2); // 2 events válidos, 2 ignored
    expect(result.total_cost_usd).toBeCloseTo(0.0003, 10);
  });

  it("aplica filtros em arquivo NDJSON (filtro user_id + month)", () => {
    writeNdjson([
      {
        run_id: "r1",
        seq: 1,
        ts: "2026-05-05T10:00:00.000Z",
        side: "motor",
        step: "drota",
        user_id: "ryo",
        model: "kimi",
        tokens: { in: 100, out: 50, reasoning: 0 },
        cost_usd_est: 0.001,
      },
      {
        run_id: "r2",
        seq: 1,
        ts: "2026-05-06T10:00:00.000Z",
        side: "motor",
        step: "drota",
        user_id: "kei",
        model: "kimi",
        tokens: { in: 100, out: 50, reasoning: 0 },
        cost_usd_est: 0.001,
      },
      {
        run_id: "r3",
        seq: 1,
        ts: "2026-04-30T10:00:00.000Z",
        side: "motor",
        step: "drota",
        user_id: "ryo",
        model: "kimi",
        tokens: { in: 100, out: 50, reasoning: 0 },
        cost_usd_est: 0.001,
      },
    ]);

    const result = aggregateCostsFromNdjson(ndjsonPath, {
      user_id: "ryo",
      month: "2026-05",
    });
    expect(result.event_count).toBe(1);
    expect(result.filter).toEqual({ user_id: "ryo", month: "2026-05" });
  });

  it("arquivo inexistente lança erro descritivo", () => {
    expect(() => aggregateCostsFromNdjson(join(tmpDir, "does-not-exist.ndjson"))).toThrow();
  });

  it("arquivo vazio retorna result com totais zerados", () => {
    writeFileSync(ndjsonPath, "", "utf-8");
    const result = aggregateCostsFromNdjson(ndjsonPath);
    expect(result.event_count).toBe(0);
    expect(result.total_cost_usd).toBe(0);
  });
});
