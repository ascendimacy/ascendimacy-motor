/**
 * Métricas operacionais conforme Bloco 3 requisito (c):
 *   - ratio off:on screen
 *   - sessions in brejo
 *   - programa pause frequency
 *   - missed milestones
 *
 * Função pura sobre SessionTrace[].
 */

import type { SessionTrace } from "@ascendimacy/shared";
import type { OperationalMetrics } from "./types.js";

/**
 * Classificação off/on screen — heurística simples baseada em
 * content type + sacrifice_type:
 *   - content.type in {challenge, dynamic} com sacrifice_type 'act'|'create'|'observe' → off-screen
 *   - demais → on-screen (chat)
 *
 * A API é uma função pura que retorna 'off' ou 'on'.
 */
function classifyTurnLocation(
  contentType: string | undefined,
  sacrificeType: string | undefined,
): "off" | "on" {
  const offTypes = new Set(["challenge", "dynamic", "gtd_task"]);
  const offSacrifice = new Set(["act", "create", "observe"]);
  if (contentType && offTypes.has(contentType)) return "off";
  if (sacrificeType && offSacrifice.has(sacrificeType)) return "off";
  return "on";
}

export function computeMetrics(traces: SessionTrace[]): OperationalMetrics {
  let totalTurns = 0;
  let off = 0;
  let on = 0;
  let sessionsWithBrejo = 0;
  let pauses = 0;
  let lastMissedMilestones = 0;
  let sacrificeSum = 0;
  let screenSum = 0;

  const sessionIds = new Set<string>();

  for (const trace of traces) {
    sessionIds.add(trace.sessionId);
    let sessionHadBrejo = false;
    let sessionHadPause = false;
    for (const turn of trace.turns) {
      totalTurns += 1;
      // Off/on classification.
      const sel = turn.selectedContent;
      const loc = classifyTurnLocation(sel?.type, sel?.sacrifice_type);
      if (loc === "off") off += 1;
      else on += 1;

      // Brejo detection.
      const snap = turn.statusSnapshot;
      if (snap) {
        for (const v of Object.values(snap)) {
          if (v === "brejo") {
            sessionHadBrejo = true;
            break;
          }
        }
      }

      // Programa pause.
      const prog = turn.gardnerProgramSnapshot;
      if (prog?.paused) sessionHadPause = true;

      // Sacrifice + screen seconds.
      if (typeof turn.sacrificeSpent === "number") {
        sacrificeSum += turn.sacrificeSpent;
      }
      if (typeof turn.screenSeconds === "number") {
        screenSum += turn.screenSeconds;
      }

      // Missed milestones — usa sempre o último snapshot disponível.
      if (prog && typeof prog.consecutive_missed_milestones === "number") {
        lastMissedMilestones = prog.consecutive_missed_milestones;
      }
    }
    if (sessionHadBrejo) sessionsWithBrejo += 1;
    if (sessionHadPause) pauses += 1;
  }

  const totalSessions = sessionIds.size;
  const ratio = on === 0 ? (off > 0 ? Infinity : 0) : off / on;

  return {
    total_turns: totalTurns,
    total_sessions: totalSessions,
    off_on_screen_ratio: { off, on, ratio },
    sessions_in_brejo: sessionsWithBrejo,
    program_pause_frequency:
      totalSessions === 0 ? 0 : pauses / totalSessions,
    missed_milestones_total: lastMissedMilestones,
    avg_sacrifice_per_turn:
      totalTurns === 0 ? 0 : sacrificeSum / totalTurns,
    total_screen_seconds: screenSum,
  };
}
