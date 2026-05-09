/**
 * Cost aggregator unit tests.
 *
 * Sprint 0 PR2 (motor#73). Story ops#501 (S-J-01-04).
 * Capability: ops#483 (C-J-01).
 *
 * Função aggregateCosts: agrega DebugEventLine[] em totais por mês/persona/run/modelo.
 */

import { describe, it, expect } from "vitest";
import { aggregateCosts, type DebugEventLineLike } from "../src/cost-aggregator.js";

function makeEvent(opts: Partial<DebugEventLineLike>): DebugEventLineLike {
  // Importante: usar `in` checks para preservar valores explicitamente null.
  // `opts.x ?? default` substituiria null pelo default — quebra os testes que
  // querem testar comportamento com null.
  return {
    run_id: "run_id" in opts ? opts.run_id! : "run-test",
    seq: "seq" in opts ? opts.seq! : 1,
    ts: "ts" in opts ? opts.ts! : "2026-05-08T10:00:00.000Z",
    side: "side" in opts ? opts.side! : "motor",
    step: "step" in opts ? opts.step! : "drota",
    user_id: "user_id" in opts ? opts.user_id! : "ryo",
    model: "model" in opts ? (opts.model as string | null) : "moonshotai/Kimi-K2.5",
    tokens:
      "tokens" in opts
        ? (opts.tokens as { in: number; out: number; reasoning: number } | null)
        : { in: 1000, out: 200, reasoning: 0 },
    cost_usd_est: "cost_usd_est" in opts ? (opts.cost_usd_est as number | null) : 0.0005,
  };
}

describe("aggregateCosts — sem filtros", () => {
  it("array vazio retorna totais zerados", () => {
    const result = aggregateCosts([]);
    expect(result.event_count).toBe(0);
    expect(result.total_cost_usd).toBe(0);
    expect(result.total_tokens_in).toBe(0);
    expect(result.total_tokens_out).toBe(0);
    expect(result.by_model).toEqual({});
  });

  it("soma cost_usd_est de todos os events", () => {
    const events = [
      makeEvent({ cost_usd_est: 0.001 }),
      makeEvent({ cost_usd_est: 0.002 }),
      makeEvent({ cost_usd_est: 0.003 }),
    ];
    const result = aggregateCosts(events);
    expect(result.total_cost_usd).toBeCloseTo(0.006, 10);
    expect(result.event_count).toBe(3);
  });

  it("soma tokens in/out", () => {
    const events = [
      makeEvent({ tokens: { in: 100, out: 50, reasoning: 0 } }),
      makeEvent({ tokens: { in: 200, out: 100, reasoning: 0 } }),
    ];
    const result = aggregateCosts(events);
    expect(result.total_tokens_in).toBe(300);
    expect(result.total_tokens_out).toBe(150);
  });

  it("ignora cost_usd_est=null (não soma)", () => {
    const events = [
      makeEvent({ cost_usd_est: 0.001 }),
      makeEvent({ cost_usd_est: null }),
      makeEvent({ cost_usd_est: 0.002 }),
    ];
    const result = aggregateCosts(events);
    expect(result.total_cost_usd).toBeCloseTo(0.003, 10);
    expect(result.event_count).toBe(3); // event_count conta tudo, cost só os populated
  });

  it("ignora tokens=null (não soma)", () => {
    const events = [
      makeEvent({ tokens: { in: 100, out: 50, reasoning: 0 } }),
      makeEvent({ tokens: null }),
    ];
    const result = aggregateCosts(events);
    expect(result.total_tokens_in).toBe(100);
    expect(result.total_tokens_out).toBe(50);
  });
});

