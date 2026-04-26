/**
 * Tests Shannon entropy do candidate_set (motor#25 handoff #25 B5).
 */

import { describe, it, expect } from "vitest";
import { shannonEntropy } from "../src/plan.js";

describe("shannonEntropy", () => {
  it("array vazio → 0", () => {
    expect(shannonEntropy([])).toBe(0);
  });

  it("array de 1 elemento → 0", () => {
    expect(shannonEntropy(["a"])).toBe(0);
  });

  it("todos iguais → 0", () => {
    expect(shannonEntropy(["a", "a", "a"])).toBe(0);
  });

  it("2 elementos distintos com prob 0.5 cada → 1.0 bit", () => {
    expect(shannonEntropy(["a", "b"])).toBeCloseTo(1.0, 5);
  });

  it("4 elementos uniformes → 2 bits", () => {
    expect(shannonEntropy(["a", "b", "c", "d"])).toBeCloseTo(2.0, 5);
  });

  it("8 elementos uniformes → 3 bits", () => {
    expect(
      shannonEntropy(["a", "b", "c", "d", "e", "f", "g", "h"]),
    ).toBeCloseTo(3.0, 5);
  });

  it("distribuição enviesada tem entropy < log2(n)", () => {
    // 75% A + 25% B = 0.811...
    const e = shannonEntropy(["a", "a", "a", "b"]);
    expect(e).toBeLessThan(1.0);
    expect(e).toBeGreaterThan(0.5);
  });

  it("captura carrossel — pool repetitivo dá entropy baixa", () => {
    // Cenário smoke-3d-bumped: 5 calls, todas dolphin. Entropy = 0.
    const carousel = ["bio_dolphin_names", "bio_dolphin_names", "bio_dolphin_names"];
    expect(shannonEntropy(carousel)).toBe(0);
    // Pool diverso: 5 items distintos = log2(5) ≈ 2.32
    const diverse = ["a", "b", "c", "d", "e"];
    expect(shannonEntropy(diverse)).toBeCloseTo(Math.log2(5), 4);
  });
});
