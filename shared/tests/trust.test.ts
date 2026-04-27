import { describe, it, expect } from "vitest";
import {
  TRUST_LEVELS,
  TRUST_THRESHOLD_TRUSTED,
  TRUST_THRESHOLD_WARM,
  TRUST_THRESHOLD_WARMING,
  DEFAULT_AVG_MOOD,
  DEFAULT_AVG_ENGAGEMENT,
  calculateTrustScore,
  trustLabelFromScore,
  calculateTrustLevel,
  adaptDepth,
} from "../src/trust.js";
import type { TrustCacheEntry } from "../src/trust.js";
import { inMemoryTrustRepo } from "../src/trust-repo-memory.js";

describe("calculateTrustScore", () => {
  it("aplica defaults ebrota (avgMood=5, avgEngagement=5)", () => {
    expect(calculateTrustScore({ sessions: 0 })).toBe(
      0 + DEFAULT_AVG_MOOD + DEFAULT_AVG_ENGAGEMENT,
    );
  });

  it("formula (sessions × 2) + avgMood + avgEngagement", () => {
    expect(
      calculateTrustScore({ sessions: 5, avgMood: 7, avgEngagement: 6 }),
    ).toBe(5 * 2 + 7 + 6);
  });

  it("respeita avgMood/avgEngagement passados (não usa defaults)", () => {
    expect(
      calculateTrustScore({ sessions: 0, avgMood: 1, avgEngagement: 1 }),
    ).toBe(2);
  });

  it("score sobe com sessions altos", () => {
    expect(calculateTrustScore({ sessions: 20 })).toBeGreaterThanOrEqual(
      TRUST_THRESHOLD_TRUSTED,
    );
  });
});

describe("trustLabelFromScore — buckets", () => {
  it("score < 10 → cold", () => {
    expect(trustLabelFromScore(0)).toBe("cold");
    expect(trustLabelFromScore(9.99)).toBe("cold");
  });

  it("score em [10, 20) → warming", () => {
    expect(trustLabelFromScore(10)).toBe("warming");
    expect(trustLabelFromScore(19.99)).toBe("warming");
  });

  it("score em [20, 30) → warm", () => {
    expect(trustLabelFromScore(20)).toBe("warm");
    expect(trustLabelFromScore(29.99)).toBe("warm");
  });

  it("score >= 30 → trusted", () => {
    expect(trustLabelFromScore(30)).toBe("trusted");
    expect(trustLabelFromScore(100)).toBe("trusted");
  });

  it("TRUST_LEVELS contém todos os labels esperados", () => {
    expect(TRUST_LEVELS).toEqual(["cold", "warming", "warm", "trusted"]);
  });
});

describe("calculateTrustLevel — adapter 0-1", () => {
  it("score 0 → 0.0 (clamp inferior)", () => {
    expect(
      calculateTrustLevel({ sessions: 0, avgMood: 0, avgEngagement: 0 }),
    ).toBe(0);
  });

  it("score >= 30 → 1.0 (clamp superior)", () => {
    expect(calculateTrustLevel({ sessions: 30 })).toBe(1);
  });

  it("score 15 → ~0.5 (linear)", () => {
    expect(
      calculateTrustLevel({ sessions: 0, avgMood: 7.5, avgEngagement: 7.5 }),
    ).toBeCloseTo(0.5);
  });

  it("default new user (sessions=0, sem mood/engagement) → 0.33 (warming bucket)", () => {
    const level = calculateTrustLevel({ sessions: 0 });
    expect(level).toBeCloseTo(10 / 30);
    // Confirma que cai no bucket warming via label
    expect(trustLabelFromScore(calculateTrustScore({ sessions: 0 }))).toBe(
      "warming",
    );
  });
});

describe("adaptDepth — label → conversational depth", () => {
  it("cold → light", () => {
    expect(adaptDepth("cold")).toBe("light");
  });
  it("warming → light", () => {
    expect(adaptDepth("warming")).toBe("light");
  });
  it("warm → medium", () => {
    expect(adaptDepth("warm")).toBe("medium");
  });
  it("trusted → deep", () => {
    expect(adaptDepth("trusted")).toBe("deep");
  });
});

describe("inMemoryTrustRepo — port adapter", () => {
  it("loadCachedLevel retorna null quando user sem cache", async () => {
    const repo = inMemoryTrustRepo();
    expect(await repo.loadCachedLevel("user-1")).toBeNull();
  });

  it("save + load roundtrip", async () => {
    const repo = inMemoryTrustRepo();
    const entry: TrustCacheEntry = {
      userId: "user-1",
      level: 0.67,
      calculatedAt: "2026-04-27T10:00:00Z",
    };
    await repo.saveCachedLevel(entry);
    expect(await repo.loadCachedLevel("user-1")).toEqual(entry);
  });

  it("isolamento entre users — não vaza cache de user-2 pra user-1", async () => {
    const repo = inMemoryTrustRepo([
      {
        userId: "user-2",
        level: 0.9,
        calculatedAt: "2026-04-27T10:00:00Z",
      },
    ]);
    expect(await repo.loadCachedLevel("user-1")).toBeNull();
    expect(await repo.loadCachedLevel("user-2")).not.toBeNull();
  });

  it("upsert idempotente — segunda save sobrescreve", async () => {
    const repo = inMemoryTrustRepo();
    await repo.saveCachedLevel({
      userId: "user-1",
      level: 0.33,
      calculatedAt: "2026-04-27T10:00:00Z",
    });
    await repo.saveCachedLevel({
      userId: "user-1",
      level: 0.67,
      calculatedAt: "2026-04-27T11:00:00Z",
    });
    const cached = await repo.loadCachedLevel("user-1");
    expect(cached?.level).toBe(0.67);
    expect(cached?.calculatedAt).toBe("2026-04-27T11:00:00Z");
  });
});
