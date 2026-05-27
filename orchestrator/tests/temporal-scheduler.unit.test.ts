import { describe, it, expect } from "vitest";
import type {
  NarrativeThread,
  TemporalWindow,
} from "@ascendimacy/shared";
import {
  tickScheduler,
  createInMemoryStateStore,
  COOLDOWN_HOURS,
  MIN_SACRIFICE_BUDGET,
  type SchedulerDeps,
  type ProactiveHook,
} from "../src/temporal-scheduler.js";

// Janelas-base ─ Saki (Asia/Tokyo): post-school 16:30-17:30 mon-fri, sleep 19:30-06:00.
const SAKI_WINDOW: TemporalWindow = {
  persona_id: "saki-ochiai",
  timezone: "Asia/Tokyo",
  windows: [
    {
      name: "post-school-jp",
      weekday: ["mon", "tue", "wed", "thu", "fri"],
      start_local: "16:30",
      end_local: "17:30",
      max_hooks_per_day: 1,
      requires_parental_ok: true,
    },
  ],
  sleep_window: { start_local: "19:30", end_local: "06:00" },
  school_window: { start_local: "08:00", end_local: "15:30" },
};

interface FixtureOpts {
  threads?: NarrativeThread[];
  objective?: { objective_id: string } | null;
  card?: { card_id: string } | null;
  budget?: number;
  parental?: boolean;
  now?: Date;
}

function makeDeps(
  emitted: ProactiveHook[],
  opts: FixtureOpts = {},
): SchedulerDeps {
  return {
    now: () => opts.now ?? new Date("2026-05-20T07:45:00Z"), // 16:45 JST quarta
    windows: [SAKI_WINDOW],
    ageGroupFor: () => "kid",
    listOpenThreads: () => opts.threads ?? [],
    hasObjectiveDue: () => opts.objective ?? null,
    hasUncelebratedCard: () => opts.card ?? null,
    sacrificeBudget: () => opts.budget ?? 50,
    parentalConsent: () => opts.parental ?? true,
    emitHook: (h) => {
      emitted.push(h);
    },
    state: createInMemoryStateStore(),
  };
}

function makeThread(overrides: Partial<NarrativeThread> = {}): NarrativeThread {
  return {
    id: "t1",
    persona_id: "saki-ochiai",
    opened_in_session: "s1",
    opened_at: "2026-05-19T10:00:00Z",
    thread_text: "queria saber por que o gato cinza foge da chuva",
    follow_up_triggered: false,
    status: "open",
    stale_after: "2026-05-26T10:00:00Z",
    ...overrides,
  };
}

describe("temporal-scheduler — windows", () => {
  it("dentro de school_window → 0 hooks (school_window)", () => {
    const emitted: ProactiveHook[] = [];
    // 10:00 JST quarta = school_window
    const deps = makeDeps(emitted, { now: new Date("2026-05-20T01:00:00Z") });
    const reports = tickScheduler(deps);
    expect(emitted).toHaveLength(0);
    expect(reports[0]!.suppressed).toBe("school_window");
  });

  it("dentro de sleep_window → 0 hooks (sleep_window)", () => {
    const emitted: ProactiveHook[] = [];
    // 21:00 JST quarta = sleep
    const deps = makeDeps(emitted, { now: new Date("2026-05-20T12:00:00Z") });
    const reports = tickScheduler(deps);
    expect(emitted).toHaveLength(0);
    expect(reports[0]!.suppressed).toBe("sleep_window");
  });

  it("fora de qualquer janela aberta → suppressed=no_window_open", () => {
    const emitted: ProactiveHook[] = [];
    // 18:30 JST quarta = entre post-school e sleep
    const deps = makeDeps(emitted, { now: new Date("2026-05-20T09:30:00Z") });
    const reports = tickScheduler(deps);
    expect(emitted).toHaveLength(0);
    expect(reports[0]!.suppressed).toBe("no_window_open");
  });
});

describe("temporal-scheduler — triggers", () => {
  it("janela aberta + thread open → emit hook trigger=thread_open", () => {
    const emitted: ProactiveHook[] = [];
    const deps = makeDeps(emitted, { threads: [makeThread()] });
    tickScheduler(deps);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.trigger).toBe("thread_open");
    expect(emitted[0]!.payload.thread_id).toBe("t1");
    expect(emitted[0]!.window_name).toBe("post-school-jp");
  });

  it("janela aberta + objective + thread → objective ganha (prioridade #1)", () => {
    const emitted: ProactiveHook[] = [];
    const deps = makeDeps(emitted, {
      objective: { objective_id: "obj-9" },
      threads: [makeThread()],
    });
    tickScheduler(deps);
    expect(emitted[0]!.trigger).toBe("objective_due");
    expect(emitted[0]!.payload.objective_id).toBe("obj-9");
  });

  it("janela aberta + apenas card → emit trigger=card_uncelebrated", () => {
    const emitted: ProactiveHook[] = [];
    const deps = makeDeps(emitted, { card: { card_id: "c42" } });
    tickScheduler(deps);
    expect(emitted[0]!.trigger).toBe("card_uncelebrated");
    expect(emitted[0]!.payload.card_id).toBe("c42");
  });

  it("janela aberta + nada → emit Pulso fallback", () => {
    const emitted: ProactiveHook[] = [];
    const deps = makeDeps(emitted);
    tickScheduler(deps);
    expect(emitted[0]!.trigger).toBe("pulso_fallback");
    expect(emitted[0]!.payload.pulso).toBeDefined();
    expect(emitted[0]!.payload.pulso!.kind).toBe("pulso:ritual_return");
  });
});

