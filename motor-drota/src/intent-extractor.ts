/**
 * intent-extractor — detector de intenção temporal declarada pelo aprendiz.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-s1-objetivos-declarados-v0.md
 *
 * Pipeline:
 *  1. Regex rule-based (PT + JP) — fast path, alta precisão
 *  2. Fallback LLM (Haiku 1-shot) — só se regex não confiar e caller injetou
 *
 * Returns DeclaredObjective | null. Sem id (caller atribui via repo).
 *
 * Confidence:
 *  - 1.0 quando target_date veio literal (data ISO ou "DD/MM")
 *  - 0.7 quando inferido (e.g., "fim do mês", "em 2 semanas")
 *  - confidence < 0.5 → null (não confia)
 */

import { randomUUID } from "node:crypto";
import type { DeclaredObjective } from "@ascendimacy/shared";

export interface IntentExtractorInput {
  message: string;
  personaId: string;
  sessionId: string;
  /** ISO8601 string. Default: Date.now(). */
  now?: string;
  /** Callback LLM 1-shot. Recebe message, retorna parcial sem id/status. */
  llmFallback?: (input: { message: string; nowIso: string }) => Promise<
    | (Pick<DeclaredObjective, "statement" | "target_date"> &
        Partial<Pick<DeclaredObjective, "axis">>)
    | null
  >;
}

interface RegexCandidate {
  statement: string;
  target_date: string;
  confidence: number;
  axis?: string;
}

const MIN_CONFIDENCE = 0.5;

function endOfMonthIso(now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0));
  return new Date(
    Date.UTC(
      lastDay.getUTCFullYear(),
      lastDay.getUTCMonth(),
      lastDay.getUTCDate(),
      23,
      59,
      59,
    ),
  ).toISOString();
}

function addDaysIso(now: Date, days: number): string {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

function tryParseExplicitDate(token: string, now: Date): string | null {
  // ISO 8601 — full datetime ou só date
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(token)) {
    const ms = Date.parse(token);
    if (!Number.isNaN(ms)) {
      // Se for só date sem hora, normalizar pra fim do dia UTC.
      if (token.length === 10) {
        return `${token}T23:59:59.000Z`;
      }
      return new Date(ms).toISOString();
    }
  }
  // DD/MM ou DD/MM/YYYY
  const ddmm = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(token);
  if (ddmm) {
    const day = Number(ddmm[1]);
    const month = Number(ddmm[2]) - 1;
    const yearRaw = ddmm[3];
    let year = now.getUTCFullYear();
    if (yearRaw !== undefined) {
      year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
    }
    const date = new Date(Date.UTC(year, month, day, 23, 59, 59));
    if (!Number.isNaN(date.getTime())) {
      // Se data já passou no ano corrente sem ano explícito, próximo ano.
      if (yearRaw === undefined && date.getTime() < now.getTime()) {
        date.setUTCFullYear(year + 1);
      }
      return date.toISOString();
    }
  }
  return null;
}

const WEEKDAYS_PT: Record<string, number> = {
  domingo: 0,
  "segunda": 1,
  "segunda-feira": 1,
  terca: 2,
  terça: 2,
  "terca-feira": 2,
  "terça-feira": 2,
  quarta: 3,
  "quarta-feira": 3,
  quinta: 4,
  "quinta-feira": 4,
  sexta: 5,
  "sexta-feira": 5,
  sabado: 6,
  sábado: 6,
};

function nextWeekday(now: Date, targetDow: number): string {
  const cur = now.getUTCDay();
  let delta = targetDow - cur;
  if (delta <= 0) delta += 7;
  return addDaysIso(now, delta);
}

function inferTargetDate(
  phrase: string,
  now: Date,
): { iso: string; inferred: boolean } | null {
  const norm = phrase.trim().toLowerCase();

  // Literal date attempt
  const literal = tryParseExplicitDate(norm, now);
  if (literal !== null) return { iso: literal, inferred: false };

  // PT: "fim do mês" / "fim deste mês"
  if (/\bfim (?:do|deste|de\s+esse)\s*m[eê]s\b/.test(norm)) {
    return { iso: endOfMonthIso(now), inferred: true };
  }
  // JP: "今月末" / "今月の末"
  if (/今月(?:の)?末/.test(phrase)) {
    return { iso: endOfMonthIso(now), inferred: true };
  }

  // PT: "N semanas" / "N dias" / "N meses" (sem prefixo "em" — quando o
  // regex outer já consumiu o "em" ou "até")
  const nUnit = /(\d{1,3})\s*(dias?|semanas?|meses?)/.exec(norm);
  if (nUnit) {
    const n = Number(nUnit[1]);
    const unit = nUnit[2] ?? "";
    const days = unit.startsWith("semana")
      ? n * 7
      : unit.startsWith("mes")
        ? n * 30
        : n;
    return { iso: addDaysIso(now, days), inferred: true };
  }

  // PT: weekday standalone ("sexta", "segunda-feira", etc.)
  const dowToken = norm.trim();
  if (dowToken in WEEKDAYS_PT) {
    return {
      iso: nextWeekday(now, WEEKDAYS_PT[dowToken]!),
      inferred: true,
    };
  }

  // JP: "N週間" / "N日"
  const jpN = /(\d{1,3})\s*(週間|日|か月|ヶ月)/.exec(phrase);
  if (jpN) {
    const n = Number(jpN[1]);
    const unit = jpN[2];
    const days = unit === "週間" ? n * 7 : unit === "日" ? n : n * 30;
    return { iso: addDaysIso(now, days), inferred: true };
  }

  return null;
}

