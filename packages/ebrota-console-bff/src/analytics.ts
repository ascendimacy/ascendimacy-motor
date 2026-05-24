/**
 * Analytics module — C-MX-08 PR9 (Fase H parcial, S-OC-34/35/36).
 *
 * V0.1 = básico cross-session + per-persona drill-down. Tudo derivado
 * do SQLite índice existente (sessions + jun_decisions); nenhum schema
 * novo. Métricas mais ricas (Helix state, mood timeline, Dreyfus level)
 * requerem parse profundo de trace.json — fica pra V0.2.
 *
 * P2 simplicidade: 2 queries SQL, zero abstrações. Caller wrappa em
 * endpoint Fastify.
 */

import type { Database as DatabaseType } from "better-sqlite3";

export interface PersonaSummary {
  personaId: string;
  sessionCount: number;
  realCount: number;
  stsCount: number;
  totalTurns: number;
  totalOverrides: number;
  overrideRate: number;
  lastSessionAt: string | null;
  firstSessionAt: string | null;
}

export interface PersonaEvolutionSession {
  sessionId: string;
  startedAt: string;
  kind: "real" | "sts";
  turnCount: number;
  hasOverrides: boolean;
  overrideCount: number;
}

export interface PersonaEvolution {
  personaId: string;
  summary: PersonaSummary;
  sessions: PersonaEvolutionSession[];
}

const SUMMARIZE_PERSONAS_SQL = `
  SELECT
    s.persona_id AS personaId,
    COUNT(*) AS sessionCount,
    SUM(CASE WHEN s.kind = 'real' THEN 1 ELSE 0 END) AS realCount,
    SUM(CASE WHEN s.kind = 'sts' THEN 1 ELSE 0 END) AS stsCount,
    COALESCE(SUM(s.turn_count), 0) AS totalTurns,
    MIN(s.started_at) AS firstSessionAt,
    MAX(s.started_at) AS lastSessionAt
  FROM sessions s
  GROUP BY s.persona_id
  ORDER BY lastSessionAt DESC
`;

const COUNT_OVERRIDES_PER_PERSONA_SQL = `
  SELECT
    s.persona_id AS personaId,
    COUNT(j.id) AS overrideCount
  FROM sessions s
  LEFT JOIN jun_decisions j
    ON j.session_id = s.session_id
    AND j.decision IN ('edit', 'override')
  GROUP BY s.persona_id
`;

const PERSONA_SESSIONS_SQL = `
  SELECT
    s.session_id AS sessionId,
    s.started_at AS startedAt,
    s.kind AS kind,
    s.turn_count AS turnCount,
    s.has_overrides AS hasOverridesInt,
    (
      SELECT COUNT(*) FROM jun_decisions j
      WHERE j.session_id = s.session_id
        AND j.decision IN ('edit', 'override')
    ) AS overrideCount
  FROM sessions s
  WHERE s.persona_id = @personaId
  ORDER BY s.started_at ASC
`;

/**
 * Agrega métricas básicas por persona (S-OC-34 feed cross-session).
 * Returns array ordered by last session DESC.
 */
export function summarizePersonas(db: DatabaseType): PersonaSummary[] {
  const rows = db.prepare(SUMMARIZE_PERSONAS_SQL).all() as Array<{
    personaId: string;
    sessionCount: number;
    realCount: number | null;
    stsCount: number | null;
    totalTurns: number;
    firstSessionAt: string | null;
    lastSessionAt: string | null;
  }>;
  const overrideRows = db
    .prepare(COUNT_OVERRIDES_PER_PERSONA_SQL)
    .all() as Array<{ personaId: string; overrideCount: number }>;
  const overridesByPersona = new Map(
    overrideRows.map((r) => [r.personaId, r.overrideCount]),
  );

  return rows.map((r) => {
    const overrides = overridesByPersona.get(r.personaId) ?? 0;
    const rate = r.totalTurns > 0 ? overrides / r.totalTurns : 0;
    return {
      personaId: r.personaId,
      sessionCount: r.sessionCount,
      realCount: r.realCount ?? 0,
      stsCount: r.stsCount ?? 0,
      totalTurns: r.totalTurns,
      totalOverrides: overrides,
      overrideRate: Math.round(rate * 1000) / 1000,
      firstSessionAt: r.firstSessionAt,
      lastSessionAt: r.lastSessionAt,
    };
  });
}

/**
 * Drill-down per persona (S-OC-35 + S-OC-36 básico): sessions
 * cronológicas + summary agregado pra cards de evolução.
 */
export function getPersonaEvolution(
  db: DatabaseType,
  personaId: string,
): PersonaEvolution | null {
  const sessions = db
    .prepare(PERSONA_SESSIONS_SQL)
    .all({ personaId }) as Array<
    PersonaEvolutionSession & { hasOverridesInt: number }
  >;
  if (sessions.length === 0) return null;

  const mapped: PersonaEvolutionSession[] = sessions.map((s) => ({
    sessionId: s.sessionId,
    startedAt: s.startedAt,
    kind: s.kind,
    turnCount: s.turnCount,
    hasOverrides: s.hasOverridesInt === 1,
    overrideCount: s.overrideCount,
  }));

  const summaries = summarizePersonas(db);
  const summary =
    summaries.find((s) => s.personaId === personaId) ?? {
      personaId,
      sessionCount: mapped.length,
      realCount: mapped.filter((s) => s.kind === "real").length,
      stsCount: mapped.filter((s) => s.kind === "sts").length,
      totalTurns: mapped.reduce((acc, s) => acc + s.turnCount, 0),
      totalOverrides: mapped.reduce((acc, s) => acc + s.overrideCount, 0),
      overrideRate: 0,
      firstSessionAt: mapped[0]?.startedAt ?? null,
      lastSessionAt: mapped[mapped.length - 1]?.startedAt ?? null,
    };

  return { personaId, summary, sessions: mapped };
}
