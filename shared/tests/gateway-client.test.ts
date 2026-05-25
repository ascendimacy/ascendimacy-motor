/**
 * gateway-client tests — D-3-PROV (ops#1055) bypass pra openai-compat.
 *
 * Foco: o switch `callGateway` quando provider=openai-compat → fetch
 * direto, sem passar pelo MCP gateway. Mockamos `globalThis.fetch` pra
 * verificar request shape + parsing do response.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { callGateway } from "../src/gateway-client.js";

const ORIG_ENV = { ...process.env };
let fetchMock: Mock;

beforeEach(() => {
  // Pristine env pros tests deste describe
  for (const k of [
    "LLM_LOCAL_ENDPOINT",
    "LLM_LOCAL_MODEL",
    "LLM_PROVIDER",
    "PLANEJADOR_PROVIDER",
    "PLANEJADOR_MODEL",
    "DROTA_PROVIDER",
    "DROTA_MODEL",
  ]) {
    delete process.env[k];
  }
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (process.env[k] !== v) process.env[k] = v;
  }
});

const mockOpenAiResponse = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [
      { message: { content: "pong" }, finish_reason: "stop" },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 3,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 10 },
    },
    model: "qwen3-30b",
    ...overrides,
  }),
});

describe("callGateway openai-compat bypass (D-3-PROV)", () => {
  it("provider=openai-compat → fetch direto, não MCP", async () => {
    process.env["LLM_LOCAL_ENDPOINT"] = "http://localhost:9000/v1/chat/completions";
    process.env["LLM_LOCAL_MODEL"] = "qwen3-30b";
    fetchMock.mockResolvedValueOnce(mockOpenAiResponse());

    const out = await callGateway({
      step: "planejador",
      provider: "openai-compat",
      systemPrompt: "You are Brota.",
      userMessage: "ping",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(out.provider).toBe("openai-compat");
    expect(out.content).toBe("pong");
    expect(out.model).toBe("qwen3-30b");
  });

  it("usa LLM_LOCAL_ENDPOINT e POSTa body OpenAI-compat", async () => {
    process.env["LLM_LOCAL_ENDPOINT"] = "http://172.28.160.1:9000/v1/chat/completions";
    process.env["LLM_LOCAL_MODEL"] = "qwen3-30b";
    fetchMock.mockResolvedValueOnce(mockOpenAiResponse());

    await callGateway({
      step: "drota",
      provider: "openai-compat",
      systemPrompt: "system body",
      userMessage: "user body",
      maxTokens: 256,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://172.28.160.1:9000/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>)["Content-Type"],
    ).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("qwen3-30b");
    expect(body.messages).toEqual([
      { role: "system", content: "system body" },
      { role: "user", content: "user body" },
    ]);
    expect(body.max_tokens).toBe(256);
  });

  it("cacheableSystemPrefix é prepended em system content", async () => {
    process.env["LLM_LOCAL_ENDPOINT"] = "http://localhost:9000/v1/chat/completions";
    fetchMock.mockResolvedValueOnce(mockOpenAiResponse());

    await callGateway({
      step: "drota",
      provider: "openai-compat",
      model: "qwen3-30b",
      cacheableSystemPrefix: "STABLE_PREFIX\n\n",
      systemPrompt: "DYNAMIC_BODY",
      userMessage: "go",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content).toBe("STABLE_PREFIX\n\nDYNAMIC_BODY");
  });

  it("tokens extraídos de prompt_tokens + cached_tokens", async () => {
    process.env["LLM_LOCAL_ENDPOINT"] = "http://localhost:9000/v1/chat/completions";
    fetchMock.mockResolvedValueOnce(mockOpenAiResponse());

    const out = await callGateway({
      step: "planejador",
      provider: "openai-compat",
      model: "qwen3-30b",
      systemPrompt: "s",
      userMessage: "u",
    });

    expect(out.tokens.in).toBe(12);
    expect(out.tokens.out).toBe(3);
    expect(out.tokens.cacheRead).toBe(10);
    expect(out.tokens.reasoning).toBe(0);
    expect(out.was_fallback).toBe(false);
    expect(out.attempt_count).toBe(1);
    expect(out.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("HTTP non-2xx → throws com shape gateway error: HTTP_N", async () => {
    process.env["LLM_LOCAL_ENDPOINT"] = "http://localhost:9000/v1/chat/completions";
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    await expect(
      callGateway({
        step: "drota",
        provider: "openai-compat",
        model: "qwen3-30b",
        systemPrompt: "s",
        userMessage: "u",
      }),
    ).rejects.toThrow(/gateway error: HTTP_500/);
  });

  it("response sem choices → throws EMPTY_RESPONSE", async () => {
    process.env["LLM_LOCAL_ENDPOINT"] = "http://localhost:9000/v1/chat/completions";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [], model: "qwen3-30b" }),
    });

    await expect(
      callGateway({
        step: "drota",
        provider: "openai-compat",
        model: "qwen3-30b",
        systemPrompt: "s",
        userMessage: "u",
      }),
    ).rejects.toThrow(/EMPTY_RESPONSE/);
  });

  it("provider resolvido via env LLM_PROVIDER=openai-compat", async () => {
    process.env["LLM_PROVIDER"] = "openai-compat";
    process.env["LLM_LOCAL_ENDPOINT"] = "http://localhost:9000/v1/chat/completions";
    process.env["LLM_LOCAL_MODEL"] = "qwen3-30b";
    fetchMock.mockResolvedValueOnce(mockOpenAiResponse());

    // Não passa provider — vem do env
    const out = await callGateway({
      step: "planejador",
      systemPrompt: "s",
      userMessage: "u",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(out.provider).toBe("openai-compat");
  });

  it("endpoint default é localhost:8080 quando LLM_LOCAL_ENDPOINT ausente", async () => {
    process.env["LLM_LOCAL_MODEL"] = "qwen3-30b";
    fetchMock.mockResolvedValueOnce(mockOpenAiResponse());

    await callGateway({
      step: "planejador",
      provider: "openai-compat",
      systemPrompt: "s",
      userMessage: "u",
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:8080/v1/chat/completions");
  });

  // D-3-PROV ops#1055 follow-up: defesa contra empty content em openai-compat.
  // Bug reproduzido em smoke STS Qwen3-30B 2026-05-24 (kei G2 fail turn 2).

  it("content vazio + reasoning_content presente → usa reasoning como fallback", async () => {
    process.env["LLM_LOCAL_ENDPOINT"] = "http://localhost:9000/v1/chat/completions";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: "",
              reasoning_content: "tô por aqui quando quiser conversar.",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        model: "qwen3-30b",
      }),
    });

    const out = await callGateway({
      step: "drota",
      provider: "openai-compat",
      model: "qwen3-30b",
      systemPrompt: "s",
      userMessage: "u",
    });

    expect(out.content).toBe("tô por aqui quando quiser conversar.");
  });

  it("content vazio sem reasoning_content → retorna string vazia", async () => {
    process.env["LLM_LOCAL_ENDPOINT"] = "http://localhost:9000/v1/chat/completions";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          { message: { content: "" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 },
        model: "qwen3-30b",
      }),
    });

    const out = await callGateway({
      step: "drota",
      provider: "openai-compat",
      model: "qwen3-30b",
      systemPrompt: "s",
      userMessage: "u",
    });

    // Não muda comportamento (callsite faz fallback) — só não crasha.
    expect(out.content).toBe("");
  });

  it("content presente é priorizado sobre reasoning_content", async () => {
    process.env["LLM_LOCAL_ENDPOINT"] = "http://localhost:9000/v1/chat/completions";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: "real response",
              reasoning_content: "deveria ser ignorado",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
        model: "qwen3-30b",
      }),
    });

    const out = await callGateway({
      step: "drota",
      provider: "openai-compat",
      model: "qwen3-30b",
      systemPrompt: "s",
      userMessage: "u",
    });

    expect(out.content).toBe("real response");
  });

  it("finish_reason=length emite warning mas não crasha", async () => {
    process.env["LLM_LOCAL_ENDPOINT"] = "http://localhost:9000/v1/chat/completions";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          { message: { content: "cortado..." }, finish_reason: "length" },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 200, total_tokens: 250 },
        model: "qwen3-30b",
      }),
    });

    const out = await callGateway({
      step: "drota",
      provider: "openai-compat",
      model: "qwen3-30b",
      systemPrompt: "s",
      userMessage: "u",
    });

    expect(out.content).toBe("cortado...");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("finish_reason=length"),
    );
    warnSpy.mockRestore();
  });
});
