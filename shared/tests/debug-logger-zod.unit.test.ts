/**
 * Unit tests para Zod schema validation em DebugEventLine.
 *
 * Sprint 0 PR5 (motor#TBD). Stories ops#504 (S-N-01-03) + ops#505 (S-N-01-04).
 * Capability ops#482 (C-N-01). Bundles fix ops#408 (mood_method enum violation).
 *
 * Validações cobertas:
 *  - model=null permitido (stub steps)
 *  - model != null + tokens.in > 0 → válido
 *  - model != null + tokens.in == 0 → REJEITA (S-N-01-04)
 *  - model != null + tokens=null → REJEITA (tokens.in implícito 0)
 *  - scope_id obrigatório, string não-vazia
 *  - seq positivo
 *  - outcome restrito a ok/error/skip
 */

import { describe, it, expect } from "vitest";
import { DebugEventLineSchema, validateDebugEventLine } from "../src/debug-logger.js";

const validBase = {
  run_id: "test-run",
  scope_id: "test-run-abcd1234",
  seq: 1,
  ts: "2026-05-09T10:00:00.000Z",
  side: "motor" as const,
  step: "drota",
  user_id: "ryo",
  partner_user_id: null,
  user_kind: null,
  motor_target: null,
  session_id: null,
  scenario_day: null,
  turn_number: null,
  model: null,
  provider: null,
  tokens: null,
  latency_ms: null,
  cost_usd_est: null,
  prompt_hash: null,
  response_hash: null,
  reasoning_hash: null,
  snapshots_pre: null,
  snapshots_post: null,
  outcome: "ok" as const,
  error_class: null,
};

describe("DebugEventLineSchema — campos básicos", () => {
  it("aceita evento mínimo válido (model=null, tokens=null)", () => {
    const result = DebugEventLineSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("rejeita evento sem run_id", () => {
    const r = DebugEventLineSchema.safeParse({ ...validBase, run_id: undefined });
    expect(r.success).toBe(false);
  });

  it("rejeita scope_id vazio", () => {
    const r = DebugEventLineSchema.safeParse({ ...validBase, scope_id: "" });
    expect(r.success).toBe(false);
  });

  it("rejeita seq negativo", () => {
    const r = DebugEventLineSchema.safeParse({ ...validBase, seq: -1 });
    expect(r.success).toBe(false);
  });

  it("rejeita seq zero (deve ser >= 1)", () => {
    const r = DebugEventLineSchema.safeParse({ ...validBase, seq: 0 });
    expect(r.success).toBe(false);
  });

  it("rejeita side fora do enum", () => {
    const r = DebugEventLineSchema.safeParse({ ...validBase, side: "frontend" });
    expect(r.success).toBe(false);
  });

  it("rejeita outcome fora do enum", () => {
    const r = DebugEventLineSchema.safeParse({ ...validBase, outcome: "pending" });
    expect(r.success).toBe(false);
  });

  // D-4-TELO (ops#1056): outcome ganha "ok-retry" e "degraded" granular.
  it("aceita outcome \"ok-retry\" (sucesso após retry)", () => {
    const r = DebugEventLineSchema.safeParse({ ...validBase, outcome: "ok-retry" });
    expect(r.success).toBe(true);
  });

  it("aceita outcome \"degraded\" (sucesso parcial — ISA labels stripped)", () => {
    const r = DebugEventLineSchema.safeParse({ ...validBase, outcome: "degraded" });
    expect(r.success).toBe(true);
  });

  it("legado \"ok\" / \"error\" / \"skip\" continua válido (back-compat)", () => {
    for (const v of ["ok", "error", "skip"]) {
      const r = DebugEventLineSchema.safeParse({ ...validBase, outcome: v });
      expect(r.success).toBe(true);
    }
  });
});

describe("DebugEventLineSchema — model + tokens consistency (S-N-01-04)", () => {
  it("aceita model=null + tokens=null (stub step sem LLM)", () => {
    const r = DebugEventLineSchema.safeParse({
      ...validBase,
      model: null,
      tokens: null,
    });
    expect(r.success).toBe(true);
  });

  it("aceita model + tokens.in > 0 (chamada LLM real)", () => {
    const r = DebugEventLineSchema.safeParse({
      ...validBase,
      model: "moonshotai/Kimi-K2.5",
      tokens: { in: 100, out: 50, reasoning: 0 },
    });
    expect(r.success).toBe(true);
  });

  it("REJEITA model != null com tokens.in == 0", () => {
    const r = DebugEventLineSchema.safeParse({
      ...validBase,
      model: "kimi",
      tokens: { in: 0, out: 0, reasoning: 0 },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      // Mensagem deve indicar problema de model+tokens
      const msg = r.error.issues.map((i) => i.message).join(" ");
      expect(msg.toLowerCase()).toContain("model");
    }
  });

  it("REJEITA model != null com tokens=null (in implicit 0)", () => {
    const r = DebugEventLineSchema.safeParse({
      ...validBase,
      model: "kimi",
      tokens: null,
    });
    expect(r.success).toBe(false);
  });

  it("aceita model=null com tokens.in == 0 (stub explícito)", () => {
    const r = DebugEventLineSchema.safeParse({
      ...validBase,
      model: null,
      tokens: { in: 0, out: 0, reasoning: 0 },
    });
    expect(r.success).toBe(true);
  });
});

describe("validateDebugEventLine — helper function", () => {
  it("retorna {ok: true} para evento válido", () => {
    const r = validateDebugEventLine(validBase);
    expect(r.ok).toBe(true);
  });

  it("retorna {ok: false, errors} para inválido", () => {
    const r = validateDebugEventLine({
      ...validBase,
      model: "kimi",
      tokens: { in: 0, out: 0, reasoning: 0 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });
});
