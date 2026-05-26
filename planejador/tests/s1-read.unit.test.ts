import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { S1, S1_CACHE_TTL_MS, type S1DataSources } from "../src/s1-read.js";

const mockSources: S1DataSources = {
  getCaselLevels: async (persona) => (persona === "ryo" ? { SA: 3, SM: 2 } : { SA: 1 }),
  getTreeZones: async () => ["raiz", "tronco"],
  getHelixPosition: async () => "active",
  getLastSession: async () => "2026-05-26T10:00:00.000Z",
};

describe("S1.read", () => {
  beforeEach(() => {
    S1.clearCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns merged LearnerSummary from 3 sources", async () => {
    const result = await S1.read({ persona: "ryo" }, mockSources);
    expect(result.persona).toBe("ryo");
    expect(result.casel_levels).toEqual({ SA: 3, SM: 2 });
    expect(result.tree_zones).toEqual(["raiz", "tronco"]);
    expect(result.helix_position).toBe("active");
    expect(result.last_session).toBe("2026-05-26T10:00:00.000Z");
    expect(result.cached_at).toBeGreaterThan(0);
  });

  it("second call returns cached result without re-fetching", async () => {
    let callCount = 0;
    const countingSources: S1DataSources = {
      ...mockSources,
      getCaselLevels: async (p) => {
        callCount++;
        return mockSources.getCaselLevels(p);
      },
    };

    const first = await S1.read({ persona: "kei" }, countingSources);
    const second = await S1.read({ persona: "kei" }, countingSources);

    expect(callCount).toBe(1);
    expect(second.cached_at).toBe(first.cached_at);
    expect(second).toStrictEqual(first);
  });

  it("re-fetches after TTL expires", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const countingSources: S1DataSources = {
      ...mockSources,
      getCaselLevels: async (p) => {
        callCount++;
        return mockSources.getCaselLevels(p);
      },
    };

    await S1.read({ persona: "saki" }, countingSources);
    expect(callCount).toBe(1);

    vi.advanceTimersByTime(S1_CACHE_TTL_MS + 1);

    await S1.read({ persona: "saki" }, countingSources);
    expect(callCount).toBe(2);
  });

  it("cache hit still within TTL does not re-fetch", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const countingSources: S1DataSources = {
      ...mockSources,
      getCaselLevels: async (p) => {
        callCount++;
        return mockSources.getCaselLevels(p);
      },
    };

    await S1.read({ persona: "saki" }, countingSources);
    vi.advanceTimersByTime(S1_CACHE_TTL_MS - 1);
    await S1.read({ persona: "saki" }, countingSources);

    expect(callCount).toBe(1);
  });

  it("isolates cache per persona", async () => {
    const ryo = await S1.read({ persona: "ryo" }, mockSources);
    const kei = await S1.read({ persona: "kei" }, mockSources);
    expect(ryo.casel_levels["SA"]).toBe(3);
    expect(kei.casel_levels["SA"]).toBe(1);
    expect(ryo.persona).toBe("ryo");
    expect(kei.persona).toBe("kei");
  });

  it("handles null helix_position and last_session", async () => {
    const nullSources: S1DataSources = {
      ...mockSources,
      getHelixPosition: async () => null,
      getLastSession: async () => null,
    };
    const result = await S1.read({ persona: "ryo" }, nullSources);
    expect(result.helix_position).toBeNull();
    expect(result.last_session).toBeNull();
  });

  it("clearCache for specific persona leaves others intact", async () => {
    let ryoFetches = 0;
    const countingSources: S1DataSources = {
      ...mockSources,
      getCaselLevels: async (p) => {
        if (p === "ryo") ryoFetches++;
        return mockSources.getCaselLevels(p);
      },
    };

    await S1.read({ persona: "ryo" }, countingSources);
    await S1.read({ persona: "kei" }, countingSources);
    S1.clearCache("ryo");
    await S1.read({ persona: "ryo" }, countingSources);
    await S1.read({ persona: "kei" }, countingSources); // should still be cached

    expect(ryoFetches).toBe(2); // fetched twice (second after clearCache)
  });
});
