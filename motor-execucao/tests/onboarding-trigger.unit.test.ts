/**
 * Unit tests — onboarding-trigger.ts (S-T-09-03 / ops#994).
 *
 * Deps injetadas, zero rede, zero LLM real. Cobre:
 * - shouldTriggerActionMenuGeneration: detection pura
 * - triggerActionMenuGeneration: fire-and-forget + log events
 */

import { describe, it, expect, vi } from "vitest";
import type { ActionMenu } from "@ascendimacy/shared";

import {
  shouldTriggerActionMenuGeneration,
  triggerActionMenuGeneration,
  type OnboardingTriggerDeps,
  type MenuGeneratorInput,
  type MenuGeneratorWarning,
} from "../src/onboarding-trigger.js";

function fakeValidMenu(personaId: string): ActionMenu {
  return {
    persona_id: personaId,
    schema_version: "v0.2.0",
    generated_at: "2026-05-14T10:00:00.000Z",
    source: { trust_level: 0.1 },
    items: [
      {
        id: "esp-01",
        type: "strategy",
        content: "mock item",
        weight: 0.5,
        played_as: "espelho",
        intensity: "soft",
        is_critical: false,
      },
    ],
  };
}

function makeMockDeps(
  overrides: Partial<OnboardingTriggerDeps> = {},
): OnboardingTriggerDeps {
  return {
    generateMenu: vi.fn(async (input: MenuGeneratorInput) =>
      fakeValidMenu(input.personaId),
    ),
    loadProfile: vi.fn(() => ({ preferences: { interests: ["tênis"] } })),
    saveMenu: vi.fn(async () => "/tmp/mock-saved.json"),
    resolveHint: vi.fn(() => ({
      persona_id: "ryo-ochiai",
      archetype: "deflective",
      bias: [],
    })),
    baseDir: "/tmp/test-profiles",
    ...overrides,
  };
}

const onboardingValid = {
  is_final_step: true,
  playbook_kind: "onboarding",
  personaId: "ryo-ochiai",
};

describe("shouldTriggerActionMenuGeneration", () => {
  it("retorna true para metadata válido (3 keys presentes)", () => {
    expect(shouldTriggerActionMenuGeneration(onboardingValid)).toBe(true);
  });

  it("retorna false quando metadata é undefined", () => {
    expect(shouldTriggerActionMenuGeneration(undefined)).toBe(false);
  });

  it("retorna false quando is_final_step !== true", () => {
    expect(
      shouldTriggerActionMenuGeneration({
        ...onboardingValid,
        is_final_step: false,
      }),
    ).toBe(false);
    expect(
      shouldTriggerActionMenuGeneration({
        ...onboardingValid,
        is_final_step: "yes",
      }),
    ).toBe(false);
  });

  it("retorna false quando playbook_kind !== 'onboarding'", () => {
    expect(
      shouldTriggerActionMenuGeneration({
        ...onboardingValid,
        playbook_kind: "session",
      }),
    ).toBe(false);
  });

  it("retorna false quando personaId é vazio ou não-string", () => {
    expect(
      shouldTriggerActionMenuGeneration({
        ...onboardingValid,
        personaId: "",
      }),
    ).toBe(false);
    expect(
      shouldTriggerActionMenuGeneration({
        ...onboardingValid,
        personaId: 42,
      }),
    ).toBe(false);
    expect(
      shouldTriggerActionMenuGeneration({
        ...onboardingValid,
        personaId: undefined,
      }),
    ).toBe(false);
  });

  it("retorna false quando metadata é objeto vazio", () => {
    expect(shouldTriggerActionMenuGeneration({})).toBe(false);
  });
});

