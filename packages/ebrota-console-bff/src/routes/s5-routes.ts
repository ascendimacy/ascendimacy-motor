/**
 * S5 wiring — Motor de Avaliação endpoints (guardrail / STS / longitudinal).
 *
 * Spec parent: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-user-stories-v0.md
 * Sub-divisão S5.a/b/c em ascendimacy-ops/docs/architecture-consolidated/ARCHITECTURE.md.
 *
 * Endpoints expostos:
 *   GET  /personas/:id/guardrail-history?limit=N
 *   GET  /personas/:id/recall-check-history?limit=N
 *   GET  /personas/:id/trigger-events?limit=N          (stub_v0)
 *   GET  /personas/:id/kpi-longitudinal                (parcial stub_v0)
 *   GET  /sts/scenarios                                (lista hardcoded v0)
 *   GET  /sts/personas                                 (lista hardcoded v0)
 *   GET  /sts/runs?limit=N
 *   POST /sts/runs/start                               (stub_v0 — não spawna)
 *
 * Estratégia v0: leituras de `subject_knowledge` quando o writer já
 * persistiu (boundary_event / recall_check_attempt); empty data com
 * `source: "stub_v0"` quando feature backend não está pronta.
 */

import type { FastifyPluginAsync } from "fastify";
import type { Database as DatabaseType } from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface S5RoutesOptions {
  db: DatabaseType;
}

interface SkRow {
  id: string;
  type: string;
  source: string;
  confidence: number;
  payload_json: string;
  turn_ref: string;
  session_id: string;
  created_at: string;
}

export interface GuardrailHistoryEntry {
  id: string;
  turn_ref: string;
  session_id: string;
  created_at: string;
  topic_category: string;
  label: string;
  intensity: number | null;
  passed: boolean;
}

export interface RecallCheckHistoryEntry {
  id: string;
  turn_ref: string;
  session_id: string;
  created_at: string;
  concept_id: string;
  lineage_anchor: string;
  outcome: string;
  intensity: number | null;
}

export interface TriggerEventEntry {
  id: string;
  turn_ref: string;
  session_id: string;
  fired_at: string;
  transition: string;
}

export interface MoodTrajectoryPoint {
  session_id: string;
  started_at: string;
  mood: number | null;
}

export interface CaselDelta {
  month: string;
  axis: string;
  delta: number;
}

export interface KpiLongitudinal {
  persona_id: string;
  mood_trajectory: MoodTrajectoryPoint[];
  casel_deltas: CaselDelta[];
  concept_retention: {
    total_attempts: number;
    positive_rate: number | null;
    positive_rate_by_week: Array<{ week_start: string; rate: number | null; total: number }>;
  };
  trigger_summary: Array<{ transition: string; count: number }>;
  recall_summary: {
    items_checked: number;
    positive_rate: number | null;
  };
  source: "real" | "partial_stub_v0" | "stub_v0";
}

export interface StsScenario {
  id: string;
  label: string;
  description: string;
  recommended_turns: number;
  duration_label: string;
}

export interface StsPersona {
  id: string;
  display_name: string;
  archetype: string;
  age: number | null;
  language: string;
}

export interface StsRunSummary {
  run_id: string;
  persona_id: string;
  scenario_id: string;
  started_at: string;
  ended_at: string | null;
  turn_count: number;
  score: string | null;
  trace_path: string | null;
}

export interface StsRunStartRequest {
  persona_id: string;
  scenario_id: string;
  turns?: number;
}

export interface StsRunStartResult {
  run_id: string;
  status: "dispatched_stub_v0";
  persona_id: string;
  scenario_id: string;
  turns: number;
  dispatched_at: string;
  note: string;
}

const STS_SCENARIOS: StsScenario[] = [
  {
    id: "smoke-3d",
    label: "smoke-3d",
    description: "Smoke 3 dias — sanity check rápido do walking skeleton.",
    recommended_turns: 6,
    duration_label: "T+3d",
  },
  {
    id: "nagareyama-30d",
    label: "nagareyama-30d",
    description: "Cenário longitudinal 30 dias Yuji household (Nagareyama).",
    recommended_turns: 60,
    duration_label: "T+30d",
  },
  {
    id: "realista",
    label: "realista",
    description: "Mix realista de jogadas variadas em ritmo natural.",
    recommended_turns: 20,
    duration_label: "T+~7d",
  },
  {
    id: "group-dyad",
    label: "group-dyad (Ryo+Kei)",
    description: "WhatsApp group session sintética Ryo+Kei+bot (joint mode).",
    recommended_turns: 9,
    duration_label: "T+~1d",
  },
];

