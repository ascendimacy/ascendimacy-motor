import { describe, it, expect } from "vitest";
import type { TemporalWindow } from "@ascendimacy/shared";
import {
  tickScheduler,
  createInMemoryStateStore,
  type SchedulerDeps,
  type ProactiveHook,
} from "../src/temporal-scheduler.js";
import {
  checkAndDeliverMC1,
  type Mc1DeliveryEvent,
  type Mc1PendingRecord,
  type Mc1SchedulerDeps,
} from "../src/mc1-scheduler.js";

const PT_TEXT =
  "Olá. Sou o Brota. Teu pai mencionou que eu ia falar contigo.";

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

interface StoreOpts {
  pending?: Mc1PendingRecord | null;
}

function makeMc1Deps(emitted: Mc1DeliveryEvent[], opts: StoreOpts = {}): {
  deps: Mc1SchedulerDeps;
  state: {
    pendingValue: Mc1PendingRecord | null;
    marked: Array<{ id: number; deliveredAt: string }>;
  };
} {
  const state = {
    pendingValue: opts.pending ?? null,
    marked: [] as Array<{ id: number; deliveredAt: string }>,
  };
  const deps: Mc1SchedulerDeps = {
    now: () => new Date("2026-05-20T07:45:00Z"),
    nextPending: () => state.pendingValue,
    markDelivered: (id, deliveredAt) => {
      if (state.pendingValue?.id === id) {
        state.marked.push({ id, deliveredAt });
        state.pendingValue = null;
        return true;
      }
      return false;
    },
    emitDelivery: (e) => {
      emitted.push(e);
    },
  };
  return { deps, state };
}