describe("triggerActionMenuGeneration — fire-and-forget", () => {
  it("happy path: chama generateMenu + saveMenu + emite log success", async () => {
    const logs: Array<{ code: string; message: string }> = [];
    const deps = makeMockDeps({
      onLog: (e) => logs.push({ code: e.code, message: e.message }),
    });

    triggerActionMenuGeneration(onboardingValid, deps);

    // Fire-and-forget — espera microtasks
    await new Promise((r) => setTimeout(r, 50));

    expect(deps.generateMenu).toHaveBeenCalledTimes(1);
    expect(deps.loadProfile).toHaveBeenCalledWith("ryo-ochiai");
    expect(deps.resolveHint).toHaveBeenCalledWith("ryo-ochiai");
    expect(deps.saveMenu).toHaveBeenCalledTimes(1);
    expect(logs.find((l) => l.code === "menu_generated")).toBeDefined();
  });

  it("returns void imediatamente (não bloqueia)", () => {
    const deps = makeMockDeps();
    const result = triggerActionMenuGeneration(onboardingValid, deps);
    expect(result).toBeUndefined();
  });

  it("skip silently quando metadata não bate detection", async () => {
    const logs: Array<{ code: string }> = [];
    const deps = makeMockDeps({
      onLog: (e) => logs.push({ code: e.code }),
    });

    triggerActionMenuGeneration({ is_final_step: false } as Record<string, unknown>, deps);
    await new Promise((r) => setTimeout(r, 20));

    expect(deps.generateMenu).not.toHaveBeenCalled();
    expect(logs.find((l) => l.code === "trigger_skipped")).toBeDefined();
  });

  it("loga profile_not_found se loadProfile retorna null", async () => {
    const logs: Array<{ code: string }> = [];
    const deps = makeMockDeps({
      loadProfile: vi.fn(() => null),
      onLog: (e) => logs.push({ code: e.code }),
    });

    triggerActionMenuGeneration(onboardingValid, deps);
    await new Promise((r) => setTimeout(r, 50));

    expect(deps.generateMenu).not.toHaveBeenCalled();
    expect(logs.find((l) => l.code === "profile_not_found")).toBeDefined();
  });

  it("loga generation_failed se generateMenu retorna null", async () => {
    const logs: Array<{ code: string; details?: Record<string, unknown> }> = [];
    const deps = makeMockDeps({
      generateMenu: vi.fn(async () => null),
      onLog: (e) => logs.push({ code: e.code, details: e.details }),
    });

    triggerActionMenuGeneration(onboardingValid, deps);
    await new Promise((r) => setTimeout(r, 50));

    expect(deps.saveMenu).not.toHaveBeenCalled();
    const failLog = logs.find((l) => l.code === "generation_failed");
    expect(failLog).toBeDefined();
  });

  it("loga trigger_error e silencia exceptions de generateMenu", async () => {
    const logs: Array<{ code: string; message: string }> = [];
    const deps = makeMockDeps({
      generateMenu: vi.fn(async () => {
        throw new Error("LLM network blip");
      }),
      onLog: (e) => logs.push({ code: e.code, message: e.message }),
    });

    expect(() => triggerActionMenuGeneration(onboardingValid, deps)).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));

    const errLog = logs.find((l) => l.code === "trigger_error");
    expect(errLog).toBeDefined();
    expect(errLog!.message).toContain("LLM network blip");
  });

  it("loga trigger_error se saveMenu falha", async () => {
    const logs: Array<{ code: string; message: string }> = [];
    const deps = makeMockDeps({
      saveMenu: vi.fn(async () => {
        throw new Error("EACCES: read-only filesystem");
      }),
      onLog: (e) => logs.push({ code: e.code, message: e.message }),
    });

    triggerActionMenuGeneration(onboardingValid, deps);
    await new Promise((r) => setTimeout(r, 50));

    const errLog = logs.find((l) => l.code === "trigger_error");
    expect(errLog).toBeDefined();
    expect(errLog!.message).toContain("EACCES");
  });

  it("propaga warnings de generateMenu pro log de success", async () => {
    const logs: Array<{ code: string; details?: Record<string, unknown> }> = [];
    const deps = makeMockDeps({
      generateMenu: vi.fn(async (input, options) => {
        options?.onWarning?.({
          code: "schema_error_first",
          message: "first attempt invalid",
        });
        return fakeValidMenu(input.personaId);
      }),
      onLog: (e) => logs.push({ code: e.code, details: e.details }),
    });

    triggerActionMenuGeneration(onboardingValid, deps);
    await new Promise((r) => setTimeout(r, 50));

    const okLog = logs.find((l) => l.code === "menu_generated");
    expect(okLog).toBeDefined();
    expect(okLog!.details?.warningsCount).toBe(1);
  });

  it("usa trust=0.1 cold + eixosState=[] + injected hint", async () => {
    const deps = makeMockDeps();
    triggerActionMenuGeneration(onboardingValid, deps);
    await new Promise((r) => setTimeout(r, 50));

    const callArgs = (deps.generateMenu as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]![0] as MenuGeneratorInput;
    expect(callArgs.personaId).toBe("ryo-ochiai");
    expect(callArgs.trustLevel).toBe(0.1);
    expect(callArgs.eixosState).toEqual([]);
    expect(callArgs.profile).toBeDefined();
    expect(callArgs.personaHint).toBeDefined();
  });
});
