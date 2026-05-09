/**
 * LLM-LOCAL integration test para cost_usd_est.
 *
 * Sprint 0 PR1 (motor#71). Story ops#499 (S-J-01-02).
 *
 * Roda APENAS quando `LLM_LOCAL_STACK_UP=true`. Senão skip graceful.
 *
 * Como rodar:
 *   1. Subir stack qwen3 + llama.cpp SYCL (ver memória project_llm_stack_qwen3.md)
 *   2. Verificar endpoint local respondendo (default http://localhost:8080)
 *   3. `LLM_LOCAL_STACK_UP=true npm test -ws --workspace=shared -- cost-calc.llm-local`
 *
 * Validação:
 *   - Chamada real ao Qwen3 local com prompt curto
 *   - Captura tokens reais retornados pelo endpoint
 *   - Verifica cost_usd_est = (tokens_in × p_in) + (tokens_out × p_out)
 *   - Para qwen3-8b especificamente: cost = 0 (LLM local sem custo de API)
 */

import { describe, it, expect } from "vitest";
import { calculateCostUsd, getPricesForModel } from "../src/llm-config.js";

const STACK_UP = process.env["LLM_LOCAL_STACK_UP"] === "true";
const LOCAL_ENDPOINT =
  process.env["LLM_LOCAL_ENDPOINT"] ?? "http://localhost:8080/v1/chat/completions";
const LOCAL_MODEL = process.env["LLM_LOCAL_MODEL"] ?? "qwen3-8b";

if (!STACK_UP) {
  // eslint-disable-next-line no-console
  console.log(
    "[cost-calc.llm-local] Skipping — set LLM_LOCAL_STACK_UP=true + ensure stack llama.cpp SYCL up to enable.",
  );
}

describe.runIf(STACK_UP)("cost_usd_est — LLM LOCAL integration (qwen3 via llama.cpp SYCL)", () => {
  it("chamada real captura tokens reais e cost calculado bate com fórmula", async () => {
    // Prompt curto e determinístico
    const requestBody = {
      model: LOCAL_MODEL,
      messages: [
        { role: "system", content: "Responda em português, em uma palavra." },
        { role: "user", content: "Diga olá." },
      ],
      max_tokens: 20,
      temperature: 0,
    };

    let response: Response;
    try {
      response = await fetch(LOCAL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60_000), // 60s timeout (qwen3 local pode ser lento na primeira chamada)
      });
    } catch (err) {
      throw new Error(
        `Falha ao chamar endpoint local ${LOCAL_ENDPOINT}: ${String(err)}. ` +
          `Verifique se llama.cpp está rodando.`,
      );
    }

    expect(response.ok).toBe(true);
    const data = (await response.json()) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices?: Array<{ message?: { content?: string } }>;
    };

    // Captura tokens reais retornados pelo endpoint OpenAI-compatible
    const tokensIn = data.usage?.prompt_tokens ?? 0;
    const tokensOut = data.usage?.completion_tokens ?? 0;
    const responseText = data.choices?.[0]?.message?.content ?? "";

    expect(tokensIn).toBeGreaterThan(0);
    expect(tokensOut).toBeGreaterThan(0);
    expect(responseText.length).toBeGreaterThan(0);

    // Calcula cost via função pura
    const cost = calculateCostUsd(LOCAL_MODEL, tokensIn, tokensOut);
    expect(cost).not.toBeNull();

    // Para qwen3-8b: cost deve ser 0 (LLM local)
    if (LOCAL_MODEL === "qwen3-8b") {
      expect(cost).toBe(0);
    } else {
      // Para outros modelos rodados localmente (mistral local, etc.), cost > 0 OK
      const prices = getPricesForModel(LOCAL_MODEL);
      if (prices) {
        const expected = tokensIn * prices.price_in_per_token + tokensOut * prices.price_out_per_token;
        expect(cost).toBeCloseTo(expected, 10);
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[cost-calc.llm-local] model=${LOCAL_MODEL} tokens_in=${tokensIn} tokens_out=${tokensOut} cost=${cost}`,
    );
  }, 90_000); // test timeout de 90s pra acomodar prefill frio
});
