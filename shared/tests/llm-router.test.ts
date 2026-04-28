/**
 * Tests llm-router (motor#21) — provider selection + model routing + max_tokens.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getProviderForStep,
  getModelForStep,
  getMaxTokensForStep,
  shouldEnableThinking,
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
  it("default anthropic pra todos os steps (motor-simplificacao-v1 Haiku-em-tudo)", () => {
    expect(getProviderForStep("planejador")).toBe("anthropic");
    expect(getProviderForStep("drota")).toBe("anthropic");
    expect(getProviderForStep("persona-sim")).toBe("anthropic");
    expect(getProviderForStep("haiku-triage")).toBe("anthropic");
    expect(getProviderForStep("haiku-bullying")).toBe("anthropic");
  });

  it("PLANEJADOR_PROVIDER override per-step", () => {
    process.env["PLANEJADOR_PROVIDER"] = "infomaniak";
    expect(getProviderForStep("planejador")).toBe("infomaniak");
    expect(getProviderForStep("drota")).toBe("anthropic"); // não afeta outros
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

  it("valor inválido em env → fallback default (anthropic)", () => {
    process.env["PLANEJADOR_PROVIDER"] = "openai"; // não é "anthropic" nem "infomaniak"
    expect(getProviderForStep("planejador")).toBe("anthropic"); // default
  });

  it("step desconhecido → infomaniak fallback (legado pré-haiku-em-tudo)", () => {
    // getProviderForStep tem fallback hardcoded "infomaniak" pra steps fora
    // do enum. Step desconhecido não deveria existir em prática (LLM_STEPS
    // é exhaustivo), mas o fallback é defensivo.
    expect(getProviderForStep("unknown-step")).toBe("infomaniak");
  });
});

describe("getProviderForStep com provider local (vLLM)", () => {
  it("LLM_PROVIDER=local → todos os steps retornam local", () => {
    process.env["LLM_PROVIDER"] = "local";
    expect(getProviderForStep("drota")).toBe("local");
    expect(getProviderForStep("planejador")).toBe("local");
    expect(getProviderForStep("unified-assessor")).toBe("local");
  });

  it("DROTA_PROVIDER=local → step específico, outros mantêm default", () => {
    process.env["DROTA_PROVIDER"] = "local";
    expect(getProviderForStep("drota")).toBe("local");
    expect(getProviderForStep("planejador")).toBe("anthropic"); // default
  });

  it("step-specific local beats global anthropic", () => {
    process.env["LLM_PROVIDER"] = "anthropic";
    process.env["DROTA_PROVIDER"] = "local";
    expect(getProviderForStep("drota")).toBe("local");
    expect(getProviderForStep("planejador")).toBe("anthropic");
  });
});

describe("getModelForStep com provider local (vLLM)", () => {
  it("provider=local sem env → default gpt-oss-20b", () => {
    delete process.env["LOCAL_LLM_MODEL"];
    expect(getModelForStep("drota", "local")).toBe("gpt-oss-20b");
  });

  it("provider=local com LOCAL_LLM_MODEL → respeita env", () => {
    process.env["LOCAL_LLM_MODEL"] = "qwen3-8b";
    expect(getModelForStep("drota", "local")).toBe("qwen3-8b");
  });

  it("provider=local em todos os steps retorna mesmo modelo (single-model stack)", () => {
    process.env["LOCAL_LLM_MODEL"] = "gpt-oss-20b";
    expect(getModelForStep("planejador", "local")).toBe("gpt-oss-20b");
    expect(getModelForStep("drota", "local")).toBe("gpt-oss-20b");
    expect(getModelForStep("unified-assessor", "local")).toBe("gpt-oss-20b");
    expect(getModelForStep("haiku-triage", "local")).toBe("gpt-oss-20b");
  });
});

describe("getModelForStep", () => {
  it("default Haiku 4.5 em todos os steps (motor-simplificacao-v1 Haiku-em-tudo)", () => {
    // Pós-downsizing 28-abr (segunda iteração): stack inteira em Anthropic
    // Haiku 4.5. Override per-step via env <STEP>_MODEL + <STEP>_PROVIDER.
    const HAIKU = "claude-haiku-4-5-20251001";
    expect(getModelForStep("planejador")).toBe(HAIKU);
    expect(getModelForStep("drota")).toBe(HAIKU);
    expect(getModelForStep("persona-sim")).toBe(HAIKU);
    expect(getModelForStep("haiku-triage")).toBe(HAIKU);
    expect(getModelForStep("haiku-bullying")).toBe(HAIKU);
    expect(getModelForStep("signal-extractor")).toBe(HAIKU);
    expect(getModelForStep("mood-extractor")).toBe(HAIKU);
    expect(getModelForStep("unified-assessor")).toBe(HAIKU);
  });

  it("provider=anthropic → Haiku 4.5 em todos (motor-simplificacao-v1)", () => {
    // Pós-Haiku-em-tudo: ANTHROPIC_FALLBACK_MODELS é homogêneo.
    expect(getModelForStep("planejador", "anthropic")).toBe("claude-haiku-4-5-20251001");
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
});

describe("constants exposure", () => {
  it("DEFAULT_PROVIDERS é Anthropic everywhere (motor-simplificacao-v1 Haiku-em-tudo)", () => {
    // motor-simplificacao-v1 segunda iteração (Jun, 28-abr): stack inteira em
    // Anthropic Haiku 4.5. Reverte tentativa Infomaniak granite por limitações
    // em JSON estruturado + qualidade conversacional.
    for (const v of Object.values(DEFAULT_PROVIDERS)) {
      expect(v).toBe("anthropic");
    }
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
