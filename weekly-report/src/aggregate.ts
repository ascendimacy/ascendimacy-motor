/**
 * Aggregate — funções puras sobre SessionTrace[] → WeeklyReportData.
 * Zero I/O, zero clock ambiente, determinístico.
 */

import type {
  SessionTrace,
  StatusMatrix,
  StatusValue,
  GardnerChannel,
  CaselDimension,
  EmittedCard,
} from "@ascendimacy/shared";
import { isStatusValue } from "@ascendimacy/shared";
import type {
  CardSummary,
  EmittedCardSummary,
  IgnitionEvent,
  StatusComparison,
  AspirationSignal,
  WeeklyReportOptions,
  WeeklyReportData,
  WeekRange,
} from "./types.js";
import { computeMetrics } from "./metrics.js";

/** Derive cards (conteúdo que virou sessão) a partir dos turns. */
export function aggregateCards(traces: SessionTrace[]): CardSummary[] {
  const out: CardSummary[] = [];
  for (const trace of traces) {
    for (const turn of trace.turns) {
      const sel = turn.selectedContent;
      if (!sel) continue;
      out.push({
        content_id: sel.id,
        content_type: sel.type,
        domain: sel.domain,
        casel_targets: turn.caselTargetsTouched ?? [],
        gardner_channels: turn.gardnerChannelsObserved ?? [],
        sacrifice_spent: turn.sacrificeSpent ?? 0,
        turn: turn.turnNumber,
        session_id: trace.sessionId,
        timestamp: turn.timestamp,
      });
    }
  }
  return out;
}

/**
 * Compara status matrix da semana atual (inferida do último turn)
 * vs prev matrix (opcional). Retorna 1 entry por dimensão.
 */
export function compareStatusMatrices(
  traces: SessionTrace[],
  previous: StatusMatrix | undefined,
): StatusComparison[] {
  // Pega último statusSnapshot não-vazio dos traces.
  let latest: StatusMatrix | undefined;
  for (let i = traces.length - 1; i >= 0; i--) {
    const t = traces[i];
    if (!t) continue;
    for (let j = t.turns.length - 1; j >= 0; j--) {
      const snap = t.turns[j]?.statusSnapshot;
      if (snap) {
        latest = snap;
        break;
      }
    }
    if (latest) break;
  }
  if (!latest) return [];

  const dimensions = new Set<string>([
    ...Object.keys(latest),
    ...(previous ? Object.keys(previous) : []),
  ]);
  const out: StatusComparison[] = [];
  for (const dim of dimensions) {
    const prev = previous?.[dim];
    const curr = latest[dim];
    if (!curr || !isStatusValue(curr)) continue;
    let trend: StatusComparison["trend"];
    if (!prev) trend = "new";
    else if (prev === curr) trend = "stable";
    else trend = compareTrend(prev, curr);
    out.push({
      dimension: dim,
      previous: prev ?? null,
      current: curr,
      trend,
    });
  }
  return out.sort((a, b) => a.dimension.localeCompare(b.dimension));
}

function compareTrend(prev: StatusValue, curr: StatusValue): StatusComparison["trend"] {
  const rank: Record<StatusValue, number> = { brejo: 0, baia: 1, pasto: 2 };
  if (rank[curr] > rank[prev]) return "improved";
  if (rank[curr] < rank[prev]) return "worsened";
  return "stable";
}

/**
 * Detecta ignições — turns onde ≥3 canais Gardner × ≥2 dimensões CASEL
 * foram simultaneamente ativados (§2.2 paper).
 */
export function detectIgnitions(traces: SessionTrace[]): IgnitionEvent[] {
  const out: IgnitionEvent[] = [];
  for (const trace of traces) {
    for (const turn of trace.turns) {
      const channels = turn.gardnerChannelsObserved ?? [];
      const dims = turn.caselTargetsTouched ?? [];
      const uniqC = uniqueGardner(channels);
      const uniqD = uniqueCasel(dims);
      const ignited = uniqC.length >= 3 && uniqD.length >= 2;
      if (uniqC.length === 0 && uniqD.length === 0) continue;
      out.push({
        session_id: trace.sessionId,
        turn: turn.turnNumber,
        gardner_channels: uniqC,
        casel_dimensions: uniqD,
        ignited,
      });
    }
  }
  return out;
}

function uniqueGardner(arr: GardnerChannel[]): GardnerChannel[] {
  return Array.from(new Set(arr));
}