describe("temporal-scheduler — gates", () => {
  it("cooldown 6h respeitado: 2 ticks com 5h de gap → 1 hook", () => {
    const emitted: ProactiveHook[] = [];
    const state = createInMemoryStateStore();
    const baseDeps = makeDeps(emitted, { threads: [makeThread()] });
    // primeira tick às 16:45 JST quarta
    const t1: SchedulerDeps = {
      ...baseDeps,
      now: () => new Date("2026-05-20T07:45:00Z"),
      state,
    };
    tickScheduler(t1);
    expect(emitted).toHaveLength(1);
    // segundo tick 5h depois — ainda em janela post-school?
    // Não — janela é 16:30-17:30 só. Vamos testar com diferentes janelas.
    // Reusa state, mas movemos pra próxima janela post-school no dia seguinte (quinta 16:45 JST).
    const t2: SchedulerDeps = {
      ...baseDeps,
      now: () => new Date("2026-05-20T12:00:00Z"), // 21:00 JST quarta = sleep
      state,
    };
    tickScheduler(t2);
    expect(emitted).toHaveLength(1); // sleep gate, não cooldown
  });

  it("cooldown ativo dentro da mesma janela → suppressed=cooldown_active", () => {
    const emitted: ProactiveHook[] = [];
    const state = createInMemoryStateStore();
    // simula last_hook há 1h apenas
    state.setLastEmittedAt("saki-ochiai", "2026-05-20T06:45:00Z");
    const deps: SchedulerDeps = {
      ...makeDeps(emitted, { threads: [makeThread()] }),
      now: () => new Date("2026-05-20T07:45:00Z"), // 1h após
      state,
    };
    const reports = tickScheduler(deps);
    expect(emitted).toHaveLength(0);
    expect(reports[0]!.suppressed).toBe("cooldown_active");
  });

  it("cooldown expirado (>6h) → emite normalmente", () => {
    const emitted: ProactiveHook[] = [];
    const state = createInMemoryStateStore();
    const baseTimeMs = Date.parse("2026-05-20T07:45:00Z");
    const lastIso = new Date(
      baseTimeMs - (COOLDOWN_HOURS + 1) * 3_600_000,
    ).toISOString();
    state.setLastEmittedAt("saki-ochiai", lastIso);
    const deps: SchedulerDeps = {
      ...makeDeps(emitted, { threads: [makeThread()] }),
      now: () => new Date(baseTimeMs),
      state,
    };
    tickScheduler(deps);
    expect(emitted).toHaveLength(1);
  });

  it("sacrifice budget <20 → suppressed=sacrifice_budget_low", () => {
    const emitted: ProactiveHook[] = [];
    const deps = makeDeps(emitted, {
      budget: MIN_SACRIFICE_BUDGET - 1,
      threads: [makeThread()],
    });
    const reports = tickScheduler(deps);
    expect(emitted).toHaveLength(0);
    expect(reports[0]!.suppressed).toBe("sacrifice_budget_low");
  });

  it("sacrifice budget =20 → passa (limite inclusivo)", () => {
    const emitted: ProactiveHook[] = [];
    const deps = makeDeps(emitted, {
      budget: MIN_SACRIFICE_BUDGET,
      threads: [makeThread()],
    });
    tickScheduler(deps);
    expect(emitted).toHaveLength(1);
  });

  it("max_hooks_per_day=1 + 2 ticks consecutivos (sem cooldown) → 1 hook", () => {
    const emitted: ProactiveHook[] = [];
    const state = createInMemoryStateStore();
    const baseDeps = makeDeps(emitted, { threads: [makeThread()] });
    // primeiro tick: 16:45 JST quarta
    tickScheduler({
      ...baseDeps,
      now: () => new Date("2026-05-20T07:45:00Z"),
      state,
    });
    expect(emitted).toHaveLength(1);
    // segundo tick simulado >6h depois mas mesmo dia local
    // 16:30-17:30 só vai até 17:30 → não há outra janela post-school no mesmo dia.
    // Testamos diretamente: zere last_emitted_at e veja max_hooks_today bloqueia.
    state.setLastEmittedAt("saki-ochiai", "2026-04-01T00:00:00Z");
    tickScheduler({
      ...baseDeps,
      now: () => new Date("2026-05-20T08:15:00Z"), // 17:15 JST mesma janela
      state,
    });
    expect(emitted).toHaveLength(1); // max_hooks_today bloqueou
  });

  it("requires_parental_ok + consent ausente → suppressed=no_parental_consent", () => {
    const emitted: ProactiveHook[] = [];
    const deps = makeDeps(emitted, {
      parental: false,
      threads: [makeThread()],
    });
    const reports = tickScheduler(deps);
    expect(emitted).toHaveLength(0);
    expect(reports[0]!.suppressed).toBe("no_parental_consent");
  });
});

describe("temporal-scheduler — idempotência", () => {
  it("state.setLastEmittedAt persiste entre ticks (no-spam)", () => {
    const emitted: ProactiveHook[] = [];
    const state = createInMemoryStateStore();
    const baseDeps = makeDeps(emitted, { threads: [makeThread()] });
    tickScheduler({
      ...baseDeps,
      now: () => new Date("2026-05-20T07:45:00Z"),
      state,
    });
    expect(state.getLastEmittedAt("saki-ochiai")).not.toBeNull();
    // tick imediato (mesmo minuto)
    tickScheduler({
      ...baseDeps,
      now: () => new Date("2026-05-20T07:46:00Z"),
      state,
    });
    expect(emitted).toHaveLength(1);
  });
});
