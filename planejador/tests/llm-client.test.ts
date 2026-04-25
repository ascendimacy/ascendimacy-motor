/**
 * Tests planejador llm-client (motor#19 + motor#20 + motor#21).
 *
 * motor#21: dual-provider (Anthropic + Infomaniak via OpenAI SDK).
 * Default: Infomaniak / Kimi K2.5. Override via PLANEJADOR_PROVIDER.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const captured: { aParams?: unknown; aOptions?: unknown; oParams?: unknown; oOptions?: unknown } = {};
let mockAnthropicResponse: unknown = null;
let mockOpenAIResponse: unknown = null;

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: async (params: unknown, options?: unknown) => {
          captured.aParams = params;
          captured.aOptions = options;
          return mockAnthropicResponse;
        },
      };
    },
  };
});

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: async (params: unknown, options?: unknown) => {
            captured.oParams = params;
            captured.oOptions = options;
            return mockOpenAIResponse;
          },
        },
      };
    },
  };
});

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  captured.aParams = undefined;
  captured.aOptions = undefined;
  captured.oParams = undefined;
  captured.oOptions = undefined;
  mockAnthropicResponse = null;
  mockOpenAIResponse = null;
  delete process.env["ASC_DEBUG_MODE"];
  delete process.env["ASC_LLM_TIMEOUT_PLANEJADOR"];
  delete process.env["PLANEJADOR_PROVIDER"];
  delete process.env["PLANEJADOR_MODEL"];
  delete process.env["LLM_PROVIDER"];
  process.env["ANTHROPIC_API_KEY"] = "test-key";
  process.env["INFOMANIAK_API_KEY"] = "test-info-key";
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
});

describe("planejador.callLlm — provider DEFAULT (Infomaniak / Kimi K2.5)", () => {
  it("usa OpenAI SDK (Infomaniak) por default", async () => {
    mockOpenAIResponse = {
      choices: [{ message: { content: "Hello" } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("system", "user");
    expect(r.content).toBe("Hello");
    expect(r.provider).toBe("infomaniak");
    expect(r.model).toBe("moonshotai/Kimi-K2.5"); // default
    expect(captured.oParams).toBeDefined();
    expect(captured.aParams).toBeUndefined(); // Anthropic não foi chamado
  });

  it("captura reasoning field de Kimi/DeepSeek-R1", async () => {
    mockOpenAIResponse = {
      choices: [{ message: { content: "Final answer", reasoning: "Chain of thought..." } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.reasoning).toBe("Chain of thought...");
  });

  it("max_tokens=4096 pra Kimi (reasoning model heuristic)", async () => {
    mockOpenAIResponse = {
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.oParams as { max_tokens: number }).max_tokens).toBe(4096);
  });

  it("PLANEJADOR_MODEL override aplicado", async () => {
    process.env["PLANEJADOR_MODEL"] = "mistral3";
    mockOpenAIResponse = {
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.model).toBe("mistral3");
    expect((captured.oParams as { max_tokens: number }).max_tokens).toBe(2048); // non-reasoning
  });
});

describe("planejador.callLlm — provider OVERRIDE (Anthropic)", () => {
  beforeEach(() => {
    process.env["PLANEJADOR_PROVIDER"] = "anthropic";
  });

  it("usa Anthropic SDK quando PLANEJADOR_PROVIDER=anthropic", async () => {
    mockAnthropicResponse = {
      content: [{ type: "text", text: "Hello" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe("claude-sonnet-4-6"); // Anthropic fallback default
    expect(captured.aParams).toBeDefined();
    expect(captured.oParams).toBeUndefined();
  });

  it("max_tokens=2048 pra Sonnet (não reasoning na heurística)", async () => {
    mockAnthropicResponse = {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.aParams as { max_tokens: number }).max_tokens).toBe(2048);
  });

  it("thinking ON com budget 1024 em debug mode", async () => {
    process.env["ASC_DEBUG_MODE"] = "true";
    mockAnthropicResponse = {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.aParams as { thinking?: { budget_tokens: number } }).thinking).toEqual({
      type: "enabled",
      budget_tokens: 1024,
    });
  });

  it("thinking OFF default (debug off)", async () => {
    mockAnthropicResponse = {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.aParams as { thinking?: unknown }).thinking).toBeUndefined();
  });

  it("captura reasoning de blocks type=thinking", async () => {
    process.env["ASC_DEBUG_MODE"] = "true";
    mockAnthropicResponse = {
      content: [
        { type: "thinking", thinking: "I should..." },
        { type: "text", text: "Answer" },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.content).toBe("Answer");
    expect(r.reasoning).toBe("I should...");
  });

  it("throw quando response sem text block", async () => {
    mockAnthropicResponse = { content: [], usage: { input_tokens: 1, output_tokens: 1 } };
    const { callLlm } = await import("../src/llm-client.js");
    await expect(callLlm("s", "u")).rejects.toThrow(/no text block/);
  });

  it("timeout 30s + maxRetries 3 forwarded pra SDK options", async () => {
    mockAnthropicResponse = {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.aOptions as { timeout: number; maxRetries: number }).timeout).toBe(30_000);
    expect((captured.aOptions as { timeout: number; maxRetries: number }).maxRetries).toBe(3);
  });
});

describe("planejador.callHaiku — triage", () => {
  it("default Infomaniak / mistral3", async () => {
    mockOpenAIResponse = {
      choices: [{ message: { content: '{"ranking":["a"]}' } }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    };
    const { callHaiku } = await import("../src/llm-client.js");
    const r = await callHaiku("s", "u");
    expect(r.provider).toBe("infomaniak");
    expect(r.model).toBe("mistral3");
    expect((captured.oParams as { max_tokens: number }).max_tokens).toBe(512);
  });

  it("HAIKU_TRIAGE_PROVIDER=anthropic → Claude Haiku", async () => {
    process.env["HAIKU_TRIAGE_PROVIDER"] = "anthropic";
    mockAnthropicResponse = {
      content: [{ type: "text", text: '{"ranking":["a"]}' }],
      usage: { input_tokens: 50, output_tokens: 10 },
    };
    const { callHaiku } = await import("../src/llm-client.js");
    const r = await callHaiku("s", "u");
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe("claude-haiku-4-5-20251001");
    expect((captured.aParams as { max_tokens: number }).max_tokens).toBe(512);
    expect((captured.aOptions as { timeout: number }).timeout).toBe(15_000);
    // Thinking sempre OFF em haiku-triage (mesmo com debug ON)
    process.env["ASC_DEBUG_MODE"] = "true";
    captured.aParams = undefined;
    await callHaiku("s", "u");
    expect((captured.aParams as { thinking?: unknown } | undefined)?.thinking).toBeUndefined();
  });
});
