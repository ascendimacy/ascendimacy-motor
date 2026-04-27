import { describe, it, expect } from "vitest";
import {
  initHelix,
  advanceProgress,
  getActivePair,
  checkRetrievalGate,
  markRetrievalDone,
  checkBossFight,
  evaluatePairActivation,
  completeCycle,
  deferDimension,
  enterVacationMode,
  exitVacationMode,
} from "../src/helix-planner.js";
import {
  CASEL_DIMS,
  DEFAULT_CYCLE_DAYS,
  DEFAULT_ROTATION_ORDER,
} from "../src/helix-state.js";
import type { HelixState } from "../src/helix-state.js";
import { inMemoryHelixRepo } from "../src/helix-repo-memory.js";

describe("initHelix", () => {
  it("retorna queue default ['SOC','SM','REL','DM'] quando firstDim='SA'", () => {
    const state = initHelix("user-1", "SA");
    expect(state.activeDimension).toBe("SA");
    expect(state.activeLevel).toBe("emerging");
    expect(state.queue).toEqual(["SOC", "SM", "REL", "DM"]);
  });

  it("usa SA como default se firstDim omitido", () => {
    const state = initHelix("user-1");
    expect(state.activeDimension).toBe("SA");
  });

  it("campos iniciais: progress=0, cycleDay=1, retrievalDone=false, vacationMode=false", () => {
    const state = initHelix("user-1");
    expect(state.progress).toBe(0);
    expect(state.cycleDay).toBe(1);
    expect(state.retrievalDone).toBe(false);
    expect(state.vacationModeActive).toBe(false);
    expect(state.previousDimension).toBeNull();
    expect(state.estimatedCycleDays).toBe(DEFAULT_CYCLE_DAYS);
    expect(state.deferred).toEqual([]);
    expect(state.completed).toEqual([]);
  });

  it("queue rotation pra firstDim != SA respeita DEFAULT_ROTATION_ORDER", () => {
    const state = initHelix("user-1", "SOC");
    // SOC está no idx 1 da rotação default ["SA","SOC","SM","REL","DM"];
    // queue = restantes em ordem: SM, REL, DM, SA
    expect(state.queue).toEqual(["SM", "REL", "DM", "SA"]);
  });

  it("CASEL_DIMS contém os 5 expected values", () => {
    expect(CASEL_DIMS).toEqual(["SA", "SM", "SOC", "REL", "DM"]);
  });
});

describe("advanceProgress", () => {
  const baseState = (): HelixState => initHelix("user-1");

  it("avança normalmente com mood neutro/alto", () => {
    const next = advanceProgress(baseState(), 0.1, 7);
    expect(next.progress).toBeCloseTo(0.1);
  });

  it("mood <= 3 bloqueia advance (CLAUDE_6 §5.3 buffer day)", () => {
    const next = advanceProgress(baseState(), 0.1, 3);
    expect(next.progress).toBe(0);
    const nextLow = advanceProgress(baseState(), 0.5, 1);
    expect(nextLow.progress).toBe(0);
  });

  it("vacationModeActive bloqueia advance", () => {
    const onVacation = enterVacationMode(baseState());
    const next = advanceProgress(onVacation, 0.5, 8);
    expect(next.progress).toBe(0);
  });

  it("clamp em [0, 1]", () => {
    let s = baseState();
    s = advanceProgress(s, 1.5, 7);
    expect(s.progress).toBe(1);
    s = advanceProgress(s, -3, 7);
    expect(s.progress).toBe(0);
  });

  it("não muta input", () => {
    const s = baseState();
    const next = advanceProgress(s, 0.3, 7);
    expect(s.progress).toBe(0);
    expect(next.progress).toBeCloseTo(0.3);
  });
});

