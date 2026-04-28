import { describe, it, expect } from "vitest";
import { createStableStateCache } from "../src/stable-state-cache.js";
import type { StableStateFields } from "../src/stable-state-cache.js";
import { initHelix } from "../src/helix-planner.js";

function buildFields(childId: string): StableStateFields {
  return {
    child_id: childId,
    trust_level: 0.5,
    jurisdiction_active: "jp",
    modifier_flags: [],
    operator_online: false,
    voice_profile: {},
    helix_state: initHelix(childId),
    status_matrix: { emotional: "baia" },
    stable_computed_at: Date.now(),
  };
}

describe("StableStateCache", () => {
  it("get retorna null pra childId não cacheado", () => {
    const cache = createStableStateCache();
    expect(cache.get("user-1")).toBeNull();
  });

  it("set + get roundtrip", () => {
    const cache = createStableStateCache();
    const fields = buildFields("user-1");
    cache.set("user-1", fields);
    expect(cache.get("user-1")).toEqual(fields);
  });

  it("isolamento entre child_ids", () => {
    const cache = createStableStateCache();
    cache.set("user-1", buildFields("user-1"));
    cache.set("user-2", buildFields("user-2"));
    expect(cache.get("user-1")?.child_id).toBe("user-1");
    expect(cache.get("user-2")?.child_id).toBe("user-2");
  });

  it("invalidate remove entry específica", () => {
    const cache = createStableStateCache();
    cache.set("user-1", buildFields("user-1"));
    cache.set("user-2", buildFields("user-2"));
    cache.invalidate("user-1");
    expect(cache.get("user-1")).toBeNull();
    expect(cache.get("user-2")).not.toBeNull();
  });

  it("invalidateAll limpa cache inteiro", () => {
    const cache = createStableStateCache();
    cache.set("user-1", buildFields("user-1"));
    cache.set("user-2", buildFields("user-2"));
    cache.invalidateAll();
    expect(cache.get("user-1")).toBeNull();
    expect(cache.get("user-2")).toBeNull();
  });

  it("age retorna ms desde stable_computed_at", () => {
    const cache = createStableStateCache();
    const past = Date.now() - 5000;
    cache.set("user-1", { ...buildFields("user-1"), stable_computed_at: past });
    const age = cache.age("user-1");
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(5000);
  });

  it("age retorna null pra child sem cache", () => {
    const cache = createStableStateCache();
    expect(cache.age("user-1")).toBeNull();
  });

  it("set sobrescreve idempotentemente", () => {
    const cache = createStableStateCache();
    cache.set("user-1", { ...buildFields("user-1"), trust_level: 0.3 });
    cache.set("user-1", { ...buildFields("user-1"), trust_level: 0.8 });
    expect(cache.get("user-1")?.trust_level).toBe(0.8);
  });

  it("instâncias separadas não compartilham state", () => {
    const cache1 = createStableStateCache();
    const cache2 = createStableStateCache();
    cache1.set("user-1", buildFields("user-1"));
    expect(cache2.get("user-1")).toBeNull();
  });
});
