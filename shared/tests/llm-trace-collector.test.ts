/**
 * Tests TV2-2 — llm-trace-collector wrapper sobre callGateway.
 *
 * Mocka callGateway via vi.mock pra evitar I/O real. Cobre:
 *   - collector undefined = transparent
 *   - sucesso captura prompt/response/tokens/cache_hit
 *   - erro captura err + re-throws
 *   - redaction via env quando MOTOR_TRACE_REDACT_PII=true
 *   - provider mapping (openai-compat → local)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createLlmTraceCollector,
  callGatewayWithTracing,
  mapGatewayProviderToTrace,
  buildPromptText,
  shouldRedactPii,
} from "../src/llm-trace-collector.js";
import type {
  GatewayChatCompletionInput,
  GatewayChatCompletionOutput,
} from "../src/gateway-client.js";

vi.mock("../src/gateway-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/gateway-client.js")>();
  return {
    ...actual,
    callGateway: vi.fn(),
  };
});

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const gatewayMod = await import("../src/gateway-client.js");
const mockedCallGateway = vi.mocked(gatewayMod.callGateway);

const reqFixture = (): GatewayChatCompletionInput => ({
  step: "assessor",
  systemPrompt: "Be helpful.",
  userMessage: "Como você se sente?",
});

const outputFixture = (
  overrides: Partial<GatewayChatCompletionOutput> = {},
): GatewayChatCompletionOutput => ({
  content: "Me sinto bem.",
  tokens: { in: 100, out: 20, reasoning: 0 },
  provider: "anthropic",
  model: "claude-opus-4-7",
  latency_ms: 1234,
  attempt_count: 1,
  was_fallback: false,
  ...overrides,
});

beforeEach(() => {
  mockedCallGateway.mockReset();
  delete process.env["MOTOR_TRACE_REDACT_PII"];
});

afterEach(() => {
  delete process.env["MOTOR_TRACE_REDACT_PII"];
});

describe("createLlmTraceCollector", () => {
  it("começa vazio", () => {
    const c = createLlmTraceCollector();
    expect(c.size()).toBe(0);
    expect(c.peek()).toEqual([]);
  });

  it("drain limpa e retorna calls", () => {
    const c = createLlmTraceCollector();
    c.push({
      id: "x",
      role: "assessor",
      provider: "local",
      model: "qwen14b",
      prompt: "p",
      response: "r",
      duration_ms: 100,
    });
    expect(c.size()).toBe(1);
    const drained = c.drain();
    expect(drained).toHaveLength(1);
    expect(c.size()).toBe(0);
  });
});

describe("mapGatewayProviderToTrace", () => {
  it("anthropic → anthropic", () => {
    expect(mapGatewayProviderToTrace("anthropic")).toBe("anthropic");
  });
  it("infomaniak → infomaniak", () => {
    expect(mapGatewayProviderToTrace("infomaniak")).toBe("infomaniak");
  });
  it("openai-compat → local", () => {
    expect(mapGatewayProviderToTrace("openai-compat")).toBe("local");
  });
});

describe("buildPromptText", () => {
  it("concatena system + user", () => {
    const text = buildPromptText({
      step: "assessor",
      systemPrompt: "Be kind.",
      userMessage: "hi",
    });
    expect(text).toContain("[SYSTEM]\nBe kind.");
    expect(text).toContain("[USER]\nhi");
  });

  it("inclui cacheableSystemPrefix quando presente", () => {
    const text = buildPromptText({
      step: "drota",
      cacheableSystemPrefix: "STABLE_PREFIX",
      systemPrompt: "extra",
      userMessage: "u",
    });
    expect(text).toContain("[CACHEABLE PREFIX]\nSTABLE_PREFIX");
    expect(text).toContain("[SYSTEM]\nextra");
    expect(text).toContain("[USER]\nu");
  });
});

describe("shouldRedactPii", () => {
  it("false por default", () => {
    expect(shouldRedactPii()).toBe(false);
  });
  it("true quando env=true", () => {
    process.env["MOTOR_TRACE_REDACT_PII"] = "true";
    expect(shouldRedactPii()).toBe(true);
  });
  it("false quando env=anything-else", () => {
    process.env["MOTOR_TRACE_REDACT_PII"] = "yes";
    expect(shouldRedactPii()).toBe(false);
  });
});

describe("callGatewayWithTracing — transparent path", () => {
  it("sem collector, comporta-se como callGateway (mesmo retorno)", async () => {
    mockedCallGateway.mockResolvedValueOnce(outputFixture());
    const result = await callGatewayWithTracing(reqFixture(), "assessor");
    expect(result.content).toBe("Me sinto bem.");
    expect(mockedCallGateway).toHaveBeenCalledTimes(1);
  });
});

describe("callGatewayWithTracing — collector path", () => {
  it("captura sucesso completo: prompt, response, tokens, ms, model", async () => {
    mockedCallGateway.mockResolvedValueOnce(
      outputFixture({
        provider: "infomaniak",
        model: "qwen3-coder",
        latency_ms: 999,
        tokens: { in: 50, out: 10, reasoning: 0 },
      }),
    );
    const c = createLlmTraceCollector();
    await callGatewayWithTracing(reqFixture(), "assessor", c);
    const calls = c.drain();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      role: "assessor",
      provider: "infomaniak",
      model: "qwen3-coder",
      duration_ms: 999,
      input_tokens: 50,
      output_tokens: 10,
    });
    expect(calls[0].prompt).toContain("Be helpful.");
    expect(calls[0].prompt).toContain("Como você se sente?");
    expect(calls[0].response).toBe("Me sinto bem.");
    expect(calls[0].id).toMatch(/^llm-[a-f0-9]+$/);
  });

  it("captura prompt_cache_hit quando cacheRead > 0", async () => {
    mockedCallGateway.mockResolvedValueOnce(
      outputFixture({
        tokens: { in: 100, out: 20, reasoning: 0, cacheRead: 80 },
      }),
    );
    const c = createLlmTraceCollector();
    await callGatewayWithTracing(reqFixture(), "materializer", c);
    expect(c.peek()[0]?.prompt_cache_hit).toBe(true);
  });

  it("NÃO marca prompt_cache_hit quando cacheRead=0 ou ausente", async () => {
    mockedCallGateway.mockResolvedValueOnce(outputFixture());
    const c = createLlmTraceCollector();
    await callGatewayWithTracing(reqFixture(), "materializer", c);
    expect(c.peek()[0]?.prompt_cache_hit).toBeUndefined();
  });

  it("mapeia openai-compat → local", async () => {
    mockedCallGateway.mockResolvedValueOnce(
      outputFixture({ provider: "openai-compat", model: "qwen14b" }),
    );
    const c = createLlmTraceCollector();
    await callGatewayWithTracing(reqFixture(), "assessor", c);
    expect(c.peek()[0]?.provider).toBe("local");
  });

  it("erro: captura LlmCallTrace com error + re-throws", async () => {
    mockedCallGateway.mockRejectedValueOnce(new Error("gateway timeout"));
    const c = createLlmTraceCollector();
    await expect(
      callGatewayWithTracing(reqFixture(), "assessor", c),
    ).rejects.toThrow("gateway timeout");
    expect(c.size()).toBe(1);
    expect(c.peek()[0]?.error).toBe("gateway timeout");
    expect(c.peek()[0]?.response).toBe("");
  });

  it("acumula múltiplas chamadas em sequência", async () => {
    mockedCallGateway
      .mockResolvedValueOnce(outputFixture({ provider: "local", model: "qwen14b" }))
      .mockResolvedValueOnce(outputFixture({ provider: "anthropic" }));
    const c = createLlmTraceCollector();
    await callGatewayWithTracing(reqFixture(), "assessor", c);
    await callGatewayWithTracing(reqFixture(), "materializer", c);
    expect(c.size()).toBe(2);
    expect(c.peek()[0]?.role).toBe("assessor");
    expect(c.peek()[1]?.role).toBe("materializer");
  });
});

describe("callGatewayWithTracing — redaction", () => {
  it("substitui prompt + response por hashes quando env=true", async () => {
    process.env["MOTOR_TRACE_REDACT_PII"] = "true";
    mockedCallGateway.mockResolvedValueOnce(outputFixture());
    const c = createLlmTraceCollector();
    await callGatewayWithTracing(reqFixture(), "assessor", c);
    const call = c.peek()[0];
    expect(call?.prompt).toMatch(/^\[REDACTED sha256:[a-f0-9]+ len=\d+\]$/);
    expect(call?.response).toMatch(/^\[REDACTED sha256:[a-f0-9]+ len=\d+\]$/);
    expect(call?.redacted).toBe(true);
  });

  it("preserva prompt literal quando env=false (default dev)", async () => {
    mockedCallGateway.mockResolvedValueOnce(outputFixture());
    const c = createLlmTraceCollector();
    await callGatewayWithTracing(reqFixture(), "assessor", c);
    const call = c.peek()[0];
    expect(call?.prompt).toContain("Como você se sente?");
    expect(call?.redacted).toBeUndefined();
  });

  it("redaction também no erro path", async () => {
    process.env["MOTOR_TRACE_REDACT_PII"] = "true";
    mockedCallGateway.mockRejectedValueOnce(new Error("boom"));
    const c = createLlmTraceCollector();
    await expect(
      callGatewayWithTracing(reqFixture(), "assessor", c),
    ).rejects.toThrow();
    expect(c.peek()[0]?.prompt).toMatch(/^\[REDACTED/);
    expect(c.peek()[0]?.redacted).toBe(true);
  });
});
