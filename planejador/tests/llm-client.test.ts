/**
 * Tests planejador llm-client (motor#28c — gateway integration).
 *
 * ANTES (motor#21): mockava SDK Anthropic + OpenAI direto.
 *
 * AGORA (motor#28c): planejador é proxy fino sobre `callGateway`. Tests
 * mockam `callGateway` e verificam:
 *   - input correto passado ao gateway (step, provider, model, maxTokens)
 *   - output do gateway mapeado certo pra LlmCallResult
 *   - reasoning forwardado transparente
 *   - thinking forwardado quando debug mode + provider=anthropic
 *
 * Timeout/maxRetries/retry/fallback ficam em llm-gateway/tests/router.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GatewayChatCompletionInput, GatewayChatCompletionOutput } from "@ascendimacy/shared";

const captured: { req?: GatewayChatCompletionInput } = {};
let mockResponse: GatewayChatCompletionOutput;

vi.mock("@ascendimacy/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ascendimacy/shared")>();
  return {
    ...actual,
    callGateway: async (req: GatewayChatCompletionInput) => {
      captured.req = req;
      return mockResponse;
    },
  };
});

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  captured.req = undefined;
  mockResponse = {
    content: "Hello",
    tokens: { in: 100, out: 50, reasoning: 0 },
    provider: "infomaniak",
    model: "moonshotai/Kimi-K2.5",
    latency_ms: 10,
    attempt_count: 1,
    was_fallback: false,
  };
  delete process.env["ASC_DEBUG_MODE"];
  delete process.env["PLANEJADOR_PROVIDER"];
  delete process.env["PLANEJADOR_MODEL"];
  delete process.env["LLM_PROVIDER"];
  delete process.env["HAIKU_TRIAGE_PROVIDER"];
  delete process.env["HAIKU_TRIAGE_MODEL"];
  process.env["ANTHROPIC_API_KEY"] = "test-key";
  process.env["INFOMANIAK_API_KEY"] = "test-info-key";
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
});

describe("planejador.callLlm — provider DEFAULT (Infomaniak / Kimi K2.5)", () => {
  it("passa step=planejador + provider=infomaniak + model Kimi-K2.5 default", async () => {
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("system", "user");
    expect(r.content).toBe("Hello");
    expect(captured.req!.step).toBe("planejador");
    expect(captured.req!.provider).toBe("infomaniak");
    expect(captured.req!.model).toBe("moonshotai/Kimi-K2.5");
  });

  it("forward reasoning do gateway pra LlmCallResult", async () => {
    mockResponse = { ...mockResponse, reasoning: "Chain of thought..." };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.reasoning).toBe("Chain of thought...");
  });

  it("max_tokens=4096 pra Kimi (reasoning model heuristic) passado pro gateway", async () => {
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect(captured.req!.maxTokens).toBe(4096);
  });

  it("PLANEJADOR_MODEL override aplicado + max_tokens 2048 (non-reasoning)", async () => {
    process.env["PLANEJADOR_MODEL"] = "mistral3";
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect(captured.req!.model).toBe("mistral3");
    expect(captured.req!.maxTokens).toBe(2048);
  });

  it("propaga ASC_DEBUG_RUN_ID como run_id no gateway input", async () => {
    process.env["ASC_DEBUG_RUN_ID"] = "test-run-planejador";
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect(captured.req!.run_id).toBe("test-run-planejador");
  });
});

describe("planejador.callLlm — provider OVERRIDE (Anthropic)", () => {
  beforeEach(() => {
    process.env["PLANEJADOR_PROVIDER"] = "anthropic";
  });

  it("passa provider=anthropic + model claude-sonnet-4-6 (fallback default)", async () => {
    mockResponse = { ...mockResponse, provider: "anthropic", model: "claude-sonnet-4-6" };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(captured.req!.provider).toBe("anthropic");
    expect(captured.req!.model).toBe("claude-sonnet-4-6");
    expect(r.provider).toBe("anthropic");
  });

  it("max_tokens=2048 pra Sonnet (não reasoning na heurística)", async () => {
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect(captured.req!.maxTokens).toBe(2048);
  });

  it("thinking ON com budget 1024 em debug mode", async () => {
    process.env["ASC_DEBUG_MODE"] = "true";
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect(captured.req!.enableThinking).toBe(true);
    expect(captured.req!.thinkingBudgetTokens).toBe(1024);
  });

  it("thinking OFF default (debug off) — enableThinking não é setado", async () => {
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect(captured.req!.enableThinking).toBeUndefined();
  });

  it("forward reasoning do gateway (gateway extrai thinking blocks)", async () => {
    mockResponse = {
      ...mockResponse,
      reasoning: "I should...",
      content: "Answer",
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.content).toBe("Answer");
    expect(r.reasoning).toBe("I should...");
  });
});

describe("planejador.callHaiku — triage", () => {
  it("default Infomaniak / mistral3 com max_tokens=512", async () => {
    mockResponse = {
      ...mockResponse,
      content: '{"ranking":["a"]}',
      provider: "infomaniak",
      model: "mistral3",
    };
    const { callHaiku } = await import("../src/llm-client.js");
    const r = await callHaiku("s", "u");
    expect(captured.req!.step).toBe("haiku-triage");
    expect(captured.req!.provider).toBe("infomaniak");
    expect(captured.req!.model).toBe("mistral3");
    expect(captured.req!.maxTokens).toBe(512);
    expect(r.provider).toBe("infomaniak");
  });

  it("HAIKU_TRIAGE_PROVIDER=anthropic → Claude Haiku, thinking sempre OFF", async () => {
    process.env["HAIKU_TRIAGE_PROVIDER"] = "anthropic";
    process.env["ASC_DEBUG_MODE"] = "true";
    mockResponse = {
      ...mockResponse,
      content: '{"ranking":["a"]}',
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
    };
    const { callHaiku } = await import("../src/llm-client.js");
    await callHaiku("s", "u");
    expect(captured.req!.provider).toBe("anthropic");
    expect(captured.req!.model).toBe("claude-haiku-4-5-20251001");
    expect(captured.req!.maxTokens).toBe(512);
    // Thinking sempre OFF em haiku-triage (mesmo com debug ON)
    expect(captured.req!.enableThinking).toBeUndefined();
  });
});
