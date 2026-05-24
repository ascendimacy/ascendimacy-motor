/**
 * Tests llm-router (motor#21) — provider selection + model routing + max_tokens.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getProviderForStep,
  getModelForStep,
  getMaxTokensForStep,
  shouldEnableThinking,
  shouldUseMockLlm,
  isReasoningModel,
  DEFAULT_PROVIDERS,
  DEFAULT_MODELS,
  ANTHROPIC_FALLBACK_MODELS,
} from "../src/llm-router.js";

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.endsWith("_PROVIDER") || k.endsWith("_MODEL") || k.endsWith("_MAX_TOKENS") || k === "LLM_PROVIDER" || k === "LLM_THINKING_BUDGET_TOKENS") {
      delete process.env[k];
    }
  }
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (k.endsWith("_PROVIDER") || k.endsWith("_MODEL") || k === "LLM_PROVIDER") process.env[k] = v;
  }
});

describe("getProviderForStep", () => {
  it("default infomaniak pra todos os steps", () => {
    expect(getProviderForStep("planejador")).toBe("infomaniak");
    expect(getProviderForStep("drota")).toBe("infomaniak");
    expect(getProviderForStep("persona-sim")).toBe("infomaniak");
    expect(getProviderForStep("haiku-triage")).toBe("infomaniak");
    expect(getProviderForStep("haiku-bullying")).toBe("infomaniak");
  });

  it("PLANEJADOR_PROVIDER override per-step", () => {
    process.env["PLANEJADOR_PROVIDER"] = "anthropic";
    expect(getProviderForStep("planejador")).toBe("anthropic");
    expect(getProviderForStep("drota")).toBe("infomaniak"); // não afeta outros
  });

  it("hyphen no step name vira underscore no env (haiku-triage → HAIKU_TRIAGE_PROVIDER)", () => {
    process.env["HAIKU_TRIAGE_PROVIDER"] = "anthropic";
    expect(getProviderForStep("haiku-triage")).toBe("anthropic");
  });

  it("LLM_PROVIDER global override quando step-specific ausente", () => {
    process.env["LLM_PROVIDER"] = "anthropic";
    expect(getProviderForStep("planejador")).toBe("anthropic");
    expect(getProviderForStep("drota")).toBe("anthropic");
  });

  it("step-specific beats global", () => {
    process.env["LLM_PROVIDER"] = "anthropic";
    process.env["DROTA_PROVIDER"] = "infomaniak";
    expect(getProviderForStep("drota")).toBe("infomaniak");
    expect(getProviderForStep("planejador")).toBe("anthropic"); // global ainda
  });

  it("valor inválido em env → fallback default", () => {
    process.env["PLANEJADOR_PROVIDER"] = "openai-direct"; // não bate com nenhum enum
    expect(getProviderForStep("planejador")).toBe("infomaniak"); // default
  });

  it("step desconhecido → infomaniak fallback", () => {
    expect(getProviderForStep("unknown-step")).toBe("infomaniak");
  });

  // D-3-PROV (ops#1055): openai-compat habilitado para LLM local.
  it("aceita openai-compat em env per-step", () => {
    process.env["DROTA_PROVIDER"] = "openai-compat";
    expect(getProviderForStep("drota")).toBe("openai-compat");
    expect(getProviderForStep("planejador")).toBe("infomaniak"); // não afeta outros
  });

  it("aceita openai-compat em LLM_PROVIDER global", () => {
    process.env["LLM_PROVIDER"] = "openai-compat";
    expect(getProviderForStep("planejador")).toBe("openai-compat");
    expect(getProviderForStep("drota")).toBe("openai-compat");
  });

  it("defaults inalterados: openai-compat NÃO entra em DEFAULT_PROVIDERS", () => {
    // Garantia explícita: prod continua infomaniak sem env override.
    for (const step of [
      "planejador",
      "drota",
      "persona-sim",
      "haiku-triage",
      "haiku-bullying",
    ]) {
      expect(DEFAULT_PROVIDERS[step as keyof typeof DEFAULT_PROVIDERS]).toBe("infomaniak");
    }
  });
});

describe("getModelForStep", () => {
  it("default Kimi K2.5 pra planejador/drota/persona-sim (Infomaniak)", () => {
    expect(getModelForStep("planejador")).toBe("moonshotai/Kimi-K2.5");
    expect(getModelForStep("drota")).toBe("moonshotai/Kimi-K2.5");
    expect(getModelForStep("persona-sim")).toBe("moonshotai/Kimi-K2.5");
  });

  it("default mistral3 pra haiku-triage/haiku-bullying (rerank, sem reasoning)", () => {
    expect(getModelForStep("haiku-triage")).toBe("mistral3");
    expect(getModelForStep("haiku-bullying")).toBe("mistral3");
  });

  it("provider=anthropic → Claude fallback", () => {
    expect(getModelForStep("planejador", "anthropic")).toBe("claude-sonnet-4-6");
    expect(getModelForStep("haiku-triage", "anthropic")).toBe("claude-haiku-4-5-20251001");
  });

  it("explicit env beats default", () => {
    process.env["PLANEJADOR_MODEL"] = "deepseek-r1";
    expect(getModelForStep("planejador")).toBe("deepseek-r1");
  });

  it("legacy MOTOR_DROTA_MODEL ainda funciona", () => {
    process.env["MOTOR_DROTA_MODEL"] = "mistral3";
    expect(getModelForStep("drota")).toBe("mistral3");
  });

  it("DROTA_MODEL beats MOTOR_DROTA_MODEL (new naming preferido)", () => {
    process.env["DROTA_MODEL"] = "qwen3";
    process.env["MOTOR_DROTA_MODEL"] = "mistral3";
    expect(getModelForStep("drota")).toBe("qwen3");
  });

  // D-3-PROV (ops#1055): provider=openai-compat resolve model via LLM_LOCAL_MODEL.
  it("provider=openai-compat resolve model via LLM_LOCAL_MODEL env", () => {
    process.env["LLM_LOCAL_MODEL"] = "qwen3-30b";
    expect(getModelForStep("drota", "openai-compat")).toBe("qwen3-30b");
    expect(getModelForStep("planejador", "openai-compat")).toBe("qwen3-30b");
  });

  it("provider=openai-compat sem LLM_LOCAL_MODEL retorna \"unknown\"", () => {
    delete process.env["LLM_LOCAL_MODEL"];
    expect(getModelForStep("drota", "openai-compat")).toBe("unknown");
  });

  it("env per-step (DROTA_MODEL) beats LLM_LOCAL_MODEL no openai-compat", () => {
    process.env["DROTA_MODEL"] = "qwen3-14b";
    process.env["LLM_LOCAL_MODEL"] = "qwen3-30b";
    // Per-step explicit é resolvido antes de checar provider.
    expect(getModelForStep("drota", "openai-compat")).toBe("qwen3-14b");
  });
});

describe("isReasoningModel", () => {
  it("Kimi K2.5 é reasoning", () => {
    expect(isReasoningModel("moonshotai/Kimi-K2.5")).toBe(true);
  });
  it("DeepSeek-R1 é reasoning", () => {
    expect(isReasoningModel("deepseek-r1")).toBe(true);
  });
  it("o1/o3 são reasoning (OpenAI)", () => {
    expect(isReasoningModel("o1-preview")).toBe(true);
    expect(isReasoningModel("o3-mini")).toBe(true);
  });
  it("Mistral3 NÃO é reasoning", () => {
    expect(isReasoningModel("mistral3")).toBe(false);
  });
  it("Sonnet NÃO é reasoning (mesmo com extended thinking opt-in)", () => {
    expect(isReasoningModel("claude-sonnet-4-6")).toBe(false);
  });
});

describe("getMaxTokensForStep", () => {
  it("4096 pra planejador/drota/persona-sim com Kimi", () => {
    expect(getMaxTokensForStep("planejador", "moonshotai/Kimi-K2.5")).toBe(4096);
    expect(getMaxTokensForStep("drota", "moonshotai/Kimi-K2.5")).toBe(4096);
    expect(getMaxTokensForStep("persona-sim", "moonshotai/Kimi-K2.5")).toBe(4096);
  });
  it("2048 pra mesmos steps com Sonnet", () => {
    expect(getMaxTokensForStep("planejador", "claude-sonnet-4-6")).toBe(2048);
    expect(getMaxTokensForStep("drota", "mistral3")).toBe(2048);
  });
  it("512 pra haiku-triage com mistral3", () => {
    expect(getMaxTokensForStep("haiku-triage", "mistral3")).toBe(512);
  });
  it("2048 pra haiku-triage com Kimi (reasoning bumps mesmo Haiku)", () => {
    expect(getMaxTokensForStep("haiku-triage", "moonshotai/Kimi-K2.5")).toBe(2048);
  });
  it("env override aplica", () => {
    process.env["PLANEJADOR_MAX_TOKENS"] = "8192";
    expect(getMaxTokensForStep("planejador", "moonshotai/Kimi-K2.5")).toBe(8192);
  });
});

describe("shouldEnableThinking", () => {
  it("OFF se provider=infomaniak (mesmo em debug)", () => {
    expect(shouldEnableThinking("planejador", "infomaniak", true)).toBe(false);
    expect(shouldEnableThinking("drota", "infomaniak", true)).toBe(false);
  });

  it("OFF se debug off (mesmo Anthropic)", () => {
    expect(shouldEnableThinking("planejador", "anthropic", false)).toBe(false);
  });

  it("ON em planejador/drota/persona-sim com Anthropic + debug ON", () => {
    expect(shouldEnableThinking("planejador", "anthropic", true)).toBe(true);
    expect(shouldEnableThinking("drota", "anthropic", true)).toBe(true);
    expect(shouldEnableThinking("persona-sim", "anthropic", true)).toBe(true);
  });

  it("OFF em haiku-triage/haiku-bullying mesmo com Anthropic + debug ON", () => {
    expect(shouldEnableThinking("haiku-triage", "anthropic", true)).toBe(false);
    expect(shouldEnableThinking("haiku-bullying", "anthropic", true)).toBe(false);
  });

  // D-3-PROV (ops#1055): openai-compat sempre OFF (qwen3-30b-a3b-instruct-2507
  // não tem thinking mode equivalente). Tratamento igual a infomaniak.
  it("OFF se provider=openai-compat (mesmo em debug, mesmo em steps reasoning)", () => {
    expect(shouldEnableThinking("planejador", "openai-compat", true)).toBe(false);
    expect(shouldEnableThinking("drota", "openai-compat", true)).toBe(false);
    expect(shouldEnableThinking("persona-sim", "openai-compat", false)).toBe(false);
  });
});

describe("shouldUseMockLlm (D-3-PROV ops#1055 follow-up)", () => {
  /** Save + clear all key/provider env so each test starts pristine. */
  const KEY_ENVS = [
    "USE_MOCK_LLM",
    "ANTHROPIC_API_KEY",
    "INFOMANIAK_API_KEY",
    "LLM_PROVIDER",
    "PLANEJADOR_PROVIDER",
    "DROTA_PROVIDER",
  ];
  const savedKeys: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEY_ENVS) {
      savedKeys[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEY_ENVS) {
      if (savedKeys[k] === undefined) delete process.env[k];
      else process.env[k] = savedKeys[k];
    }
  });

  it("USE_MOCK_LLM=true força mock independente do provider", () => {
    process.env["USE_MOCK_LLM"] = "true";
    process.env["LLM_PROVIDER"] = "openai-compat";
    expect(shouldUseMockLlm("planejador")).toBe(true);
  });

  it("provider=anthropic sem ANTHROPIC_API_KEY → mock", () => {
    process.env["LLM_PROVIDER"] = "anthropic";
    expect(shouldUseMockLlm("planejador")).toBe(true);
  });

  it("provider=anthropic com ANTHROPIC_API_KEY → real", () => {
    process.env["LLM_PROVIDER"] = "anthropic";
    process.env["ANTHROPIC_API_KEY"] = "sk-test";
    expect(shouldUseMockLlm("planejador")).toBe(false);
  });

  it("provider=infomaniak sem INFOMANIAK_API_KEY → mock", () => {
    process.env["LLM_PROVIDER"] = "infomaniak";
    expect(shouldUseMockLlm("drota")).toBe(true);
  });

  it("provider=infomaniak com INFOMANIAK_API_KEY → real", () => {
    process.env["LLM_PROVIDER"] = "infomaniak";
    process.env["INFOMANIAK_API_KEY"] = "im-test";
    expect(shouldUseMockLlm("drota")).toBe(false);
  });

  it("provider=openai-compat SEM nenhuma API key → real (LLM local)", () => {
    // Bug raiz reproduzido em smoke STS 2026-05-24: antes desse fix, o
    // gate caía em else legacy e forçava mock mesmo com llama-server up.
    process.env["LLM_PROVIDER"] = "openai-compat";
    expect(shouldUseMockLlm("planejador")).toBe(false);
    expect(shouldUseMockLlm("drota")).toBe(false);
  });

  it("provider=openai-compat com USE_MOCK_LLM=true → mock (operador override)", () => {
    process.env["LLM_PROVIDER"] = "openai-compat";
    process.env["USE_MOCK_LLM"] = "true";
    expect(shouldUseMockLlm("planejador")).toBe(true);
  });

  it("per-step provider override é respeitado", () => {
    process.env["LLM_PROVIDER"] = "anthropic"; // global
    process.env["DROTA_PROVIDER"] = "openai-compat"; // override
    // anthropic gate vs openai-compat gate
    expect(shouldUseMockLlm("planejador")).toBe(true); // anthropic sem key
    expect(shouldUseMockLlm("drota")).toBe(false); // openai-compat sem key OK
  });
});

describe("constants exposure", () => {
  it("DEFAULT_PROVIDERS é Infomaniak everywhere", () => {
    for (const v of Object.values(DEFAULT_PROVIDERS)) expect(v).toBe("infomaniak");
  });
  it("DEFAULT_MODELS preenchido pra todos os steps", () => {
    expect(DEFAULT_MODELS["planejador"]).toBeTruthy();
    expect(DEFAULT_MODELS["drota"]).toBeTruthy();
    expect(DEFAULT_MODELS["persona-sim"]).toBeTruthy();
    expect(DEFAULT_MODELS["haiku-triage"]).toBeTruthy();
    expect(DEFAULT_MODELS["haiku-bullying"]).toBeTruthy();
  });
  it("ANTHROPIC_FALLBACK_MODELS usa Claude", () => {
    expect(ANTHROPIC_FALLBACK_MODELS["planejador"]).toContain("claude");
    expect(ANTHROPIC_FALLBACK_MODELS["haiku-triage"]).toContain("haiku");
  });
});
