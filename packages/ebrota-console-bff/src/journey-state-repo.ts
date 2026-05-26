/**
 * Journey State Repository — leitura + upsert do estado de jornada do sujeito.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-25-session-phases-journey-stages-strategist.md §3
 *
 * Estratégia v1: lazy compute. Quando alguém pede journey_state e a tabela
 * não tem entry (ou está stale), recomputa a partir de subject_knowledge
 * (discoveries_count + families_covered) e upserta.
 *
 * Auto-transição: se entries do ledger satisfazem readyForMapping E o
 * stage atual é discovery_only sem override parental → upgrade pra
 * mapping_ready. O `applied_double_helix` exige ratificação explícita do
 * pai (não auto-transição).
 */

import type { Database as DatabaseType } from "better-sqlite3";
import {
  initialJourneyState,
  readyForMapping,
  computeDiscoveryMaturity,
  type JourneyState,
  type JourneyStage,
  type SubjectKnowledgeEntry,
} from "@ascendimacy/shared";

interface JourneyStateRow {
  subject_id: string;
  stage: JourneyStage;
  stage_entered_at: string;
  discoveries_count: number;
  families_covered: string;
  override_by_parent: string | null;
  last_updated_at: string;
}

function rowToState(row: JourneyStateRow): JourneyState {
  return {
    subject_id: row.subject_id,
    stage: row.stage,
    stage_entered_at: row.stage_entered_at,
    discoveries_count: row.discoveries_count,
    families_covered: JSON.parse(row.families_covered),
    override_by_parent: row.override_by_parent
      ? JSON.parse(row.override_by_parent)
      : undefined,
    last_updated_at: row.last_updated_at,
  };
}

interface SkRow {
  id: string;
  subject_id: string;
  type: string;
  source: string;
  confidence: number;
  confirmed_at: string | null;
  alignment: string;
  payload_json: string;
  turn_ref: string;
  session_id: string;
  created_at: string;
}

function loadDiscoveryEntries(
  db: DatabaseType,
  subjectId: string,
): SubjectKnowledgeEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM subject_knowledge
       WHERE subject_id = ? AND type IN ('interest','value','need','discovery')
       ORDER BY created_at ASC`,
    )
    .all(subjectId) as SkRow[];
  return rows.map((r) => ({
    id: r.id,
    subject_id: r.subject_id,
    type: r.type as SubjectKnowledgeEntry["type"],
    source: r.source as SubjectKnowledgeEntry["source"],
    confidence: r.confidence,
    confirmed_at: r.confirmed_at,
    alignment: r.alignment as SubjectKnowledgeEntry["alignment"],
    payload: JSON.parse(r.payload_json),
    turn_ref: r.turn_ref,
    session_id: r.session_id,
    created_at: r.created_at,
  }));
}

const UPSERT_SQL = `
  INSERT INTO journey_state (
    subject_id, stage, stage_entered_at, discoveries_count,
    families_covered, override_by_parent, last_updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(subject_id) DO UPDATE SET
    stage = excluded.stage,
    stage_entered_at = excluded.stage_entered_at,
    discoveries_count = excluded.discoveries_count,
    families_covered = excluded.families_covered,
    override_by_parent = excluded.override_by_parent,
    last_updated_at = excluded.last_updated_at
`;

function persist(db: DatabaseType, state: JourneyState): void {
  db.prepare(UPSERT_SQL).run(
    state.subject_id,
    state.stage,
    state.stage_entered_at,
    state.discoveries_count,
    JSON.stringify(state.families_covered),
    state.override_by_parent ? JSON.stringify(state.override_by_parent) : null,
    state.last_updated_at,
  );
}

/**
 * Lê (ou inicializa+computa) o journey_state do sujeito.
 *
 * Sempre recomputa discoveries_count + families_covered do ledger atual,
 * e avalia auto-transição discovery_only → mapping_ready. Persiste resultado.
 */
export function readOrComputeJourneyState(
  db: DatabaseType,
  subjectId: string,
): JourneyState {
  const row = db
    .prepare("SELECT * FROM journey_state WHERE subject_id = ?")
    .get(subjectId) as JourneyStateRow | undefined;

  let state = row
    ? rowToState(row)
    : initialJourneyState(subjectId);

  // Recompute discoveries do ledger (sempre fresh).
  const entries = loadDiscoveryEntries(db, subjectId);
  const { discoveries_count, families_covered } = computeDiscoveryMaturity(entries);
  state = {
    ...state,
    discoveries_count,
    families_covered,
    last_updated_at: new Date().toISOString(),
  };

  // Auto-transição discovery_only → mapping_ready quando threshold bate
  // E não há override parental forçando ficar.
  if (
    state.stage === "discovery_only" &&
    state.override_by_parent?.forced_stage !== "discovery_only" &&
    readyForMapping({ state })
  ) {
    state = {
      ...state,
      stage: "mapping_ready",
      stage_entered_at: state.last_updated_at,
    };
  }

  persist(db, state);
  return state;
}

/**
 * Aplica override parental. Forçar applied_double_helix manualmente é
 * suportado mas raro (típicamente o stage corre auto após ratificação
 * em mapping_ready).
 */
export function setParentalOverride(
  db: DatabaseType,
  subjectId: string,
  forcedStage: JourneyStage,
  reason: string,
): JourneyState {
  const current = readOrComputeJourneyState(db, subjectId);
  const now = new Date().toISOString();
  const next: JourneyState = {
    ...current,
    stage: forcedStage,
    stage_entered_at:
      current.stage === forcedStage ? current.stage_entered_at : now,
    override_by_parent: { forced_stage: forcedStage, reason, timestamp: now },
    last_updated_at: now,
  };
  persist(db, next);
  return next;
}

/**
 * Limpa override parental (sujeito volta a fluir pelo critério automático).
 */
export function clearParentalOverride(
  db: DatabaseType,
  subjectId: string,
): JourneyState {
  const current = readOrComputeJourneyState(db, subjectId);
  const next: JourneyState = {
    ...current,
    override_by_parent: undefined,
    last_updated_at: new Date().toISOString(),
  };
  persist(db, next);
  // Re-avalia sem override pra ver se threshold bate agora
  return readOrComputeJourneyState(db, subjectId);
}
