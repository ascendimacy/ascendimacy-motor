/**
 * Temporal scheduler B1 — hooks proativos por janela cultural.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b1-hooks-temporais-v0.md
 *
 * Polling in-orchestrator (default 60s, configurável). A cada tick:
 *   1. Para cada persona com TemporalWindow:
 *      a. Calcula hora local na timezone da persona.
 *      b. Skip se dentro de sleep_window ou school_window.
 *      c. Verifica se há janela aberta agora; se não, skip.
 *      d. Aplica gates (cooldown 6h, max_hooks_per_day, sacrifice budget≥20,
 *         parental consent se requires_parental_ok).
 *      e. Avalia 4 triggers em ordem: objective due → thread open →
 *         card uncelebrated → pulso fallback.
 *      f. Emite ContentItem `hook:proactive_message` via deps.emitHook.
 *
 * Idempotência: state.getLastEmittedAt persiste em SQLite — restart do
 * BFF não dispara hooks duplicados.
 *
 * Pure-functional: scheduler é injetável (deps), facilita STS testing
 * com virtual clock.
 */

import type {
  NarrativeThread,
  TemporalWindow,
  TemporalWindowEntry,
  TemporalExclusionWindow,
  Weekday,
} from "@ascendimacy/shared";
import type { PulsoContent, PulsoAgeGroup } from "./pulso-emitter.js";
import { emitPulso } from "./pulso-emitter.js";

// ─────────────────────────────────────────────────────────────────────────
// Constantes (spec §gates)
// ─────────────────────────────────────────────────────────────────────────

export const DEFAULT_POLL_INTERVAL_MS = 60_000;
export const COOLDOWN_HOURS = 6;
const COOLDOWN_MS = COOLDOWN_HOURS * 3_600_000;
export const MIN_SACRIFICE_BUDGET = 20;

// ─────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────

export type HookTrigger =
  | "objective_due"
  | "thread_open"
  | "card_uncelebrated"
  | "pulso_fallback";

export interface ProactiveHook {
  kind: "hook:proactive_message";
  persona_id: string;
  window_name: string;
  emitted_at: string;
  trigger: HookTrigger;
  /** Payload varia conforme trigger; thread/objective/card têm referências. */
  payload: {
    thread_id?: string;
    objective_id?: string;
    card_id?: string;
    pulso?: PulsoContent;
  };
}

export type SuppressionReason =
  | "no_window_open"
  | "sleep_window"
  | "school_window"
  | "cooldown_active"
  | "max_hooks_reached"
  | "sacrifice_budget_low"
  | "no_parental_consent";

export interface SchedulerStateStore {
  getLastEmittedAt(personaId: string): string | null;
  setLastEmittedAt(personaId: string, iso: string): void;
  /** Conta hooks emitidos no dia local (yyyy-mm-dd) — pra max_hooks_per_day. */
  getHooksToday(personaId: string, localDay: string): number;
  incrementHooksToday(personaId: string, localDay: string): void;
}

export interface SchedulerDeps {
  /** Wall clock (injetável p/ STS virtual clock). */
  now(): Date;
  /** Configs por persona (uma TemporalWindow cada). */
  windows: TemporalWindow[];
  /** Grupo etário pra Pulso (kid vs adult). */
  ageGroupFor(personaId: string): PulsoAgeGroup;
  /** Threads abertos p/ trigger #2. */
  listOpenThreads(personaId: string): NarrativeThread[];
  /** Trigger #1: objetivo com drift_check_due_at próximo? */
  hasObjectiveDue(personaId: string): { objective_id: string } | null;
  /** Trigger #3: card emitido >24h sem celebração? */
  hasUncelebratedCard(personaId: string): { card_id: string } | null;
  /** Gate: sacrifice budget remaining. */
  sacrificeBudget(personaId: string): number;
  /** Gate parental (Kids): consent ledger contém aprovação p/ esta window. */
  parentalConsent(personaId: string, windowName: string): boolean;
  /** Sink: para onde o hook vai (queue ContentItem). */
  emitHook(hook: ProactiveHook): void;
  /** Estado persistente (last_hook_emitted_at + hooks/dia). */
  state: SchedulerStateStore;
}

export interface TickReport {
  persona_id: string;
  emitted: ProactiveHook | null;
  suppressed?: SuppressionReason;
  trigger?: HookTrigger;
}

// ─────────────────────────────────────────────────────────────────────────
// Time helpers
// ─────────────────────────────────────────────────────────────────────────

const WEEKDAY_FROM_INTL: Record<string, Weekday> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

interface LocalParts {
  weekday: Weekday;
  minuteOfDay: number;
  localDay: string;
}

function getLocalParts(now: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const hour = parseInt(m.hour ?? "0", 10);
  const minute = parseInt(m.minute ?? "0", 10);
  // en-GB sometimes emits "24" for midnight; normalize.
  const safeHour = hour === 24 ? 0 : hour;
  return {
    weekday: WEEKDAY_FROM_INTL[m.weekday ?? "Mon"] ?? "mon",
    minuteOfDay: safeHour * 60 + minute,
    localDay: `${m.year}-${m.month}-${m.day}`,
  };
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Inclusive start, exclusive end. Wraps midnight when start > end. */
function withinWindow(nowMin: number, start: string, end: string): boolean {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s <= e) return nowMin >= s && nowMin < e;
  return nowMin >= s || nowMin < e;
}

function isInExclusion(
  nowMin: number,
  excl: TemporalExclusionWindow | undefined,
): boolean {
  if (!excl) return false;
  return withinWindow(nowMin, excl.start_local, excl.end_local);
}

