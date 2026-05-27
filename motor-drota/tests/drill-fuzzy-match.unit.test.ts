import { describe, it, expect } from "vitest";
import {
  matchDrillAnswer,
  normalize,
} from "../src/drill-fuzzy-match.js";
import type { DrillItem } from "@ascendimacy/shared";

function makeItem(
  answer: string,
  accept_variants?: string[],
): DrillItem {
  return {
    id: "test-001",
    bank_id: "test-bank",
    type: "vocab",
    axis: "language.jp_pt",
    difficulty: 1,
    payload: { prompt: "りんご", answer, accept_variants },
  };
}

describe("normalize", () => {
  it("lowercase + remove acentos", () => {
    expect(normalize("Maçã")).toBe("maca");
    expect(normalize("PÃO")).toBe("pao");
    expect(normalize("três")).toBe("tres");
  });

  it("colapsa espaços + trim", () => {
    expect(normalize("  hello   world  ")).toBe("hello world");
  });

  it("preserva caracteres não-latinos", () => {
    expect(normalize("りんご")).toBe("りんご");
  });
});

describe("matchDrillAnswer", () => {
  it("exact match → correct", () => {
    const r = matchDrillAnswer(makeItem("maçã"), "maçã", 1000);
    expect(r.correct).toBe(true);
    expect(r.response_type).toBe("correct");
  });

  it("acento ignorado: 'maca' = 'maçã'", () => {
    const r = matchDrillAnswer(makeItem("maçã"), "maca", 1000);
    expect(r.correct).toBe(true);
    expect(r.response_type).toBe("correct");
  });

  it("case-insensitive", () => {
    const r = matchDrillAnswer(makeItem("Maçã"), "MAÇÃ", 1000);
    expect(r.correct).toBe(true);
  });

  it("accept_variants match", () => {
    const r = matchDrillAnswer(
      makeItem("cachorro", ["cão", "cao"]),
      "cão",
      1000,
    );
    expect(r.correct).toBe(true);
  });

  it("variant normalizado também faz match", () => {
    const r = matchDrillAnswer(
      makeItem("cachorro", ["cão"]),
      "cao",
      1000,
    );
    expect(r.correct).toBe(true);
  });

  it("no match → incorrect", () => {
    const r = matchDrillAnswer(makeItem("maçã"), "banana", 1000);
    expect(r.correct).toBe(false);
    expect(r.response_type).toBe("incorrect");
  });

  it("slow_correct quando latency > threshold default (5s)", () => {
    const r = matchDrillAnswer(makeItem("maçã"), "maca", 6000);
    expect(r.correct).toBe(true);
    expect(r.response_type).toBe("slow_correct");
  });

  it("override slowThresholdMs", () => {
    const fast = matchDrillAnswer(makeItem("maçã"), "maca", 2500, {
      slowThresholdMs: 3000,
    });
    expect(fast.response_type).toBe("correct");

    const slow = matchDrillAnswer(makeItem("maçã"), "maca", 3500, {
      slowThresholdMs: 3000,
    });
    expect(slow.response_type).toBe("slow_correct");
  });

  it("latency preservada no result", () => {
    const r = matchDrillAnswer(makeItem("x"), "x", 1234);
    expect(r.latency_ms).toBe(1234);
  });

  it("trim leading/trailing spaces", () => {
    const r = matchDrillAnswer(makeItem("maçã"), "  maca  ", 500);
    expect(r.correct).toBe(true);
  });
});