const STS_PERSONAS: StsPersona[] = [
  { id: "paula-mendes", display_name: "Paula Mendes", archetype: "curiosa-12a", age: 12, language: "pt-BR" },
  { id: "paula-30d", display_name: "Paula (30 dias)", archetype: "longitudinal", age: 12, language: "pt-BR" },
  { id: "ryo-ochiai", display_name: "Ryo Ochiai", archetype: "deflective-11a", age: 11, language: "pt+ja" },
  { id: "kei-ochiai", display_name: "Kei Ochiai", archetype: "philosophical-9a", age: 9, language: "pt+ja" },
  { id: "saki-ochiai", display_name: "Saki Ochiai", archetype: "joyful-6a", age: 6, language: "pt+ja" },
];

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function listGuardrailHistory(
  db: DatabaseType,
  personaId: string,
  limit: number,
): GuardrailHistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT id, type, source, confidence, payload_json, turn_ref, session_id, created_at
       FROM subject_knowledge
       WHERE subject_id = ? AND type = 'boundary_event'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(personaId, limit) as SkRow[];
  return rows.map((r) => {
    const p = parsePayload(r.payload_json);
    const topic = typeof p["topic_category"] === "string" ? p["topic_category"] : "unknown";
    const label = typeof p["label"] === "string" ? p["label"] : "";
    const intensity = typeof p["intensity"] === "number" ? p["intensity"] : null;
    const passed =
      typeof p["passed"] === "boolean"
        ? p["passed"]
        : intensity === null || intensity < 0.5;
    return {
      id: r.id,
      turn_ref: r.turn_ref,
      session_id: r.session_id,
      created_at: r.created_at,
      topic_category: topic,
      label,
      intensity,
      passed,
    };
  });
}

function listRecallCheckHistory(
  db: DatabaseType,
  personaId: string,
  limit: number,
): RecallCheckHistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT id, type, source, confidence, payload_json, turn_ref, session_id, created_at
       FROM subject_knowledge
       WHERE subject_id = ? AND type = 'recall_check_attempt'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(personaId, limit) as SkRow[];
  return rows.map((r) => {
    const p = parsePayload(r.payload_json);
    return {
      id: r.id,
      turn_ref: r.turn_ref,
      session_id: r.session_id,
      created_at: r.created_at,
      concept_id: typeof p["concept_id"] === "string" ? p["concept_id"] : "?",
      lineage_anchor: typeof p["lineage_anchor"] === "string" ? p["lineage_anchor"] : "?",
      outcome: typeof p["outcome"] === "string" ? p["outcome"] : "unknown",
      intensity: typeof p["intensity"] === "number" ? p["intensity"] : null,
    };
  });
}

function computeRecallSummary(
  db: DatabaseType,
  personaId: string,
): { items_checked: number; positive_rate: number | null } {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN json_extract(payload_json, '$.outcome') = 'positive' THEN 1 ELSE 0 END) AS positive
       FROM subject_knowledge
       WHERE subject_id = ? AND type = 'recall_check_attempt'`,
    )
    .get(personaId) as { total: number; positive: number | null };
  const total = row.total ?? 0;
  const positive = row.positive ?? 0;
  return {
    items_checked: total,
    positive_rate: total > 0 ? positive / total : null,
  };
}

function computeMoodTrajectory(
  db: DatabaseType,
  personaId: string,
  limit: number,
): MoodTrajectoryPoint[] {
  const rows = db
    .prepare(
      `SELECT session_id, started_at FROM sessions
       WHERE persona_id = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(personaId, limit) as Array<{ session_id: string; started_at: string }>;
  return rows.map((r) => ({
    session_id: r.session_id,
    started_at: r.started_at,
    mood: null,
  }));
}

function computeRetentionByWeek(
  db: DatabaseType,
  personaId: string,
): Array<{ week_start: string; rate: number | null; total: number }> {
  const rows = db
    .prepare(
      `SELECT
         strftime('%Y-W%W', created_at) AS week,
         MIN(date(created_at)) AS week_start,
         COUNT(*) AS total,
         SUM(CASE WHEN json_extract(payload_json, '$.outcome') = 'positive' THEN 1 ELSE 0 END) AS positive
       FROM subject_knowledge
       WHERE subject_id = ? AND type = 'recall_check_attempt'
       GROUP BY week
       ORDER BY week_start ASC
       LIMIT 12`,
    )
    .all(personaId) as Array<{ week: string; week_start: string; total: number; positive: number | null }>;
  return rows.map((r) => ({
    week_start: r.week_start,
    total: r.total,
    rate: r.total > 0 ? (r.positive ?? 0) / r.total : null,
  }));
}