function isInEntry(
  nowMin: number,
  weekday: Weekday,
  entry: TemporalWindowEntry,
): boolean {
  if (!entry.weekday.includes(weekday)) return false;
  return withinWindow(nowMin, entry.start_local, entry.end_local);
}

// ─────────────────────────────────────────────────────────────────────────
// Core: tickScheduler
// ─────────────────────────────────────────────────────────────────────────

/**
 * Roda 1 passada do scheduler. Idempotente: ler estado + decidir + emitir.
 * Retorna 1 TickReport por persona configurada.
 */
export function tickScheduler(deps: SchedulerDeps): TickReport[] {
  const reports: TickReport[] = [];
  const now = deps.now();
  const nowIso = now.toISOString();

  for (const tw of deps.windows) {
    const local = getLocalParts(now, tw.timezone);

    if (isInExclusion(local.minuteOfDay, tw.sleep_window)) {
      reports.push({
        persona_id: tw.persona_id,
        emitted: null,
        suppressed: "sleep_window",
      });
      continue;
    }
    if (isInExclusion(local.minuteOfDay, tw.school_window)) {
      reports.push({
        persona_id: tw.persona_id,
        emitted: null,
        suppressed: "school_window",
      });
      continue;
    }

    const openEntry = tw.windows.find((w) =>
      isInEntry(local.minuteOfDay, local.weekday, w),
    );
    if (!openEntry) {
      reports.push({
        persona_id: tw.persona_id,
        emitted: null,
        suppressed: "no_window_open",
      });
      continue;
    }

    // Parental gate
    if (
      openEntry.requires_parental_ok &&
      !deps.parentalConsent(tw.persona_id, openEntry.name)
    ) {
      reports.push({
        persona_id: tw.persona_id,
        emitted: null,
        suppressed: "no_parental_consent",
      });
      continue;
    }

    // Cooldown gate (6h)
    const last = deps.state.getLastEmittedAt(tw.persona_id);
    if (last && now.getTime() - Date.parse(last) < COOLDOWN_MS) {
      reports.push({
        persona_id: tw.persona_id,
        emitted: null,
        suppressed: "cooldown_active",
      });
      continue;
    }

    // Max hooks/day gate
    const todayCount = deps.state.getHooksToday(tw.persona_id, local.localDay);
    if (todayCount >= openEntry.max_hooks_per_day) {
      reports.push({
        persona_id: tw.persona_id,
        emitted: null,
        suppressed: "max_hooks_reached",
      });
      continue;
    }

    // Sacrifice budget gate
    if (deps.sacrificeBudget(tw.persona_id) < MIN_SACRIFICE_BUDGET) {
      reports.push({
        persona_id: tw.persona_id,
        emitted: null,
        suppressed: "sacrifice_budget_low",
      });
      continue;
    }

    // Avalia 4 triggers em ordem
    const hook = evaluateTriggers(deps, tw, openEntry, nowIso);
    deps.emitHook(hook);
    deps.state.setLastEmittedAt(tw.persona_id, nowIso);
    deps.state.incrementHooksToday(tw.persona_id, local.localDay);
    reports.push({
      persona_id: tw.persona_id,
      emitted: hook,
      trigger: hook.trigger,
    });
  }

  return reports;
}

function evaluateTriggers(
  deps: SchedulerDeps,
  tw: TemporalWindow,
  entry: TemporalWindowEntry,
  nowIso: string,
): ProactiveHook {
  // 1. objective due
  const obj = deps.hasObjectiveDue(tw.persona_id);
  if (obj) {
    return {
      kind: "hook:proactive_message",
      persona_id: tw.persona_id,
      window_name: entry.name,
      emitted_at: nowIso,
      trigger: "objective_due",
      payload: { objective_id: obj.objective_id },
    };
  }

  // 2. thread open
  const threads = deps.listOpenThreads(tw.persona_id);
  if (threads.length > 0) {
    return {
      kind: "hook:proactive_message",
      persona_id: tw.persona_id,
      window_name: entry.name,
      emitted_at: nowIso,
      trigger: "thread_open",
      payload: { thread_id: threads[0]!.id },
    };
  }

  // 3. card uncelebrated
  const card = deps.hasUncelebratedCard(tw.persona_id);
  if (card) {
    return {
      kind: "hook:proactive_message",
      persona_id: tw.persona_id,
      window_name: entry.name,
      emitted_at: nowIso,
      trigger: "card_uncelebrated",
      payload: { card_id: card.card_id },
    };
  }

  // 4. pulso fallback
  const pulso = emitPulso({
    persona_id: tw.persona_id,
    age_group: deps.ageGroupFor(tw.persona_id),
    window_name: entry.name,
    now_iso: nowIso,
  });
  return {
    kind: "hook:proactive_message",
    persona_id: tw.persona_id,
    window_name: entry.name,
    emitted_at: nowIso,
    trigger: "pulso_fallback",
    payload: { pulso },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// In-memory state store (para testes; SQLite-backed pode vir depois)
// ─────────────────────────────────────────────────────────────────────────

export function createInMemoryStateStore(): SchedulerStateStore {
  const last = new Map<string, string>();
  const daily = new Map<string, number>(); // key = persona|day
  return {
    getLastEmittedAt: (id) => last.get(id) ?? null,
    setLastEmittedAt: (id, iso) => {
      last.set(id, iso);
    },
    getHooksToday: (id, day) => daily.get(`${id}|${day}`) ?? 0,
    incrementHooksToday: (id, day) => {
      const key = `${id}|${day}`;
      daily.set(key, (daily.get(key) ?? 0) + 1);
    },
  };
}
