/**
 * Tests motor-drota llm-client (motor#28b — gateway integration).
 *
 * ANTES (motor#19+25): mockava SDK OpenAI direto. Tests verificavam timeout,
 * maxRetries, params.max_tokens — tudo concern de motor-drota.
 *
 * AGORA (motor#28b): motor-drota é proxy fino sobre `callGateway`. Tests
 * mockam `callGateway` e verificam:
 *   - input correto passado ao gateway (step, provider, model, maxTokens, cacheableSystemPrefix)
 *   - output do gateway mapeado certo pra LlmCallResult
 *   - reasoning + cacheRead/cacheCreation forwardados transparentes
 *
 * Timeout/maxRetries/retry/fallback ficam testados em llm-gateway/tests/.
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
  delete process.env["MOTOR_DROTA_MODEL"];
  delete process.env["DROTA_PROVIDER"];
  delete process.env["DROTA_MODEL"];
  process.env["INFOMANIAK_API_KEY"] = "test-key";
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
});

describe("motor-drota.callLlm — motor#28b gateway integration", () => {
  it("retorna LlmCallResult com content + tokens via gateway", async () => {
    mockResponse = {
      content: "Hello",
      tokens: { in: 100, out: 50, reasoning: 0 },
      provider: "infomaniak",
      model: "moonshotai/Kimi-K2.5",
      latency_ms: 10,
      attempt_count: 1,
      was_fallback: false,
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.content).toBe("Hello");
    expect(r.tokens.in).toBe(100);
    expect(r.tokens.out).toBe(50);
    expect(r.reasoning).toBeUndefined();
    expect(r.provider).toBe("infomaniak");
  });

  it("forward reasoning do gateway pra LlmCallResult", async () => {
    mockResponse = {
      ...mockResponse,
      reasoning: "Let me think step by step...",
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.reasoning).toBe("Let me think step by step...");
  });

  it("passa step=drota + provider/model/maxTokens corretos pro gateway", async () => {
    process.env["MOTOR_DROTA_MODEL"] = "moonshotai/Kimi-K2.5";
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("system", "user");
    expect(captured.req).toBeDefined();
    expect(captured.req!.step).toBe("drota");
    expect(captured.req!.provider).toBe("infomaniak"); // default
    expect(captured.req!.model).toBe("moonshotai/Kimi-K2.5");
    expect(captured.req!.maxTokens).toBe(4096); // reasoning model heuristic
    expect(captured.req!.systemPrompt).toBe("system");
    expect(captured.req!.userMessage).toBe("user");
  });

  it("max_tokens=2048 pra modelo non-reasoning (mistral3) passado pro gateway", async () => {
    process.env["MOTOR_DROTA_MODEL"] = "mistral3";
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect(captured.req!.maxTokens).toBe(2048);
  });

  it("propaga ASC_DEBUG_RUN_ID como run_id no gateway input", async () => {
    process.env["ASC_DEBUG_RUN_ID"] = "test-run-xyz";
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect(captured.req!.run_id).toBe("test-run-xyz");
  });
});

// motor#25 prompt cache forward — preservado em motor#28b
describe("motor-drota.callLlm — cacheableSystemPrefix (motor#25 forward via gateway)", () => {
  it("passa cacheableSystemPrefix pro gateway sem modificar", async () => {
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("DYNAMIC_BODY", "user msg", {
      cacheableSystemPrefix: "STABLE_PREFIX",
    });
    expect(captured.req!.cacheableSystemPrefix).toBe("STABLE_PREFIX");
    expect(captured.req!.systemPrompt).toBe("DYNAMIC_BODY");
  });

  it("sem cacheableSystemPrefix, gateway recebe undefined", async () => {
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("just system", "user");
    expect(captured.req!.cacheableSystemPrefix).toBeUndefined();
    expect(captured.req!.systemPrompt).toBe("just system");
  });

  it("forward cacheRead do gateway tokens", async () => {
    mockResponse = {
      ...mockResponse,
      tokens: { in: 1000, out: 50, reasoning: 0, cacheRead: 800 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.tokens.cacheRead).toBe(800);
  });

  it("forward cacheCreation do gateway tokens (Anthropic-only)", async () => {
    mockResponse = {
      ...mockResponse,
      tokens: { in: 1000, out: 50, reasoning: 0, cacheCreation: 200, cacheRead: 0 },
      provider: "anthropic",
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.tokens.cacheCreation).toBe(200);
  });

  it("cacheRead undefined quando gateway não reporta cached_tokens", async () => {
    mockResponse = {
      ...mockResponse,
      tokens: { in: 100, out: 50, reasoning: 0 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.tokens.cacheRead).toBeUndefined();
  });
});
