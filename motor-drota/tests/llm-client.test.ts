/**
 * Tests do motor-drota llm-client (motor#19 + motor#20).
 *
 * Cobre:
 *   - LlmCallResult shape — motor#19
 *   - max_tokens=2048 default + 4096 pra reasoning models — motor#19
 *   - Captura campo `reasoning` (Infomaniak Kimi/DeepSeek-R1) — motor#19
 *   - Timeout 90s default + maxRetries — motor#20
 *
 * Mocka openai SDK.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const captured: { params?: unknown; options?: unknown } = {};
let mockResponse: unknown = null;

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: async (params: unknown, options?: unknown) => {
            captured.params = params;
            captured.options = options;
            return mockResponse;
          },
        },
      };
    },
  };
});

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  captured.params = undefined;
  captured.options = undefined;
  mockResponse = null;
  delete process.env["MOTOR_DROTA_MODEL"];
  delete process.env["ASC_LLM_TIMEOUT_DROTA"];
  process.env["INFOMANIAK_API_KEY"] = "test-key";
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
});

describe("motor-drota.callLlm — motor#19 + motor#20", () => {
  it("retorna LlmCallResult com content + tokens", async () => {
    mockResponse = {
      choices: [{ message: { content: "Hello" } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.content).toBe("Hello");
    expect(r.tokens.in).toBe(100);
    expect(r.tokens.out).toBe(50);
    expect(r.reasoning).toBeUndefined();
  });

  it("captura reasoning de message.reasoning (Kimi K2.5/DeepSeek-R1)", async () => {
    mockResponse = {
      choices: [{ message: { content: "Final answer", reasoning: "Let me think step by step..." } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.content).toBe("Final answer");
    expect(r.reasoning).toBe("Let me think step by step...");
  });

  it("max_tokens=2048 pra modelo non-reasoning (mistral3)", async () => {
    process.env["MOTOR_DROTA_MODEL"] = "mistral3";
    mockResponse = {
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.params as { max_tokens: number }).max_tokens).toBe(2048);
  });

  it("max_tokens=4096 pra Kimi K2.5 (heurística reasoning)", async () => {
    process.env["MOTOR_DROTA_MODEL"] = "moonshotai/Kimi-K2.5";
    mockResponse = {
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.params as { max_tokens: number }).max_tokens).toBe(4096);
  });

  it("max_tokens=4096 pra DeepSeek-R1", async () => {
    process.env["MOTOR_DROTA_MODEL"] = "deepseek-r1";
    mockResponse = {
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.params as { max_tokens: number }).max_tokens).toBe(4096);
  });

  it("content null → fallback '{}'", async () => {
    mockResponse = {
      choices: [{ message: { content: null } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.content).toBe("{}");
  });

  it("timeout default 90s (drota)", async () => {
    mockResponse = {
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.options as { timeout: number }).timeout).toBe(90_000);
  });

  it("ASC_LLM_TIMEOUT_DROTA override (motor#20)", async () => {
    process.env["ASC_LLM_TIMEOUT_DROTA"] = "30";
    mockResponse = {
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.options as { timeout: number }).timeout).toBe(30_000);
  });

  it("maxRetries=2 default (drota — fail-fast em reasoning)", async () => {
    mockResponse = {
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.options as { maxRetries: number }).maxRetries).toBe(2);
  });
});