describe("getActivePair", () => {
  it("previous=null se progress < 0.5", () => {
    const s = { ...initHelix("u-1"), progress: 0.4, previousDimension: "SA" as const };
    const pair = getActivePair(s);
    expect(pair.active).toBe("SA");
    expect(pair.previous).toBeNull();
  });

  it("previous retorna CaselDim se progress >= 0.5", () => {
    const s = { ...initHelix("u-1", "SOC"), progress: 0.5, previousDimension: "SA" as const };
    const pair = getActivePair(s);
    expect(pair.active).toBe("SOC");
    expect(pair.previous).toBe("SA");
  });

  it("previous=null quando previousDimension é null mesmo com progress alto", () => {
    const s = { ...initHelix("u-1"), progress: 0.7 };
    const pair = getActivePair(s);
    expect(pair.previous).toBeNull();
  });
});

describe("checkRetrievalGate", () => {
  it("true se progress >= 0.5 && !retrievalDone", () => {
    const s = { ...initHelix("u-1"), progress: 0.6, retrievalDone: false };
    expect(checkRetrievalGate(s)).toBe(true);
  });

  it("false se retrievalDone=true (idempotência)", () => {
    const s = { ...initHelix("u-1"), progress: 0.8, retrievalDone: true };
    expect(checkRetrievalGate(s)).toBe(false);
  });

  it("false se progress < 0.5", () => {
    const s = { ...initHelix("u-1"), progress: 0.3, retrievalDone: false };
    expect(checkRetrievalGate(s)).toBe(false);
  });

  it("markRetrievalDone seta flag e gate vira false", () => {
    const before = { ...initHelix("u-1"), progress: 0.7 };
    expect(checkRetrievalGate(before)).toBe(true);
    const after = markRetrievalDone(before);
    expect(after.retrievalDone).toBe(true);
    expect(checkRetrievalGate(after)).toBe(false);
  });
});

describe("checkBossFight", () => {
  it("true se progress >= 1.0 e dim não está em completed", () => {
    const s = { ...initHelix("u-1"), progress: 1.0 };
    expect(checkBossFight(s)).toBe(true);
  });

  it("false se dim já está em completed (boss já feito)", () => {
    const s = {
      ...initHelix("u-1"),
      progress: 1.0,
      completed: ["SA" as const],
    };
    expect(checkBossFight(s)).toBe(false);
  });

  it("false se progress < 1.0", () => {
    const s = { ...initHelix("u-1"), progress: 0.95 };
    expect(checkBossFight(s)).toBe(false);
  });
});

describe("evaluatePairActivation", () => {
  const s = initHelix("u-1");

  it("pairActivated=true → continue", () => {
    const r = evaluatePairActivation(s, true, false);
    expect(r.decision).toBe("continue");
    expect(r.reason).toMatch(/ativ/);
  });

  it("partialActivation=true → extend", () => {
    const r = evaluatePairActivation(s, false, true);
    expect(r.decision).toBe("extend");
    expect(r.reason).toMatch(/parcial|extend/);
  });

  it("nem pair nem partial → defer", () => {
    const r = evaluatePairActivation(s, false, false);
    expect(r.decision).toBe("defer");
    expect(r.reason).toMatch(/defer|n[ãa]o ativ/);
  });
});