function uniqueCasel(arr: CaselDimension[]): CaselDimension[] {
  return Array.from(new Set(arr));
}

/**
 * Extrai sinais de aspiração emergente — domínios/temas que aparecem em
 * múltiplos turns. Threshold: ≥3 ocorrências.
 */
export function extractAspirations(traces: SessionTrace[]): AspirationSignal[] {
  const byKey = new Map<string, {
    occurrences: number;
    firstTurn: number;
    lastTurn: number;
    contexts: string[];
  }>();

  for (const trace of traces) {
    for (const turn of trace.turns) {
      const sel = turn.selectedContent;
      if (!sel) continue;
      const key = sel.domain;
      if (!key) continue;
      const entry = byKey.get(key);
      const context = sel.id;
      if (!entry) {
        byKey.set(key, {
          occurrences: 1,
          firstTurn: turn.turnNumber,
          lastTurn: turn.turnNumber,
          contexts: [context],
        });
      } else {
        entry.occurrences += 1;
        entry.lastTurn = turn.turnNumber;
        if (!entry.contexts.includes(context)) entry.contexts.push(context);
      }
    }
  }

  const out: AspirationSignal[] = [];
  for (const [key, entry] of byKey.entries()) {
    if (entry.occurrences < 3) continue;
    out.push({
      key,
      occurrences: entry.occurrences,
      first_seen_turn: entry.firstTurn,
      last_seen_turn: entry.lastTurn,
      contexts: entry.contexts.slice(0, 5),
    });
  }
  return out.sort((a, b) => b.occurrences - a.occurrences);
}

/** Pega estado Gardner do último turn disponível. */
function latestProgramStatus(traces: SessionTrace[]): WeeklyReportData["program_status"] {
  for (let i = traces.length - 1; i >= 0; i--) {
    const t = traces[i];
    if (!t) continue;
    for (let j = t.turns.length - 1; j >= 0; j--) {
      const snap = t.turns[j]?.gardnerProgramSnapshot;
      if (snap) {
        return {
          current_week: snap.current_week,
          current_phase: snap.current_phase,
          paused: snap.paused,
          paused_reason: snap.paused_reason,
        };
      }
    }
  }
  return {
    current_week: null,
    current_phase: null,
    paused: false,
  };
}

/** Inferir range de datas a partir dos traces (min/max timestamps). */
function deriveWeekRange(traces: SessionTrace[]): WeekRange {
  let minTs: string | undefined;
  let maxTs: string | undefined;
  for (const t of traces) {
    for (const turn of t.turns) {
      const ts = turn.timestamp ?? t.startedAt;
      if (!minTs || ts < minTs) minTs = ts;
      if (!maxTs || ts > maxTs) maxTs = ts;
    }
  }
  return {
    from: minTs ?? new Date().toISOString(),
    to: maxTs ?? new Date().toISOString(),
  };
}

/** Converte EmittedCard em summary pro relatório. */
export function summarizeEmittedCard(card: EmittedCard): EmittedCardSummary {
  return {
    card_id: card.card_id,
    archetype_id: card.archetype_id,
    title: card.spec_snapshot.archetype.name,
    narrative: card.front.narrative,
    image_url: card.front.image_url,
    rarity: card.spec_snapshot.archetype.rarity,
    cheat_code: card.back.cheat_code,
    serial_number: card.back.serial_number,
    qr_payload: card.back.qr_payload,
    casel_dimension: card.back.casel_dimension,
    gardner_channel_icon: card.back.gardner_channel_icon,
    issued_at: card.issued_at,
    approved_at: card.approved_at,
    emitted_at: card.emitted_at,
  };
}

/** Entrypoint: SessionTrace[] + opts → WeeklyReportData. */
export function aggregate(
  traces: SessionTrace[],
  childName: string,
  opts: WeeklyReportOptions = {},
): WeeklyReportData {
  const childAge = traces.find((t) => t.personaAge !== undefined)?.personaAge ?? null;
  const emittedCards = (opts.emitted_cards ?? []).map(summarizeEmittedCard);
  return {
    child_name: childName,
    child_age: childAge,
    week: opts.week_range ?? deriveWeekRange(traces),
    program_status: latestProgramStatus(traces),
    cards: aggregateCards(traces),
    emitted_cards: emittedCards,
    status_comparison: compareStatusMatrices(traces, opts.previous_matrix),
    ignitions: detectIgnitions(traces),
    aspirations: extractAspirations(traces),
    metrics: computeMetrics(traces),
  };
}
