/**
 * Tests do llm-config (motor#20) — robustness primitives.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getLlmTimeoutMs,
  getLlmMaxRetries,
  classifyLlmError,
  LLM_TIMEOUT_DEFAULTS,
  LLM_MAX_RETRIES_DEFAULTS,
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