describe("mc1-scheduler — checkAndDeliverMC1 (unit)", () => {
  it("retorna delivered=false quando nada pending", () => {
    const emitted: Mc1DeliveryEvent[] = [];
    const { deps } = makeMc1Deps(emitted);
    const result = checkAndDeliverMC1(deps, "ryo-ochiai");
    expect(result.delivered).toBe(false);
    expect(result.event).toBeUndefined();
    expect(emitted).toHaveLength(0);
  });

  it("entrega MC1 quando pending: marca delivered + emite event", () => {
    const emitted: Mc1DeliveryEvent[] = [];
    const { deps, state } = makeMc1Deps(emitted, {
      pending: {
        id: 42,
        personaId: "ryo-ochiai",
        approvedText: PT_TEXT,
        targetWindowName: "post-school-jp",
        scheduledAt: "2026-05-19T10:00:00.000Z",
      },
    });
    const result = checkAndDeliverMC1(deps, "ryo-ochiai");
    expect(result.delivered).toBe(true);
    expect(result.event?.mc1ScheduledId).toBe(42);
    expect(result.event?.text).toBe(PT_TEXT);
    expect(result.event?.windowName).toBe("post-school-jp");
    expect(state.marked).toEqual([
      { id: 42, deliveredAt: "2026-05-20T07:45:00.000Z" },
    ]);
    expect(emitted).toHaveLength(1);
  });

  it("não entrega 2x: segundo tick após delivery vê nada pending", () => {
    const emitted: Mc1DeliveryEvent[] = [];
    const { deps } = makeMc1Deps(emitted, {
      pending: {
        id: 1,
        personaId: "ryo-ochiai",
        approvedText: PT_TEXT,
        targetWindowName: "post-school-jp",
        scheduledAt: "2026-05-19T10:00:00.000Z",
      },
    });
    checkAndDeliverMC1(deps, "ryo-ochiai");
    const second = checkAndDeliverMC1(deps, "ryo-ochiai");
    expect(second.delivered).toBe(false);
    expect(emitted).toHaveLength(1);
  });

  it("race-safe: markDelivered=false (lost race) → não emite", () => {
    const emitted: Mc1DeliveryEvent[] = [];
    const deps: Mc1SchedulerDeps = {
      now: () => new Date("2026-05-20T07:45:00Z"),
      nextPending: () => ({
        id: 7,
        personaId: "ryo-ochiai",
        approvedText: PT_TEXT,
        targetWindowName: "post-school-jp",
        scheduledAt: "2026-05-19T10:00:00.000Z",
      }),
      markDelivered: () => false,
      emitDelivery: (e) => {
        emitted.push(e);
      },
    };
    const result = checkAndDeliverMC1(deps, "ryo-ochiai");
    expect(result.delivered).toBe(false);
    expect(emitted).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Integration com temporal-scheduler — MC1 como trigger prioritário
// ─────────────────────────────────────────────────────────────────────

interface FixtureOpts {
  pendingMc1?: Mc1PendingRecord | null;
  parental?: boolean;
  budget?: number;
  now?: Date;
}

function makeIntegrationDeps(
  emittedHooks: ProactiveHook[],
  emittedMc1: Mc1DeliveryEvent[],
  opts: FixtureOpts = {},
): SchedulerDeps {
  const mc1State = {
    pendingValue: opts.pendingMc1 ?? null,
  };
  const mc1Deps: Mc1SchedulerDeps = {
    now: () => opts.now ?? new Date("2026-05-20T07:45:00Z"),
    nextPending: () => mc1State.pendingValue,
    markDelivered: (id, _ts) => {
      if (mc1State.pendingValue?.id === id) {
        mc1State.pendingValue = null;
        return true;
      }
      return false;
    },
    emitDelivery: (e) => {
      emittedMc1.push(e);
    },
  };
  return {
    now: () => opts.now ?? new Date("2026-05-20T07:45:00Z"),
    windows: [SAKI_WINDOW],
    ageGroupFor: () => "kid",
    listOpenThreads: () => [
      {
        id: "t1",
        persona_id: "saki-ochiai",
        opened_in_session: "s1",
        opened_at: "2026-05-19T10:00:00Z",
        thread_text: "thread",
        follow_up_triggered: false,
        status: "open",
        stale_after: "2026-05-26T10:00:00Z",
      },
    ],
    hasObjectiveDue: () => ({ objective_id: "obj-9" }),
    hasUncelebratedCard: () => null,
    sacrificeBudget: () => opts.budget ?? 50,
    parentalConsent: () => opts.parental ?? true,
    emitHook: (h) => {
      emittedHooks.push(h);
    },
    state: createInMemoryStateStore(),
    mc1: mc1Deps,
  };
}

describe("temporal-scheduler — MC1 priority integration", () => {
  it("janela aberta + MC1 pending → MC1 ganha sobre objective/thread", () => {
    const hooks: ProactiveHook[] = [];
    const mc1s: Mc1DeliveryEvent[] = [];
    const deps = makeIntegrationDeps(hooks, mc1s, {
      pendingMc1: {
        id: 99,
        personaId: "saki-ochiai",
        approvedText: PT_TEXT,
        targetWindowName: "post-school-jp",
        scheduledAt: "2026-05-19T10:00:00.000Z",
      },
    });
    const reports = tickScheduler(deps);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.trigger).toBe("mc1_first_message");
    expect(hooks[0]!.payload.mc1?.mc1ScheduledId).toBe(99);
    expect(hooks[0]!.payload.mc1?.text).toBe(PT_TEXT);
    expect(reports[0]!.trigger).toBe("mc1_first_message");
    expect(mc1s).toHaveLength(1);
  });

  it("sem MC1 pending → comportamento legado (4 triggers)", () => {
    const hooks: ProactiveHook[] = [];
    const mc1s: Mc1DeliveryEvent[] = [];
    const deps = makeIntegrationDeps(hooks, mc1s, { pendingMc1: null });
    tickScheduler(deps);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.trigger).toBe("objective_due");
    expect(mc1s).toHaveLength(0);
  });

  it("janela fechada (school_window) + MC1 pending → NÃO entrega", () => {
    const hooks: ProactiveHook[] = [];
    const mc1s: Mc1DeliveryEvent[] = [];
    const deps = makeIntegrationDeps(hooks, mc1s, {
      pendingMc1: {
        id: 99,
        personaId: "saki-ochiai",
        approvedText: PT_TEXT,
        targetWindowName: "post-school-jp",
        scheduledAt: "2026-05-19T10:00:00.000Z",
      },
      // 10:00 JST quarta = school_window
      now: new Date("2026-05-20T01:00:00Z"),
    });
    const reports = tickScheduler(deps);
    expect(hooks).toHaveLength(0);
    expect(mc1s).toHaveLength(0);
    expect(reports[0]!.suppressed).toBe("school_window");
  });

  it("parental consent ausente + MC1 pending → NÃO entrega", () => {
    const hooks: ProactiveHook[] = [];
    const mc1s: Mc1DeliveryEvent[] = [];
    const deps = makeIntegrationDeps(hooks, mc1s, {
      pendingMc1: {
        id: 99,
        personaId: "saki-ochiai",
        approvedText: PT_TEXT,
        targetWindowName: "post-school-jp",
        scheduledAt: "2026-05-19T10:00:00.000Z",
      },
      parental: false,
    });
    const reports = tickScheduler(deps);
    expect(hooks).toHaveLength(0);
    expect(mc1s).toHaveLength(0);
    expect(reports[0]!.suppressed).toBe("no_parental_consent");
  });

  it("MC1 entregue uma vez: segundo tick imediato cai para trigger regular", () => {
    const hooks: ProactiveHook[] = [];
    const mc1s: Mc1DeliveryEvent[] = [];
    const deps = makeIntegrationDeps(hooks, mc1s, {
      pendingMc1: {
        id: 1,
        personaId: "saki-ochiai",
        approvedText: PT_TEXT,
        targetWindowName: "post-school-jp",
        scheduledAt: "2026-05-19T10:00:00.000Z",
      },
    });
    tickScheduler(deps);
    expect(hooks[0]!.trigger).toBe("mc1_first_message");
    // Segundo tick: pending agora é null. Mas cooldown 6h vai bloquear, OK.
    tickScheduler(deps);
    expect(hooks).toHaveLength(1);
  });

  it("MC1 ignora sacrifice_budget_low (gate só vale para triggers regulares)", () => {
    const hooks: ProactiveHook[] = [];
    const mc1s: Mc1DeliveryEvent[] = [];
    const deps = makeIntegrationDeps(hooks, mc1s, {
      pendingMc1: {
        id: 99,
        personaId: "saki-ochiai",
        approvedText: PT_TEXT,
        targetWindowName: "post-school-jp",
        scheduledAt: "2026-05-19T10:00:00.000Z",
      },
      budget: 0,
    });
    tickScheduler(deps);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.trigger).toBe("mc1_first_message");
  });
});
