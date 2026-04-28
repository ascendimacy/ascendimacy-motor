/**
 * Tests pra mock awareness em callGateway (USE_MOCK_LLM=true).
 *
 * Quando flag liga, callGateway retorna stub determinístico per step
 * sem spawnar gateway nem chamar LLM real. Smoke end-to-end zero custo.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { callGateway } from "../src/gateway-client.js";

const ORIG_FLAG = process.env["USE_MOCK_LLM"];

beforeEach(() => {
  process.env["USE_MOCK_LLM"] = "true";
});

afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env["USE_MOCK_LLM"];
  else process.env["USE_MOCK_LLM"] = ORIG_FLAG;
});

describe("callGateway — mock awareness (USE_MOCK_LLM=true)", () => {
  it("unified-assessor → JSON com mood + signals + engagement válidos", async () => {
    const r = await callGateway({
      step: "unified-assessor",
      systemPrompt: "x",
      userMessage: "y",
    });
    expect(r.model).toBe("mock");
    expect(r.latency_ms).toBe(0);
    const parsed = JSON.parse(r.content);
    expect(parsed.mood).toBe(6);
    expect(parsed.mood_confidence).toBe("medium");
    expect(Array.isArray(parsed.signals)).toBe(true);
    expect(parsed.engagement).toBe("medium");
  });

  it("mood-extractor → JSON com score + rationale", async () => {
    const r = await callGateway({
      step: "mood-extractor",
      systemPrompt: "x",
      userMessage: "y",
    });
    const parsed = JSON.parse(r.content);
    expect(parsed.score).toBe(5);
    expect(parsed.rationale).toBe("mock");
  });

  it("signal-extractor → JSON com signals array", async () => {
    const r = await callGateway({
      step: "signal-extractor",
      systemPrompt: "x",
      userMessage: "y",
    });
    const parsed = JSON.parse(r.content);
    expect(Array.isArray(parsed.signals)).toBe(true);
    expect(parsed.signals).toEqual([]);
  });

  it("drota → JSON com selectionRationale + linguisticMaterialization", async () => {
    const r = await callGateway({
      step: "drota",
      systemPrompt: "x",
      userMessage: "y",
    });
    const parsed = JSON.parse(r.content);
    expect(typeof parsed.selectionRationale).toBe("string");
    expect(typeof parsed.linguisticMaterialization).toBe("string");
    expect(parsed.linguisticMaterialization.length).toBeGreaterThan(0);
  });

  it("planejador → JSON parseable com strategicRationale + contentPool", async () => {
    const r = await callGateway({
      step: "planejador",
      systemPrompt: "x",
      userMessage: "y",
    });
    const parsed = JSON.parse(r.content);
    expect(typeof parsed.strategicRationale).toBe("string");
    expect(Array.isArray(parsed.contentPool)).toBe(true);
  });

  it("step desconhecido → fallback genérico válido", async () => {
    const r = await callGateway({
      step: "step-novo-qualquer",
      systemPrompt: "x",
      userMessage: "y",
    });
    const parsed = JSON.parse(r.content);
    expect(parsed.mock).toBe(true);
    expect(parsed.step).toBe("step-novo-qualquer");
  });

  it("flag off (default) → tenta gateway real (que deve falhar sem env)", async () => {
    delete process.env["USE_MOCK_LLM"];
    // Quando flag não tá true, callGateway tenta spawnar gateway real.
    // Se gateway não buildado, dá erro claro. Aqui só verificamos que NÃO
    // retorna o mock JSON — a chamada lança ou tenta rede.
    await expect(
      callGateway({
        step: "unified-assessor",
        systemPrompt: "x",
        userMessage: "y",
      }),
    ).rejects.toThrow();
  });
});