describe("completeCycle", () => {
  it("rotação correta queue → active → completed → previous", () => {
    const s = { ...initHelix("u-1"), progress: 1.0 };
    expect(s.activeDimension).toBe("SA");
    expect(s.queue).toEqual(["SOC", "SM", "REL", "DM"]);

    const next = completeCycle(s);
    expect(next.activeDimension).toBe("SOC"); // queue.shift()
    expect(next.previousDimension).toBe("SA"); // antiga active
    expect(next.completed).toEqual(["SA"]); // active → completed
    expect(next.queue).toEqual(["SM", "REL", "DM"]); // resto
    expect(next.progress).toBe(0); // reset
    expect(next.cycleDay).toBe(1);
    expect(next.retrievalDone).toBe(false);
    expect(next.activeLevel).toBe("emerging");
  });

  it("queue vazia: mantém active mas sobe level + reseta ciclo", () => {
    const s = {
      ...initHelix("u-1"),
      activeDimension: "DM" as const,
      activeLevel: "emerging" as const,
      progress: 1.0,
      queue: [],
      completed: ["SA", "SOC", "SM", "REL"] as const,
    };
    const next = completeCycle(s);
    expect(next.activeDimension).toBe("DM"); // mantém
    expect(next.activeLevel).toBe("developing"); // sobe
    expect(next.completed).toContain("DM");
    expect(next.progress).toBe(0);
  });

  it("não duplica em completed se dim já está lá", () => {
    const s = {
      ...initHelix("u-1"),
      activeDimension: "SA" as const,
      progress: 1.0,
      queue: [],
      completed: ["SA"] as const,
    };
    const next = completeCycle(s);
    expect(next.completed.filter((d) => d === "SA")).toHaveLength(1);
  });
});

describe("deferDimension", () => {
  it("move active pra deferred[]; próxima da queue assume", () => {
    const s = initHelix("u-1");
    const next = deferDimension(s, "par não ativou em 14d", "2026-05-15");
    expect(next.activeDimension).toBe("SOC"); // queue.shift()
    expect(next.previousDimension).toBe("SA");
    expect(next.deferred).toHaveLength(1);
    expect(next.deferred[0]).toEqual({
      dimension: "SA",
      reason: "par não ativou em 14d",
      retryAfter: "2026-05-15",
    });
    expect(next.queue).toEqual(["SM", "REL", "DM"]);
    expect(next.progress).toBe(0);
  });

  it("queue vazia: registra deferred mas mantém active", () => {
    const s = { ...initHelix("u-1"), queue: [], completed: [] };
    const next = deferDimension(s, "fim de fila", "2026-06-01");
    expect(next.activeDimension).toBe("SA"); // mantém
    expect(next.deferred).toHaveLength(1);
  });
});

describe("enterVacationMode / exitVacationMode", () => {
  it("enterVacationMode liga flag", () => {
    const s = initHelix("u-1");
    expect(s.vacationModeActive).toBe(false);
    const onVac = enterVacationMode(s);
    expect(onVac.vacationModeActive).toBe(true);
  });

  it("exitVacationMode desliga flag", () => {
    const onVac = enterVacationMode(initHelix("u-1"));
    const offVac = exitVacationMode(onVac);
    expect(offVac.vacationModeActive).toBe(false);
  });

  it("ciclo: enter → advance bloqueado → exit → advance funciona", () => {
    let s = initHelix("u-1");
    s = enterVacationMode(s);
    s = advanceProgress(s, 0.3, 8);
    expect(s.progress).toBe(0); // bloqueado
    s = exitVacationMode(s);
    s = advanceProgress(s, 0.3, 8);
    expect(s.progress).toBeCloseTo(0.3); // destravado
  });
});

describe("inMemoryHelixRepo", () => {
  it("load retorna null pra user sem state", async () => {
    const repo = inMemoryHelixRepo();
    expect(await repo.load("user-1")).toBeNull();
  });

  it("save + load roundtrip", async () => {
    const repo = inMemoryHelixRepo();
    const state = initHelix("user-1");
    await repo.save(state);
    const loaded = await repo.load("user-1");
    expect(loaded).toEqual(state);
  });

  it("isolamento entre users", async () => {
    const repo = inMemoryHelixRepo([initHelix("user-2", "DM")]);
    expect(await repo.load("user-1")).toBeNull();
    expect(await repo.load("user-2")).not.toBeNull();
  });
});

describe("DEFAULT_ROTATION_ORDER sanity", () => {
  it("contém todos CASEL_DIMS uma vez", () => {
    expect(DEFAULT_ROTATION_ORDER).toHaveLength(CASEL_DIMS.length);
    for (const dim of CASEL_DIMS) {
      expect(DEFAULT_ROTATION_ORDER).toContain(dim);
    }
  });
});