describe("aggregateCosts — breakdown by_model", () => {
  it("agrupa por modelo distinto", () => {
    const events = [
      makeEvent({ model: "moonshotai/Kimi-K2.5", cost_usd_est: 0.001 }),
      makeEvent({ model: "moonshotai/Kimi-K2.5", cost_usd_est: 0.002 }),
      makeEvent({ model: "mistral3", cost_usd_est: 0.0005 }),
      makeEvent({ model: "claude-haiku-4-5-20251001", cost_usd_est: 0.005 }),
    ];
    const result = aggregateCosts(events);
    expect(Object.keys(result.by_model)).toHaveLength(3);
    expect(result.by_model["moonshotai/Kimi-K2.5"]?.cost_usd).toBeCloseTo(0.003, 10);
    expect(result.by_model["moonshotai/Kimi-K2.5"]?.event_count).toBe(2);
    expect(result.by_model["mistral3"]?.cost_usd).toBeCloseTo(0.0005, 10);
    expect(result.by_model["claude-haiku-4-5-20251001"]?.cost_usd).toBeCloseTo(0.005, 10);
  });

  it("breakdown por modelo soma tokens corretamente", () => {
    const events = [
      makeEvent({ model: "kimi", tokens: { in: 100, out: 50, reasoning: 0 } }),
      makeEvent({ model: "kimi", tokens: { in: 200, out: 100, reasoning: 0 } }),
      makeEvent({ model: "mistral3", tokens: { in: 50, out: 25, reasoning: 0 } }),
    ];
    const result = aggregateCosts(events);
    expect(result.by_model["kimi"]?.tokens_in).toBe(300);
    expect(result.by_model["kimi"]?.tokens_out).toBe(150);
    expect(result.by_model["mistral3"]?.tokens_in).toBe(50);
  });

  it("agrupa events com model=null em bucket '__no_model__' (não no by_model normal)", () => {
    const events = [
      makeEvent({ model: null, cost_usd_est: 0 }),
      makeEvent({ model: "kimi", cost_usd_est: 0.001 }),
    ];
    const result = aggregateCosts(events);
    expect(result.by_model["kimi"]).toBeDefined();
    expect(result.by_model["__no_model__"]).toBeDefined();
    expect(result.by_model["__no_model__"]?.event_count).toBe(1);
  });
});

describe("aggregateCosts — filtros", () => {
  const events = [
    makeEvent({
      run_id: "nagareyama-2026-05-05",
      ts: "2026-05-05T10:00:00.000Z",
      user_id: "ryo",
      model: "kimi",
      cost_usd_est: 0.001,
    }),
    makeEvent({
      run_id: "nagareyama-2026-05-05",
      ts: "2026-05-05T11:00:00.000Z",
      user_id: "kei",
      model: "kimi",
      cost_usd_est: 0.0008,
    }),
    makeEvent({
      run_id: "nagareyama-2026-05-06",
      ts: "2026-05-06T09:00:00.000Z",
      user_id: "ryo",
      model: "mistral3",
      cost_usd_est: 0.0003,
    }),
    makeEvent({
      run_id: "nagareyama-2026-04-30",
      ts: "2026-04-30T10:00:00.000Z",
      user_id: "ryo",
      model: "kimi",
      cost_usd_est: 0.0005,
    }),
  ];

  it("filtra por user_id", () => {
    const result = aggregateCosts(events, { user_id: "ryo" });
    expect(result.event_count).toBe(3); // ryo aparece em 3 events
    expect(result.total_cost_usd).toBeCloseTo(0.0018, 10);
  });

  it("filtra por run_id", () => {
    const result = aggregateCosts(events, { run_id: "nagareyama-2026-05-05" });
    expect(result.event_count).toBe(2);
    expect(result.total_cost_usd).toBeCloseTo(0.0018, 10);
  });

  it("filtra por month (YYYY-MM)", () => {
    const may = aggregateCosts(events, { month: "2026-05" });
    expect(may.event_count).toBe(3);
    const apr = aggregateCosts(events, { month: "2026-04" });
    expect(apr.event_count).toBe(1);
  });

  it("filtra por user_id + month combinados", () => {
    const result = aggregateCosts(events, { user_id: "ryo", month: "2026-05" });
    expect(result.event_count).toBe(2); // ryo em maio: 2 events
    expect(result.total_cost_usd).toBeCloseTo(0.0013, 10);
  });

  it("filtro vazio (objeto vazio) = sem filtros", () => {
    const result = aggregateCosts(events, {});
    expect(result.event_count).toBe(4);
  });

  it("filtro retorna filter no result para auditoria", () => {
    const filter = { user_id: "ryo", month: "2026-05" };
    const result = aggregateCosts(events, filter);
    expect(result.filter).toEqual(filter);
  });
});

describe("aggregateCosts — cenário Yuji piloto", () => {
  it("simula 1 mês de piloto Ryo: 30 events × ~$0.0008 cada", () => {
    const events: DebugEventLineLike[] = [];
    for (let day = 1; day <= 30; day++) {
      events.push(
        makeEvent({
          run_id: `yuji-pilot-2026-05-${String(day).padStart(2, "0")}`,
          ts: `2026-05-${String(day).padStart(2, "0")}T10:00:00.000Z`,
          user_id: "ryo",
          model: "moonshotai/Kimi-K2.5",
          cost_usd_est: 0.0008,
        }),
      );
    }
    const result = aggregateCosts(events, { user_id: "ryo", month: "2026-05" });
    expect(result.event_count).toBe(30);
    expect(result.total_cost_usd).toBeCloseTo(0.024, 10); // 30 * 0.0008
  });
});