function computeKpiLongitudinal(db: DatabaseType, personaId: string): KpiLongitudinal {
  const trajectory = computeMoodTrajectory(db, personaId, 30);
  const recallSummary = computeRecallSummary(db, personaId);
  const retentionByWeek = computeRetentionByWeek(db, personaId);

  const isPartial =
    trajectory.length === 0 && recallSummary.items_checked === 0;

  return {
    persona_id: personaId,
    mood_trajectory: trajectory,
    casel_deltas: [],
    concept_retention: {
      total_attempts: recallSummary.items_checked,
      positive_rate: recallSummary.positive_rate,
      positive_rate_by_week: retentionByWeek,
    },
    trigger_summary: [],
    recall_summary: recallSummary,
    source: isPartial ? "stub_v0" : "partial_stub_v0",
  };
}

function listStsRuns(
  db: DatabaseType,
  limit: number,
): StsRunSummary[] {
  const rows = db
    .prepare(
      `SELECT session_id, persona_id, conversation_id, started_at, ended_at,
              turn_count, trace_path
       FROM sessions
       WHERE kind = 'sts'
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
      session_id: string;
      persona_id: string;
      conversation_id: string;
      started_at: string;
      ended_at: string | null;
      turn_count: number;
      trace_path: string | null;
    }>;
  return rows.map((r) => ({
    run_id: r.session_id,
    persona_id: r.persona_id,
    scenario_id: r.conversation_id,
    started_at: r.started_at,
    ended_at: r.ended_at,
    turn_count: r.turn_count,
    score: null,
    trace_path: r.trace_path,
  }));
}

const s5Routes: FastifyPluginAsync<S5RoutesOptions> = async (fastify, opts) => {
  const { db } = opts;

  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>("/personas/:id/guardrail-history", async (req) => {
    const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : 20;
    const checks = listGuardrailHistory(db, req.params.id, limit);
    const passed = checks.filter((c) => c.passed).length;
    return {
      checks,
      passed_count: passed,
      failed_count: checks.length - passed,
      source: checks.length === 0 ? "stub_v0" : "real",
    };
  });

  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>("/personas/:id/recall-check-history", async (req) => {
    const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : 20;
    const events = listRecallCheckHistory(db, req.params.id, limit);
    return {
      events,
      source: events.length === 0 ? "stub_v0" : "real",
    };
  });

  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>("/personas/:id/trigger-events", async () => {
    // v0 stub — TriggerEvaluator events vivem em engine_trace_v2
    // components.planejador.triggerEvaluation. Não persistidos em SQL
    // ainda; UI mostra "sem dado" + nota source=stub_v0.
    return {
      events: [] as TriggerEventEntry[],
      transitions: [] as Array<{ transition: string; count: number }>,
      source: "stub_v0",
    };
  });

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/kpi-longitudinal",
    async (req) => computeKpiLongitudinal(db, req.params.id),
  );

  fastify.get("/sts/scenarios", async () => ({
    scenarios: STS_SCENARIOS,
  }));

  fastify.get("/sts/personas", async () => ({
    personas: STS_PERSONAS,
  }));

  fastify.get<{ Querystring: { limit?: string } }>(
    "/sts/runs",
    async (req) => {
      const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : 20;
      return { runs: listStsRuns(db, limit) };
    },
  );

  fastify.post<{ Body: StsRunStartRequest }>(
    "/sts/runs/start",
    async (req, reply) => {
      const body = req.body;
      if (
        body === undefined ||
        typeof body.persona_id !== "string" ||
        typeof body.scenario_id !== "string"
      ) {
        return reply.code(400).send({
          error: "campos obrigatórios: persona_id, scenario_id",
        });
      }
      const knownPersona = STS_PERSONAS.some((p) => p.id === body.persona_id);
      const knownScenario = STS_SCENARIOS.some((s) => s.id === body.scenario_id);
      if (!knownPersona) {
        return reply.code(400).send({
          error: `persona_id desconhecida: ${body.persona_id}`,
        });
      }
      if (!knownScenario) {
        return reply.code(400).send({
          error: `scenario_id desconhecido: ${body.scenario_id}`,
        });
      }
      const scenario = STS_SCENARIOS.find((s) => s.id === body.scenario_id)!;
      const turns =
        typeof body.turns === "number" && body.turns > 0
          ? Math.floor(body.turns)
          : scenario.recommended_turns;

      const result: StsRunStartResult = {
        run_id: randomUUID(),
        status: "dispatched_stub_v0",
        persona_id: body.persona_id,
        scenario_id: body.scenario_id,
        turns,
        dispatched_at: new Date().toISOString(),
        note:
          "v0 stub — STS spawn real ainda não wired. Rode `node scripts/sts-group-dyad.mjs` ou similar pra disparo manual; este endpoint apenas reserva run_id pra tracking futuro.",
      };
      return result;
    },
  );
};

export default s5Routes;
