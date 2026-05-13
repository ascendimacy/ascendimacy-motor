/**
 * Tests do llm-config — robustness primitives (motor#20) + pricing/cost (Sprint 0 PR1, motor#71).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getLlmTimeoutMs,
  getLlmMaxRetries,
  classifyLlmError,
  LLM_TIMEOUT_DEFAULTS,
  LLM_MAX_RETRIES_DEFAULTS,
  getPricesForModel,
  calculateCostUsd,
  PRICING_TABLE_METADATA,
} from "../src/llm-config.js";

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("ASC_LLM_")) delete process.env[k];
  }
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("ASC_LLM_")) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (k.startsWith("ASC_LLM_")) process.env[k] = v;
  }
});

describe("getLlmTimeoutMs", () => {
  it("retorna default quando sem env override", () => {
    expect(getLlmTimeoutMs("planejador")).toBe(LLM_TIMEOUT_DEFAULTS["planejador"]);
    expect(getLlmTimeoutMs("drota")).toBe(LLM_TIMEOUT_DEFAULTS["drota"]);
  });

  it("respeita ASC_LLM_TIMEOUT_<STEP> em segundos", () => {
    process.env["ASC_LLM_TIMEOUT_DROTA"] = "120";
    expect(getLlmTimeoutMs("drota")).toBe(120_000);
  });

  it("converte step com hífen pra underscore no env var", () => {
    process.env["ASC_LLM_TIMEOUT_HAIKU_TRIAGE"] = "20";
    expect(getLlmTimeoutMs("haiku-triage")).toBe(20_000);
  });

  it("ASC_LLM_TIMEOUT_SECONDS aplica globalmente como fallback", () => {
    process.env["ASC_LLM_TIMEOUT_SECONDS"] = "60";
    expect(getLlmTimeoutMs("planejador")).toBe(60_000);
    expect(getLlmTimeoutMs("drota")).toBe(60_000);
  });

  it("per-step override beats global", () => {
    process.env["ASC_LLM_TIMEOUT_SECONDS"] = "60";
    process.env["ASC_LLM_TIMEOUT_DROTA"] = "180";
    expect(getLlmTimeoutMs("drota")).toBe(180_000);
    expect(getLlmTimeoutMs("planejador")).toBe(60_000);
  });

  it("step desconhecido → 30s fallback", () => {
    expect(getLlmTimeoutMs("unknown-step")).toBe(30_000);
  });

  it("env var inválido (não numérico) → ignora e usa default", () => {
    process.env["ASC_LLM_TIMEOUT_DROTA"] = "abc";
    expect(getLlmTimeoutMs("drota")).toBe(LLM_TIMEOUT_DEFAULTS["drota"]);
  });

  it("env var negativo → ignora e usa default", () => {
    process.env["ASC_LLM_TIMEOUT_DROTA"] = "-5";
    expect(getLlmTimeoutMs("drota")).toBe(LLM_TIMEOUT_DEFAULTS["drota"]);
  });
});

describe("getLlmMaxRetries", () => {
  it("retorna default por step", () => {
    expect(getLlmMaxRetries("planejador")).toBe(LLM_MAX_RETRIES_DEFAULTS["planejador"]);
    expect(getLlmMaxRetries("drota")).toBe(LLM_MAX_RETRIES_DEFAULTS["drota"]);
  });

  it("respeita override per-step", () => {
    process.env["ASC_LLM_MAX_RETRIES_DROTA"] = "5";
    expect(getLlmMaxRetries("drota")).toBe(5);
  });

  it("aceita 0 retries", () => {
    process.env["ASC_LLM_MAX_RETRIES_PLANEJADOR"] = "0";
    expect(getLlmMaxRetries("planejador")).toBe(0);
  });

  it("step desconhecido → 2 fallback", () => {
    expect(getLlmMaxRetries("unknown")).toBe(2);
  });
});

describe("classifyLlmError", () => {
  it("AbortError ou message contém 'timeout' → TimeoutError, não retriable", () => {
    const e = Object.assign(new Error("Request timeout"), { name: "AbortError" });
    const r = classifyLlmError(e);
    expect(r.class).toBe("TimeoutError");
    expect(r.retriable).toBe(false);
  });

  it("status 401 → AuthError, não retriable", () => {
    const r = classifyLlmError({ status: 401, name: "Error" });
    expect(r.class).toBe("AuthError");
    expect(r.retriable).toBe(false);
  });

  it("status 403 → AuthError", () => {
    const r = classifyLlmError({ status: 403 });
    expect(r.class).toBe("AuthError");
    expect(r.retriable).toBe(false);
  });

  it("status 400 → BadRequestError, não retriable", () => {
    const r = classifyLlmError({ status: 400 });
    expect(r.class).toBe("BadRequestError");
    expect(r.retriable).toBe(false);
  });

  it("status 429 → RateLimitError, retriable", () => {
    const r = classifyLlmError({ status: 429 });
    expect(r.class).toBe("RateLimitError");
    expect(r.retriable).toBe(true);
  });

  it("status 500-599 → ServerError, retriable", () => {
    expect(classifyLlmError({ status: 500 }).retriable).toBe(true);
    expect(classifyLlmError({ status: 503 }).retriable).toBe(true);
    expect(classifyLlmError({ status: 599 }).retriable).toBe(true);
  });

  it("ECONN/ENOTFOUND/FetchError → NetworkError, retriable", () => {
    expect(classifyLlmError({ message: "ECONNRESET" }).retriable).toBe(true);
    expect(classifyLlmError({ name: "FetchError", message: "fetch failed" }).retriable).toBe(true);
  });

  it("LengthFinish error não retriable (problema de prompt, não transient)", () => {
    const e = { message: "Could not parse response content as the length limit was reached" };
    const r = classifyLlmError(e);
    expect(r.class).toBe("LengthFinishError");
    expect(r.retriable).toBe(false);
  });

  it("erro nulo/undefined → UnknownError", () => {
    expect(classifyLlmError(null).class).toBe("UnknownError");
    expect(classifyLlmError(undefined).class).toBe("UnknownError");
  });

  it("erro 4xx genérico (não auth/bad/rate-limit) → fail fast", () => {
    const r = classifyLlmError({ status: 404 });
    expect(r.retriable).toBe(false);
  });
});

// ============================================================================
// Sprint 0 PR1 (motor#71) — Pricing + Cost calc tests
// Stories: ops#498 (S-J-01-01) + ops#499 (S-J-01-02)
// Capability: ops#483 (C-J-01)
// ============================================================================

describe("getPricesForModel — production model strings", () => {
  it("retorna preços para qwen3-8b (LLM local, custo zero)", () => {
    const p = getPricesForModel("qwen3-8b");
    expect(p).not.toBeNull();
    expect(p!.price_in_per_token).toBe(0);
    expect(p!.price_out_per_token).toBe(0);
  });

  it("retorna preços para moonshotai/Kimi-K2.5 (Infomaniak)", () => {
    const p = getPricesForModel("moonshotai/Kimi-K2.5");
    expect(p).not.toBeNull();
    expect(p!.price_in_per_token).toBeGreaterThan(0);
    expect(p!.price_out_per_token).toBeGreaterThan(0);
    expect(p!.price_out_per_token).toBeGreaterThanOrEqual(p!.price_in_per_token);
  });

  it("retorna preços para mistral3 (Mistral-Small-3.2-24B Infomaniak)", () => {
    const p = getPricesForModel("mistral3");
    expect(p).not.toBeNull();
    expect(p!.price_in_per_token).toBeGreaterThan(0);
    expect(p!.price_out_per_token).toBeGreaterThan(0);
  });

  it("retorna preços para claude-haiku-4-5-20251001 (Anthropic, model string com data suffix)", () => {
    const p = getPricesForModel("claude-haiku-4-5-20251001");
    expect(p).not.toBeNull();
    expect(p!.price_in_per_token).toBeGreaterThan(0);
    expect(p!.price_out_per_token).toBeGreaterThan(0);
  });

  it("retorna preços para claude-sonnet-4-6 (Anthropic fallback)", () => {
    const p = getPricesForModel("claude-sonnet-4-6");
    expect(p).not.toBeNull();
    expect(p!.price_in_per_token).toBeGreaterThan(0);
    expect(p!.price_out_per_token).toBeGreaterThan(0);
  });

  it("retorna null para modelo desconhecido", () => {
    expect(getPricesForModel("modelo-fictício-zzz")).toBeNull();
  });

  it("retorna null para string vazia", () => {
    expect(getPricesForModel("")).toBeNull();
  });

  it("kimi output > kimi input (reasoning models cobram mais por output)", () => {
    const p = getPricesForModel("moonshotai/Kimi-K2.5");
    expect(p).not.toBeNull();
    expect(p!.price_out_per_token).toBeGreaterThan(p!.price_in_per_token);
  });
});

describe("PRICING_TABLE_METADATA", () => {
  it("expõe data ISO da última atualização", () => {
    expect(PRICING_TABLE_METADATA.last_updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("expõe fonte/origem dos preços", () => {
    expect(PRICING_TABLE_METADATA.source).toBeTruthy();
    expect(typeof PRICING_TABLE_METADATA.source).toBe("string");
  });

  it("expõe versão da tabela", () => {
    expect(PRICING_TABLE_METADATA.version).toMatch(/^v\d+\.\d+$/);
  });
});

describe("calculateCostUsd — aritmética de cost (S-J-01-02)", () => {
  it("retorna null para model=null", () => {
    expect(calculateCostUsd(null, 100, 50)).toBeNull();
  });

  it("retorna null para modelo desconhecido (warn implícito)", () => {
    expect(calculateCostUsd("modelo-fictício-xyz", 100, 50)).toBeNull();
  });

  it("calcula cost para qwen3-8b: tokens × 0 = 0 (LLM local)", () => {
    expect(calculateCostUsd("qwen3-8b", 1000, 500)).toBe(0);
    expect(calculateCostUsd("qwen3-8b", 99999, 99999)).toBe(0);
  });

  it("calcula cost para moonshotai/Kimi-K2.5 com tokens reais", () => {
    const cost = calculateCostUsd("moonshotai/Kimi-K2.5", 1000, 500);
    expect(cost).not.toBeNull();
    expect(cost!).toBeGreaterThan(0);
    // Verifica fórmula: (1000 × p_in) + (500 × p_out)
    const p = getPricesForModel("moonshotai/Kimi-K2.5")!;
    expect(cost).toBeCloseTo(1000 * p.price_in_per_token + 500 * p.price_out_per_token, 10);
  });

  it("calcula cost para claude-haiku-4-5-20251001", () => {
    const cost = calculateCostUsd("claude-haiku-4-5-20251001", 1648, 48);
    expect(cost).not.toBeNull();
    expect(cost!).toBeGreaterThan(0);
  });

  it("aritmética simétrica: tokensIn=N tokensOut=0 vs invertido (preços normalmente diferentes)", () => {
    const costInOnly = calculateCostUsd("moonshotai/Kimi-K2.5", 1000, 0);
    const costOutOnly = calculateCostUsd("moonshotai/Kimi-K2.5", 0, 1000);
    expect(costInOnly).not.toBeNull();
    expect(costOutOnly).not.toBeNull();
    // Output normalmente cobra mais que input em reasoning models
    expect(costOutOnly!).toBeGreaterThan(costInOnly!);
  });

  it("tokens negativos tratam como 0 (defensivo)", () => {
    // Não deveria acontecer em produção, mas não deve quebrar
    const cost = calculateCostUsd("moonshotai/Kimi-K2.5", -100, -50);
    // Aceita 0 ou cost negativo determinístico — apenas não pode crashar
    expect(typeof cost === "number" || cost === null).toBe(true);
  });

  // D-3-PROV (ops#1055): provider=openai-compat → 0 mesmo p/ modelo desconhecido.
  it("provider=openai-compat → 0 mesmo para modelo desconhecido (LLM local)", () => {
    // qwen3-30b não está cadastrado no PRICING_TABLE; sem o provider seria null.
    expect(calculateCostUsd("qwen3-30b", 1000, 500, "openai-compat")).toBe(0);
    expect(calculateCostUsd("ministral-q4", 50000, 20000, "openai-compat")).toBe(0);
    // null model + openai-compat ainda assim → 0 (distinção do "modelo unknown").
    expect(calculateCostUsd(null, 1000, 500, "openai-compat")).toBe(0);
  });

  it("provider=openai-compat respeita zero-tokens override (S-J-01-03)", () => {
    // Mesmo openai-compat com 0 tokens retorna 0 (curto-circuito anterior).
    expect(calculateCostUsd("qwen3-30b", 0, 0, "openai-compat")).toBe(0);
  });

  it("provider=anthropic/infomaniak: comportamento legado preservado (back-compat)", () => {
    // Passar provider explícito mas conhecido NÃO muda a lógica do PRICING_TABLE.
    expect(calculateCostUsd("modelo-desconhecido", 100, 50, "infomaniak")).toBeNull();
    expect(calculateCostUsd("modelo-desconhecido", 100, 50, "anthropic")).toBeNull();
    // Modelo conhecido + provider explícito: aritmética normal.
    const cost = calculateCostUsd("moonshotai/Kimi-K2.5", 1000, 500, "infomaniak");
    expect(cost).not.toBeNull();
    expect(cost!).toBeGreaterThan(0);
  });

  it("provider omitido: caller pré-D-3-PROV continua funcionando (back-compat)", () => {
    // Garantia explícita: o parâmetro provider é opcional.
    expect(calculateCostUsd("qwen3-8b", 1000, 500)).toBe(0); // via PRICING_TABLE
    expect(calculateCostUsd("modelo-desconhecido", 100, 50)).toBeNull();
  });
});

// ============================================================================
// Sprint 0 PR2 (motor#73) — S-J-01-03 zero-tokens short-circuit
// Stories: ops#500 (S-J-01-03)
// "Distingue 'sem tokens' (custo zero) de 'modelo desconhecido' (custo null)"
// ============================================================================

describe("calculateCostUsd — S-J-01-03 zero tokens distinguishing", () => {
  it("tokens=(0,0) com model=null → 0 (sem tokens, custo zero)", () => {
    // Step stub sem LLM call: model=null mas tokens=(0,0). Cost deve ser 0,
    // não null — "sem tokens consumidos" é informação certa, não ambígua.
    expect(calculateCostUsd(null, 0, 0)).toBe(0);
  });

  it("tokens=(0,0) com modelo desconhecido → 0 (zero tokens overrides unknown model)", () => {
    // Mesmo se o modelo é desconhecido, se NENHUM token foi usado, custo é 0.
    // Determinístico — não há razão para retornar null.
    expect(calculateCostUsd("modelo-fictício-xyz", 0, 0)).toBe(0);
  });

  it("tokens=(0,0) com modelo conhecido → 0", () => {
    expect(calculateCostUsd("moonshotai/Kimi-K2.5", 0, 0)).toBe(0);
    expect(calculateCostUsd("claude-haiku-4-5-20251001", 0, 0)).toBe(0);
    expect(calculateCostUsd("mistral3", 0, 0)).toBe(0);
  });

  it("tokens=(N,0) → cost positivo (in only)", () => {
    const cost = calculateCostUsd("moonshotai/Kimi-K2.5", 100, 0);
    expect(cost).not.toBeNull();
    expect(cost!).toBeGreaterThan(0);
  });

  it("tokens=(0,N) → cost positivo (out only)", () => {
    const cost = calculateCostUsd("moonshotai/Kimi-K2.5", 0, 100);
    expect(cost).not.toBeNull();
    expect(cost!).toBeGreaterThan(0);
  });

  it("preserva: model=null com tokens > 0 → null (modelo necessário pra calcular)", () => {
    // Caso contrário: tokens existem mas modelo desconhecido → não dá pra
    // calcular cost → null (mantém comportamento PR1).
    expect(calculateCostUsd(null, 100, 50)).toBeNull();
  });

  it("preserva: modelo desconhecido com tokens > 0 → null (warn implícito)", () => {
    expect(calculateCostUsd("modelo-fictício-xyz", 100, 50)).toBeNull();
  });

  it("tokens negativos = 0 → 0 (Math.max defensivo)", () => {
    // Negativos viram 0, e (0,0) → 0 pelo short-circuit
    expect(calculateCostUsd("moonshotai/Kimi-K2.5", -100, -50)).toBe(0);
    expect(calculateCostUsd(null, -100, -50)).toBe(0);
  });
});
