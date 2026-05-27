/**
 * drift-checker — emite eventos de drift sobre DeclaredObjectives.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-s1-objetivos-declarados-v0.md
 *
 * Triggers (por evento, NÃO cron):
 *  - anniversary: target_date < now e status="active"
 *  - stagnation: 14d (kids) / 30d (adultos) sem evento que toque `axis`
 *  - conflict: novo objetivo declarado no mesmo `axis` enquanto outro ativo
 *
 * Não escreve no event_log nem muta status — emite events que o caller
 * (orchestrator + motor-execucao.log_event) dispatcha. Mantém drift-checker
 * puro e fácil de testar.
 */

import type { DeclaredObjective } from "@ascendimacy/shared";

export type DriftCheckEventType =
  | "objective_drift_check_anniversary"
  | "objective_drift_check_stagnation"
  | "objective_drift_check_conflict";

export interface DriftCheckEvent {
  type: DriftCheckEventType;
  objective_id: string;
  persona_id: string;
  axis?: string;
  detected_at: string;
  evidence_summary: string;
}

export interface DriftCheckerConfig {
  /** Dias sem evento no axis pra disparar stagnation. Default: 14 (crianças). */
  stagnationThresholdDays: number;
}

export const DEFAULT_KIDS_DRIFT_CONFIG: DriftCheckerConfig = {
  stagnationThresholdDays: 14,
};

export const DEFAULT_ADULTS_DRIFT_CONFIG: DriftCheckerConfig = {
  stagnationThresholdDays: 30,
};

export interface DriftCheckerSources {
  /** Lista objetivos ativos do persona. */
  listActiveObjectives: (personaId: string) => Promise<DeclaredObjective[]>;
  /** Último ISO timestamp de event que tocou `axis` pro persona. Null = nunca. */
  lastEventOnAxis: (
    personaId: string,
    axis: string,
  ) => Promise<string | null>;
}

export interface RunDriftChecksInput {
  personaId: string;
  now: string;
  sources: DriftCheckerSources;
  config?: DriftCheckerConfig;
  /** Se fornecido, dispara conflict check pro axis do novo objetivo. */
  newlyDeclaredObjective?: DeclaredObjective;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

export async function runDriftChecks(
  input: RunDriftChecksInput,
): Promise<DriftCheckEvent[]> {
  const config = input.config ?? DEFAULT_KIDS_DRIFT_CONFIG;
  const active = await input.sources.listActiveObjectives(input.personaId);
  const events: DriftCheckEvent[] = [];

  for (const obj of active) {
    // Anniversary: target_date passou
    if (Date.parse(obj.target_date) < Date.parse(input.now)) {
      events.push({
        type: "objective_drift_check_anniversary",
        objective_id: obj.id,
        persona_id: obj.persona_id,
        ...(obj.axis !== undefined ? { axis: obj.axis } : {}),
        detected_at: input.now,
        evidence_summary: `target_date ${obj.target_date} passou (now=${input.now}); statement="${obj.statement}"`,
      });
    }

    // Stagnation: sem evento no axis nos últimos N dias
    if (obj.axis !== undefined) {
      const last = await input.sources.lastEventOnAxis(
        obj.persona_id,
        obj.axis,
      );
      const reference = last ?? obj.declared_at;
      const idleDays = daysBetween(reference, input.now);
      if (idleDays >= config.stagnationThresholdDays) {
        events.push({
          type: "objective_drift_check_stagnation",
          objective_id: obj.id,
          persona_id: obj.persona_id,
          axis: obj.axis,
          detected_at: input.now,
          evidence_summary: `${idleDays}d sem evento no axis="${obj.axis}" (limite=${config.stagnationThresholdDays}d); último=${reference}`,
        });
      }
    }
  }

  // Conflict: novo objetivo no mesmo axis de outro ativo
  if (input.newlyDeclaredObjective?.axis !== undefined) {
    const newAxis = input.newlyDeclaredObjective.axis;
    const conflicts = active.filter(
      (o) => o.axis === newAxis && o.id !== input.newlyDeclaredObjective?.id,
    );
    for (const c of conflicts) {
      events.push({
        type: "objective_drift_check_conflict",
        objective_id: c.id,
        persona_id: c.persona_id,
        axis: c.axis,
        detected_at: input.now,
        evidence_summary: `novo objetivo "${input.newlyDeclaredObjective.statement}" no axis="${newAxis}" conflita com existente "${c.statement}"`,
      });
    }
  }

  return events;
}
