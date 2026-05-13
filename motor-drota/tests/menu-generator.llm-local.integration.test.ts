/**
 * LLM-LOCAL integration test — generateActionMenu contra stack Qwen3 local.
 *
 * S-T-09-02 + H-AC-02 (motor#88). Roda APENAS quando `LLM_LOCAL_STACK_UP=true`.
 * Senão: skip graceful (não polui CI nem suite default).
 *
 * Como rodar:
 *   1. Subir stack qwen3 + llama.cpp SYCL (ver memória project_llm_stack_qwen3.md)
 *   2. Verificar endpoint local respondendo (default http://localhost:8080)
 *   3. `LLM_LOCAL_STACK_UP=true npm test -w @ascendimacy/motor-drota -- menu-generator.llm-local`
 *
 * O test:
 *   - Carrega fixture Ryo
 *   - Chama generateActionMenu apontando para LLM local (via callOverride)
 *   - Valida que pelo menos UM menu válido sai (≥1 item parseado)
 *   - Loga distribuição observada (jogadas, intensity)
 *
 * Não é gate de aceite — gate de aceite é o smoke contra Infomaniak Kimi K2.5
 * (script `scripts/smoke-menu-generator.mjs`), rodado por Jun. Este test é
 * sanity check pra desenvolvimento local sem rede.
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseActionMenu } from "@ascendimacy/shared";
import { generateActionMenu, type LlmCall } from "../src/menu-generator.js";
import { RYO_HINT } from "../src/persona-hints.js";

const STACK_UP = process.env["LLM_LOCAL_STACK_UP"] === "true";
const LOCAL_ENDPOINT =
  process.env["LLM_LOCAL_ENDPOINT"] ??
  "http://localhost:8080/v1/chat/completions";
const LOCAL_MODEL = process.env["LLM_LOCAL_MODEL"] ?? "qwen3-8b";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

if (!STACK_UP) {
  // eslint-disable-next-line no-console
  console.log(
    "[menu-generator.llm-local] Skipping — set LLM_LOCAL_STACK_UP=true + ensure llama.cpp SYCL stack up to enable.",
  );
}

/**
 * LlmCall adapter contra OpenAI-compatible endpoint local. Mantém shape
 * idêntico ao gateway-client (content + tokens + provider + model).
 */
function localLlmCall(): LlmCall {
  return async (systemPrompt, userMessage) => {
    const body = {
      model: LOCAL_MODEL,
      messages: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userMessage },
      ],
      max_tokens: 3000,
      temperature: 0.7,
    };
    const resp = await fetch(LOCAL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    if (!resp.ok) {
      throw new Error(`LLM local HTTP ${resp.status}`);
    }
    type ChatResp = {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const json = (await resp.json()) as ChatResp;
    return {
      content: json.choices[0]!.message.content,
      tokens: {
        in: json.usage?.prompt_tokens ?? 0,
        out: json.usage?.completion_tokens ?? 0,
        reasoning: 0,
      },
      // LLM local não bate com o enum LlmProvider canônico ("anthropic" |
      // "infomaniak") — usamos "infomaniak" como rótulo informativo (o
      // endpoint OpenAI-compat do llama.cpp comporta-se análogo).
      provider: "infomaniak" as const,
      model: LOCAL_MODEL,
    };
  };
}

describe.runIf(STACK_UP)("generateActionMenu — LLM LOCAL (qwen3)", () => {
  it("produz menu Zod-válido contra stack local + loga distribuição", async () => {
    const fixturePath = path.join(
      REPO_ROOT,
      "fixtures",
      "profiles",
      "ryo-ochiai.pre-phase2.json",
    );
    const profile = JSON.parse(await readFile(fixturePath, "utf-8"));

    const warnings: string[] = [];
    const menu = await generateActionMenu(
      {
        personaId: "ryo-ochiai",
        trustLevel: 0.42,
        profile,
        personaHint: RYO_HINT,
      },
      {
        llmCall: localLlmCall(),
        onWarning: (w) => warnings.push(`${w.code}: ${w.message}`),
      },
    );

    // Sanity: ou conseguiu gerar (válido), ou degradou graceful.
    // qwen3-8b pode não acertar enums sempre — então a expectativa é
    // "≥1 item parseado", não "100% rotulado".
    expect(menu).not.toBeNull();
    expect(() => parseActionMenu(menu)).not.toThrow();
    expect(menu!.items.length).toBeGreaterThan(0);

    const labeled = menu!.items.filter((it) => it.played_as != null).length;
    const total = menu!.items.length;
    const pctLabeled = total > 0 ? (labeled / total) * 100 : 0;

    // eslint-disable-next-line no-console
    console.log(
      `[menu-generator.llm-local] Ryo menu: ${total} items, ` +
        `${labeled} rotulados (${pctLabeled.toFixed(0)}%). ` +
        `Warnings: ${warnings.length > 0 ? warnings.join("; ") : "(none)"}`,
    );
    // Distribuição
    const dist = new Map<string, number>();
    for (const it of menu!.items) {
      const key = it.played_as ?? "(unlabeled)";
      dist.set(key, (dist.get(key) ?? 0) + 1);
    }
    // eslint-disable-next-line no-console
    console.log(
      "[menu-generator.llm-local] Distribuição: " +
        [...dist.entries()]
          .map(([k, v]) => `${k}=${v}`)
          .join(", "),
    );
  }, 240_000);
});
