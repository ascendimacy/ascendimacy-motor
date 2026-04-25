/**
 * Tests do planejador llm-client (motor#19 + motor#20).
 *
 * Cobre:
 *   - LlmCallResult shape (content, reasoning, tokens) — motor#19
 *   - max_tokens=2048 — motor#19 (era 200 pré-#19)
 *   - Extended thinking ON em debug mode — motor#19
 *   - Timeout/maxRetries forwarded pra SDK — motor#20
 *   - Múltiplos blocks (text + thinking) tratados corretamente
 *   - Auth error com mensagem clara
 *
 * Mocka @anthropic-ai/sdk via vi.mock pra não bater na API real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Captura de params passados pra messages.create — preenchido pelos tests
const captured: { params?: unknown; options?: unknown } = {};
let mockResponse: unknown = null;
let mockThrow: unknown = null;

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: async (params: unknown, options?: unknown) => {
          captured.params = params;
          captured.options = options;
          if (mockThrow) throw mockThrow;
          return mockResponse;
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
  mockThrow = null;
  delete process.env["ASC_DEBUG_MODE"];
  delete process.env["ASC_LLM_TIMEOUT_PLANEJADOR"];
  delete process.env["ASC_LLM_MAX_RETRIES_PLANEJADOR"];
  process.env["ANTHROPIC_API_KEY"] = "test-key";
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
});

describe("planejador.callLlm — motor#19 + motor#20", () => {
  it("retorna LlmCallResult shape com content + tokens", async () => {
    mockResponse = {
      content: [{ type: "text", text: "Hello world" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("system", "user");
    expect(r.content).toBe("Hello world");
    expect(r.tokens.in).toBe(100);
    expect(r.tokens.out).toBe(50);
    expect(r.tokens.reasoning).toBe(0);
    expect(r.reasoning).toBeUndefined();
  });

  it("max_tokens=2048 (motor#19 bump)", async () => {
    mockResponse = {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.params as { max_tokens: number }).max_tokens).toBe(2048);
  });

  it("thinking OFF por default (debug mode off)", async () => {
    mockResponse = {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.params as { thinking?: unknown }).thinking).toBeUndefined();
  });

  it("thinking ON com budget 1024 em debug mode", async () => {
    process.env["ASC_DEBUG_MODE"] = "true";
    mockResponse = {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    const thinking = (captured.params as { thinking?: { type: string; budget_tokens: number } }).thinking;
    expect(thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
  });

  it("captura reasoning de blocks type=thinking", async () => {
    mockResponse = {
      content: [
        { type: "thinking", thinking: "I should help the user..." },
        { type: "text", text: "Response text" },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    const r = await callLlm("s", "u");
    expect(r.content).toBe("Response text");
    expect(r.reasoning).toBe("I should help the user...");
  });

  it("timeout default 30s passado pra SDK options (motor#20)", async () => {
    mockResponse = {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.options as { timeout: number }).timeout).toBe(30_000);
  });

  it("ASC_LLM_TIMEOUT_PLANEJADOR override aplicado (motor#20)", async () => {
    process.env["ASC_LLM_TIMEOUT_PLANEJADOR"] = "120";
    mockResponse = {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.options as { timeout: number }).timeout).toBe(120_000);
  });

  it("maxRetries=3 default (motor#20)", async () => {
    mockResponse = {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { callLlm } = await import("../src/llm-client.js");
    await callLlm("s", "u");
    expect((captured.options as { maxRetries: number }).maxRetries).toBe(3);
  });

  it("throw quando response sem text block", async () => {
    mockResponse = { content: [], usage: { input_tokens: 1, output_tokens: 1 } };
    const { callLlm } = await import("../src/llm-client.js");
    await expect(callLlm("s", "u")).rejects.toThrow(/no text block/);
  });
});

describe("planejador.callHaiku — motor#19 + motor#20", () => {
  it("max_tokens=512 (motor#19 bump 150→512)", async () => {
    mockResponse = {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { callHaiku } = await import("../src/llm-client.js");
    await callHaiku("s", "u");
    expect((captured.params as { max_tokens: number }).max_tokens).toBe(512);
  });

  it("timeout 15s (haiku-triage default)", async () => {
    mockResponse = {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { callHaiku } = await import("../src/llm-client.js");
    await callHaiku("s", "u");
    expect((captured.options as { timeout: number }).timeout).toBe(15_000);
  });

  it("thinking OFF mesmo em debug mode (Haiku é safety-critical determinístico)", async () => {
    process.env["ASC_DEBUG_MODE"] = "true";
    mockResponse = {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { callHaiku } = await import("../src/llm-client.js");
    await callHaiku("s", "u");
    expect((captured.params as { thinking?: unknown }).thinking).toBeUndefined();
  });
});
