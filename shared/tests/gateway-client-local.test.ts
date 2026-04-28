/**
 * Tests pra provider "local" em callGateway (vLLM).
 *
 * Spec: ascendimacy-ops/docs/handoffs/2026-04-28-local-vllm-gpt-oss-motor-sts.md §6.2
 *
 * Provider local bypassa MCP gateway e chama vLLM direto via fetch.
 * Mockamos global.fetch pra evitar dependência de container rodando.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callGateway } from "../src/gateway-client.js";

const ORIG_ENV: Record<string, string | undefined> = {
  LLM_PROVIDER: process.env["LLM_PROVIDER"],
  USE_MOCK_LLM: process.env["USE_MOCK_LLM"],
  LOCAL_LLM_BASE_URL: process.env["LOCAL_LLM_BASE_URL"],
  LOCAL_LLM_MODEL: process.env["LOCAL_LLM_MODEL"],
  DROTA_PROVIDER: process.env["DROTA_PROVIDER"],
};

function buildVllmResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
  } as unknown as Response;
}

beforeEach(() => {
  delete process.env["LLM_PROVIDER"];
  delete process.env["USE_MOCK_LLM"];
  delete process.env["LOCAL_LLM_BASE_URL"];
  delete process.env["LOCAL_LLM_MODEL"];
  delete process.env["DROTA_PROVIDER"];
});

afterEach(() => {
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe("callGateway com provider=local (vLLM)", () => {
  it("LLM_PROVIDER=local → fetch é chamado em /v1/chat/completions", async () => {
    process.env["LLM_PROVIDER"] = "local";
    process.env["LOCAL_LLM_BASE_URL"] = "http://localhost:8000/v1";
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(buildVllmResponse("Olá!"));

    const result = await callGateway({
      step: "drota",
      systemPrompt: "system",
      userMessage: "user",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8000/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.provider).toBe("local");
    expect(result.content).toBe("Olá!");
    expect(result.tokens.in).toBe(100);
    expect(result.tokens.out).toBe(20);
  });

  it("default base URL quando LOCAL_LLM_BASE_URL não setado", async () => {
    process.env["LLM_PROVIDER"] = "local";
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(buildVllmResponse("ok"));

    await callGateway({ step: "drota", systemPrompt: "", userMessage: "x" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8000/v1/chat/completions",
      expect.any(Object),
    );
  });

  it("body inclui model do LOCAL_LLM_MODEL", async () => {
    process.env["LLM_PROVIDER"] = "local";
    process.env["LOCAL_LLM_MODEL"] = "qwen3-8b";
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(buildVllmResponse("ok"));

    await callGateway({ step: "drota", systemPrompt: "s", userMessage: "u" });

    const callArgs = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.model).toBe("qwen3-8b");
  });

  it("cacheableSystemPrefix concatenado com systemPrompt no system message", async () => {
    process.env["LLM_PROVIDER"] = "local";
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(buildVllmResponse("ok"));

    await callGateway({
      step: "drota",
      systemPrompt: "DYNAMIC",
      userMessage: "u",
      cacheableSystemPrefix: "STABLE_PREFIX",
    });

    const callArgs = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(callArgs.body as string);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe("STABLE_PREFIX\n\nDYNAMIC");
  });

  it("USE_MOCK_LLM=true ainda retorna mock mesmo com provider=local", async () => {
    process.env["USE_MOCK_LLM"] = "true";
    process.env["LLM_PROVIDER"] = "local";
    const fetchSpy = vi.spyOn(global, "fetch");

    const result = await callGateway({
      step: "drota",
      systemPrompt: "",
      userMessage: "",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.model).toBe("mock");
  });

  it("HTTP error → throw com status + body slice", async () => {
    process.env["LLM_PROVIDER"] = "local";
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "service unavailable",
      json: async () => ({}),
    } as unknown as Response);

    await expect(
      callGateway({ step: "drota", systemPrompt: "", userMessage: "u" }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("DROTA_PROVIDER=local → só drota usa local; planejador segue default", async () => {
    process.env["DROTA_PROVIDER"] = "local";
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(buildVllmResponse("ok"));

    await callGateway({ step: "drota", systemPrompt: "", userMessage: "u" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Confirma que NÃO foi MCP gateway (sem callTool); fetch é a evidência.
  });
});
