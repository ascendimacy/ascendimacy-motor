/**
 * Strategy Plan Repository — persistência + queries do StrategyPlan.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-25-session-phases-journey-stages-strategist.md §5 §10.2
 */

import type { Database as DatabaseType } from "better-sqlite3";
import type {
  StrategyPlan,
  TargetDemonstration,
  PlaybookCompositionStep,
} from "@ascendimacy/shared";

interface StrategyPlanRow {
  session_id: string;
  subject_id: string;
  composed_at: string;
  target_demonstrations_json: string;
  playbook_composition_json: string;
  overall_success_criteria: string | null;
  fallback_strategy: string | null;
  subject_map_snapshot_json: string | null;
  demonstrations_observed_json: string | null;
}

function rowToPlan(row: StrategyPlanRow): StrategyPlan {
  return {
    session_id: row.session_id,
    subject_id: row.subject_id,
    composed_at: row.composed_at,
    target_demonstrations: JSON.parse(row.target_demonstrations_json) as TargetDemonstration[],
    playbook_composition: JSON.parse(row.playbook_composition_json) as PlaybookCompositionStep[],
    overall_success_criteria: row.overall_success_criteria ?? "",
    fallback_strategy: row.fallback_strategy ?? undefined,
    subject_map_snapshot: row.subject_map_snapshot_json
      ? JSON.parse(row.subject_map_snapshot_json)
      : undefined,
    demonstrations_observed: row.demonstrations_observed_json
      ? (JSON.parse(row.demonstrations_observed_json) as TargetDemonstration[])
      : undefined,
  };
}

const UPSERT_SQL = `
  INSERT INTO strategy_plans (
    session_id, subject_id, composed_at,
    target_demonstrations_json, playbook_composition_json,
    overall_success_criteria, fallback_strategy,
    subject_map_snapshot_json, demonstrations_observed_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(session_id) DO UPDATE SET
    target_demonstrations_json = excluded.target_demonstrations_json,
    playbook_composition_json = excluded.playbook_composition_json,
    overall_success_criteria = excluded.overall_success_criteria,
    fallback_strategy = excluded.fallback_strategy,
    subject_map_snapshot_json = excluded.subject_map_snapshot_json,
    demonstrations_observed_json = excluded.demonstrations_observed_json
`;

export function upsertStrategyPlan(
  db: DatabaseType,
  plan: StrategyPlan,
): void {
  db.prepare(UPSERT_SQL).run(
    plan.session_id,
    plan.subject_id,
    plan.composed_at,
    JSON.stringify(plan.target_demonstrations),
    JSON.stringify(plan.playbook_composition),
    plan.overall_success_criteria ?? null,
    plan.fallback_strategy ?? null,
    plan.subject_map_snapshot ? JSON.stringify(plan.subject_map_snapshot) : null,
    plan.demonstrations_observed
      ? JSON.stringify(plan.demonstrations_observed)
      : null,
  );
}

export function getStrategyPlan(
  db: DatabaseType,
  sessionId: string,
): StrategyPlan | null {
  const row = db
    .prepare("SELECT * FROM strategy_plans WHERE session_id = ?")
    .get(sessionId) as StrategyPlanRow | undefined;
  return row ? rowToPlan(row) : null;
}

export function listStrategyPlansBySubject(
  db: DatabaseType,
  subjectId: string,
  limit = 20,
): StrategyPlan[] {
  const rows = db
    .prepare(
      `SELECT * FROM strategy_plans WHERE subject_id = ?
       ORDER BY composed_at DESC LIMIT ?`,
    )
    .all(subjectId, limit) as StrategyPlanRow[];
  return rows.map(rowToPlan);
}
