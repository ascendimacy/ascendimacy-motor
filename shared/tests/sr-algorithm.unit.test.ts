import { describe, it, expect } from "vitest";
import { nextInterval, isMastered } from "../src/sr-algorithm.js";
import {
  DEFAULT_EASINESS,
  MIN_EASINESS,
  type DrillResponse,
  type DrillState,
} from "../src/contracts/drill-state.js";

const FRESH = {
  current_interval_days: 0,
  current_easiness: DEFAULT_EASINESS,
};

describe("nextInterval — SM-2 simplificado", () => {
  it("fresh + correct → interval 1d, easiness 2.5 → 2.6", () => {
    const { next_interval_days, next_easiness } = nextInterval(FRESH, "correct");
    expect(next_interval_days).toBe(1);
    expect(next_easiness).toBeCloseTo(2.6, 5);
  });

  it("fresh + incorrect → interval 1d, easiness 2.5 → 2.3", () => {
    const { next_interval_days, next_easiness } = nextInterval(FRESH, "incorrect");
    expect(next_interval_days).toBe(1);
    expect(next_easiness).toBeCloseTo(2.3, 5);
  });

  it("interval=1 + correct → interval 3d (transição inicial)", () => {
    const { next_interval_days } = nextInterval(
      { current_interval_days: 1, current_easiness: 2.6 },
      "correct",
    );
    expect(next_interval_days).toBe(3);
  });

  it("interval=3 + correct (ef=2.6) → 8d (round)", () => {
    const { next_interval_days } = nextInterval(
      { current_interval_days: 3, current_easiness: 2.6 },
      "correct",
    );
    // 3 * (2.6 + 0.1) = 8.1 → 8
    expect(next_interval_days).toBe(8);
  });

  it("easiness floored at MIN_EASINESS (1.3) após múltiplos incorrect", () => {
    let easiness = DEFAULT_EASINESS;
    for (let i = 0; i < 10; i++) {
      ({ next_easiness: easiness } = nextInterval(
        { current_interval_days: 5, current_easiness: easiness },
        "incorrect",
      ));
    }
    expect(easiness).toBe(MIN_EASINESS);
    expect(easiness).toBeGreaterThanOrEqual(MIN_EASINESS);
  });

  it("incorrect sempre reseta intervalo para 1d", () => {
    const r = nextInterval(
      { current_interval_days: 30, current_easiness: 2.8 },
      "incorrect",
    );
    expect(r.next_interval_days).toBe(1);
  });

  it("slow_correct sobe intervalo mas easiness cai um pouco", () => {
    // q=3: ef + (0.1 - 2*(0.08 + 0.04)) = ef + (0.1 - 0.24) = ef - 0.14
    const r = nextInterval(
      { current_interval_days: 7, current_easiness: 2.5 },
      "slow_correct",
    );
    expect(r.next_easiness).toBeCloseTo(2.36, 5);
    // 7 * 2.36 = 16.52 → 17
    expect(r.next_interval_days).toBe(17);
  });

  it("correct repetido eleva easiness gradualmente", () => {
    let s = { current_interval_days: 0, current_easiness: DEFAULT_EASINESS };
    for (let i = 0; i < 3; i++) {
      const r = nextInterval(s, "correct");
      s = {
        current_interval_days: r.next_interval_days,
        current_easiness: r.next_easiness,
      };
    }
    expect(s.current_easiness).toBeGreaterThan(DEFAULT_EASINESS);
  });

  it("incorrect at MIN_EASINESS keeps it at MIN_EASINESS (no underflow)", () => {
    const r = nextInterval(
      { current_interval_days: 5, current_easiness: MIN_EASINESS },
      "incorrect",
    );
    expect(r.next_easiness).toBe(MIN_EASINESS);
  });
});

function makeAttempts(pattern: DrillResponse[]): DrillResponse[] {
  return pattern;
}

describe("isMastered", () => {
  it("retorna false com menos de 5 attempts", () => {
    expect(
      isMastered({
        last_5_attempts: makeAttempts(["correct", "correct", "correct"]),
        current_interval_days: 30,
      }),
    ).toBe(false);
  });

  it("retorna false com 5 attempts mas só 3 corretas", () => {
    expect(
      isMastered({
        last_5_attempts: makeAttempts([
          "correct",
          "correct",
          "incorrect",
          "incorrect",
          "correct",
        ]),
        current_interval_days: 30,
      }),
    ).toBe(false);
  });

  it("retorna false com 4 corretas mas interval < 7", () => {
    expect(
      isMastered({
        last_5_attempts: makeAttempts([
          "correct",
          "correct",
          "correct",
          "correct",
          "incorrect",
        ]),
        current_interval_days: 3,
      }),
    ).toBe(false);
  });

  it("retorna true com 4/5 corretas + interval ≥ 7", () => {
    expect(
      isMastered({
        last_5_attempts: makeAttempts([
          "correct",
          "correct",
          "incorrect",
          "correct",
          "correct",
        ]),
        current_interval_days: 7,
      }),
    ).toBe(true);
  });

  it("retorna true com 5/5 corretas + interval grande", () => {
    expect(
      isMastered({
        last_5_attempts: makeAttempts([
          "correct",
          "correct",
          "correct",
          "correct",
          "correct",
        ]),
        current_interval_days: 30,
      }),
    ).toBe(true);
  });

  it("slow_correct conta como acerto na contagem mastery", () => {
    expect(
      isMastered({
        last_5_attempts: makeAttempts([
          "correct",
          "slow_correct",
          "correct",
          "slow_correct",
          "incorrect",
        ]),
        current_interval_days: 14,
      }),
    ).toBe(true);
  });
});