const PT_PATTERNS: RegExp[] = [
  /quero\s+(?<what>.+?)\s+(?:at[ée]|em)\s+(?<when>.+?)(?:[.!?]|$)/i,
  /vou\s+(?<what>.+?)\s+(?:at[ée]|em)\s+(?<when>.+?)(?:[.!?]|$)/i,
  /pretendo\s+(?<what>.+?)\s+(?:at[ée]|em)\s+(?<when>.+?)(?:[.!?]|$)/i,
  /meta[:\s]+(?<what>.+?)\s+(?:at[ée]|em)\s+(?<when>.+?)(?:[.!?]|$)/i,
];

const JP_PATTERNS: RegExp[] = [
  // 〜まで〜したい / 〜までに〜する
  /(?<when>.+?)(?:まで(?:に)?)(?<what>.+?)(?:したい|する|やる)(?:[.!?。！？]|$)/,
  // N週間で〜したい / N日で〜する
  /(?<when>\d+\s*(?:週間|日|か月|ヶ月|時間))で(?<what>.+?)(?:したい|する|やる|覚えたい|マスターしたい)(?:[.!?。！？]|$)/,
];

function tryRegex(message: string, now: Date): RegexCandidate | null {
  for (const re of PT_PATTERNS) {
    const m = re.exec(message);
    if (m?.groups?.["what"] && m.groups["when"]) {
      const what = m.groups["what"].trim();
      const when = m.groups["when"].trim();
      const date = inferTargetDate(when, now);
      if (date === null) continue;
      const statement = what.slice(0, 200);
      return {
        statement,
        target_date: date.iso,
        confidence: date.inferred ? 0.7 : 1.0,
      };
    }
  }
  for (const re of JP_PATTERNS) {
    const m = re.exec(message);
    if (m?.groups?.["what"] && m.groups["when"]) {
      const what = m.groups["what"].trim();
      const when = m.groups["when"].trim();
      const date = inferTargetDate(when, now);
      if (date === null) continue;
      return {
        statement: what.slice(0, 200),
        target_date: date.iso,
        confidence: date.inferred ? 0.7 : 1.0,
      };
    }
  }
  return null;
}

export async function extractIntent(
  input: IntentExtractorInput,
): Promise<DeclaredObjective | null> {
  const nowIso = input.now ?? new Date().toISOString();
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) return null;

  const regex = tryRegex(input.message, now);
  if (regex !== null && regex.confidence >= MIN_CONFIDENCE) {
    return buildObjective({
      personaId: input.personaId,
      sessionId: input.sessionId,
      nowIso,
      statement: regex.statement,
      targetDate: regex.target_date,
      ...(regex.axis !== undefined ? { axis: regex.axis } : {}),
    });
  }

  if (input.llmFallback !== undefined) {
    try {
      const llm = await input.llmFallback({
        message: input.message,
        nowIso,
      });
      if (llm !== null) {
        return buildObjective({
          personaId: input.personaId,
          sessionId: input.sessionId,
          nowIso,
          statement: llm.statement.slice(0, 200),
          targetDate: llm.target_date,
          ...(llm.axis !== undefined ? { axis: llm.axis } : {}),
        });
      }
    } catch {
      // fail-soft — LLM erro vira "sem extração"
    }
  }
  return null;
}

function buildObjective(args: {
  personaId: string;
  sessionId: string;
  nowIso: string;
  statement: string;
  targetDate: string;
  axis?: string;
}): DeclaredObjective {
  return {
    id: randomUUID(),
    persona_id: args.personaId,
    declared_at: args.nowIso,
    declared_in_session: args.sessionId,
    target_date: args.targetDate,
    statement: args.statement,
    ...(args.axis !== undefined ? { axis: args.axis } : {}),
    status: "active",
  };
}
