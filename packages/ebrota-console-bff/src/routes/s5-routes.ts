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
 *   GET  /sts/runs?limit=N                             (sts_runs table)
 *   GET  /sts/runs/:runId/status                       (status + tail logs)
 *   POST /sts/runs/start                               (spawn real subprocess)
 *   POST /sts/runs/:runId/cancel                       (SIGTERM)
 */

import type { FastifyPluginAsync } from "fastify";
import type { Database as DatabaseType } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

export interface S5RoutesOptions {
  db: DatabaseType;
  /**
   * Caller-injectable override pra testes. Em prod, segue
   * STS_REPO_ROOT (env) || "/home/alexa/ascendimacy-motor".
   */
  stsRepoRoot?: string;
  /** Diretório onde stdout/stderr logs ficam. Default: STS_LOG_DIR || $TMPDIR/sts-runs. */
  stsLogDir?: string;
  /**
   * Whether to inherit current `process.env` plus `USE_MOCK_LLM=true`. Default true.
   * Testes podem desligar.
   */
  defaultUseMockLlm?: boolean;
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

interface StsRunRow {
  run_id: string;
  persona_id: string;
  scenario_id: string;
  turns_requested: number;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  started_at: string;
  ended_at: string | null;
  pid: number | null;
  exit_code: number | null;
  stdout_path: string | null;
  stderr_path: string | null;
  turns_completed: number;
  last_progress_at: string | null;
  error_message: string | null;
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
  status?: StsRunRow["status"];
  turns_requested?: number;
  turns_completed?: number;
}

export interface StsRunStartRequest {
  persona_id: string;
  scenario_id: string;
  turns?: number;
}

export interface StsRunStartResult {
  run_id: string;
  status: StsRunRow["status"];
  persona_id: string;
  scenario_id: string;
  turns: number;
  dispatched_at: string;
  pid: number | null;
  note?: string;
}

export interface StsRunStatusResult {
  run_id: string;
  status: StsRunRow["status"];
  persona_id: string;
  scenario_id: string;
  turns_requested: number;
  turns_completed: number;
  started_at: string;
  ended_at: string | null;
  pid: number | null;
  exit_code: number | null;
  error_message: string | null;
  last_progress_at: string | null;
  stdout_tail: string[];
  stderr_tail: string[];
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
  {
    id: "fail-fast",
    label: "fail-fast (test)",
    description: "Scenario de teste que falha intencionalmente — usado em integration tests do BFF.",
    recommended_turns: 4,
    duration_label: "T+test",
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

function rowToSummary(r: StsRunRow): StsRunSummary {
  return {
    run_id: r.run_id,
    persona_id: r.persona_id,
    scenario_id: r.scenario_id,
    started_at: r.started_at,
    ended_at: r.ended_at,
    turn_count: r.turns_completed,
    score: null,
    trace_path: null,
    status: r.status,
    turns_requested: r.turns_requested,
    turns_completed: r.turns_completed,
  };
}

function listStsRuns(db: DatabaseType, limit: number): StsRunSummary[] {
  const rows = db
    .prepare(
      `SELECT * FROM sts_runs
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(limit) as StsRunRow[];
  return rows.map(rowToSummary);
}

function getRunRow(db: DatabaseType, runId: string): StsRunRow | null {
  const r = db
    .prepare(`SELECT * FROM sts_runs WHERE run_id = ?`)
    .get(runId) as StsRunRow | undefined;
  return r ?? null;
}

function tailFile(path: string | null, maxLines = 100): string[] {
  if (path === null || !existsSync(path)) return [];
  try {
    const stat = statSync(path);
    if (stat.size === 0) return [];
    // Read whole file when small; for v0 stub logs are short (<10KB).
    const max = 256 * 1024;
    const buf = readFileSync(path, "utf8");
    const trimmed = buf.length > max ? buf.slice(buf.length - max) : buf;
    const lines = trimmed.split(/\r?\n/).filter((l) => l.length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

/**
 * Tracks live child processes keyed by run_id so we can SIGTERM on cancel.
 * Module-level: shared across requests within the same Fastify instance.
 * Cleared on `exit`/`error`.
 */
type RunHandles = Map<string, ChildProcess>;

function spawnStsRun(args: {
  db: DatabaseType;
  repoRoot: string;
  logDir: string;
  runHandles: RunHandles;
  runId: string;
  personaId: string;
  scenarioId: string;
  turnsRequested: number;
  defaultUseMockLlm: boolean;
  shutdownState: { closed: boolean };
}): { pid: number | null; status: StsRunRow["status"] } {
  const {
    db,
    repoRoot,
    logDir,
    runHandles,
    runId,
    personaId,
    scenarioId,
    turnsRequested,
    defaultUseMockLlm,
    shutdownState,
  } = args;

  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  const stdoutPath = join(logDir, `${runId}.stdout.log`);
  const stderrPath = join(logDir, `${runId}.stderr.log`);
  const stdoutFd = openSync(stdoutPath, "a");
  const stderrFd = openSync(stderrPath, "a");

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (defaultUseMockLlm) {
    env.USE_MOCK_LLM = "true";
  }

  const scriptPath = resolve(repoRoot, "scripts/run-sts.mjs");
  let proc: ChildProcess;
  try {
    proc = spawn(
      "node",
      [
        scriptPath,
        "--persona",
        personaId,
        "--scenario",
        scenarioId,
        "--turns",
        String(turnsRequested),
        "--run-id",
        runId,
      ],
      {
        cwd: repoRoot,
        env,
        stdio: ["ignore", stdoutFd, stderrFd],
        detached: false,
      },
    );
  } catch (err) {
    closeSync(stdoutFd);
    closeSync(stderrFd);
    db.prepare(
      `UPDATE sts_runs
       SET status='failed', ended_at=?, error_message=?
       WHERE run_id = ?`,
    ).run(
      new Date().toISOString(),
      err instanceof Error ? err.message : String(err),
      runId,
    );
    return { pid: null, status: "failed" };
  }

  const pid = proc.pid ?? null;

  db.prepare(
    `UPDATE sts_runs
     SET status='running', pid=?, stdout_path=?, stderr_path=?
     WHERE run_id = ?`,
  ).run(pid, stdoutPath, stderrPath, runId);

  if (pid !== null) {
    runHandles.set(runId, proc);
  }

  // Parse stdout to update turns_completed. spawn() with stdio targeting
  // file descriptors disables piping into the parent, so we re-read the
  // log file lightly on a small interval. For v0 stub this is sufficient.
  const tickProgress = (): void => {
    if (shutdownState.closed) return;
    const lines = tailFile(stdoutPath, 200);
    let completed = 0;
    for (const l of lines) {
      const m = l.match(/^turn (\d+)\/\d+/);
      if (m && m[1] !== undefined) {
        const n = Number.parseInt(m[1], 10);
        if (!Number.isNaN(n) && n > completed) completed = n;
      }
    }
    try {
      db.prepare(
        `UPDATE sts_runs
         SET turns_completed=?, last_progress_at=?
         WHERE run_id = ? AND status='running'`,
      ).run(completed, new Date().toISOString(), runId);
    } catch {
      /* DB may be closed mid-shutdown */
    }
  };
  const progressTimer: NodeJS.Timeout = setInterval(tickProgress, 500);
  if (typeof progressTimer.unref === "function") progressTimer.unref();

  proc.on("error", (err) => {
    clearInterval(progressTimer);
    runHandles.delete(runId);
    try { closeSync(stdoutFd); } catch { /* ignore */ }
    try { closeSync(stderrFd); } catch { /* ignore */ }
    if (shutdownState.closed) return;
    try {
      const current = getRunRow(db, runId);
      if (current === null || current.status === "running" || current.status === "pending") {
        db.prepare(
          `UPDATE sts_runs
           SET status='failed', ended_at=?, error_message=?
           WHERE run_id = ?`,
        ).run(new Date().toISOString(), err.message, runId);
      }
    } catch {
      /* DB closed */
    }
  });

  proc.on("exit", (code, signal) => {
    clearInterval(progressTimer);
    runHandles.delete(runId);
    try { closeSync(stdoutFd); } catch { /* ignore */ }
    try { closeSync(stderrFd); } catch { /* ignore */ }
    if (shutdownState.closed) return;
    tickProgress();
    try {
      const current = getRunRow(db, runId);
      // Don't override cancelled state set by /cancel endpoint.
      if (current !== null && current.status === "cancelled") return;
      const endedAt = new Date().toISOString();
      if (signal === "SIGTERM" || signal === "SIGINT") {
        db.prepare(
          `UPDATE sts_runs
           SET status='cancelled', ended_at=?, exit_code=?
           WHERE run_id = ?`,
        ).run(endedAt, code ?? null, runId);
        return;
      }
      if (code === 0) {
        db.prepare(
          `UPDATE sts_runs
           SET status='succeeded', ended_at=?, exit_code=0
           WHERE run_id = ?`,
        ).run(endedAt, runId);
      } else {
        const tail = tailFile(stderrPath, 5).join(" / ");
        db.prepare(
          `UPDATE sts_runs
           SET status='failed', ended_at=?, exit_code=?, error_message=?
           WHERE run_id = ?`,
        ).run(endedAt, code ?? null, tail || `exit code ${code ?? "null"}`, runId);
      }
    } catch {
      /* DB closed */
    }
  });

  return { pid, status: "running" };
}

const s5Routes: FastifyPluginAsync<S5RoutesOptions> = async (fastify, opts) => {
  const { db } = opts;
  const stsRepoRoot =
    opts.stsRepoRoot ?? process.env.STS_REPO_ROOT ?? "/home/alexa/ascendimacy-motor";
  const stsLogDir =
    opts.stsLogDir ?? process.env.STS_LOG_DIR ?? join(tmpdir(), "sts-runs");
  const defaultUseMockLlm = opts.defaultUseMockLlm ?? true;
  const runHandles: RunHandles = new Map();
  // Wired to onClose so post-shutdown subprocess exit handlers can no-op
  // instead of crashing on a closed DB (issue surfaced em integration suite).
  const shutdownState = { closed: false };

  // Best-effort cleanup if Fastify shuts down mid-run.
  fastify.addHook("onClose", async () => {
    shutdownState.closed = true;
    const procs = Array.from(runHandles.values());
    for (const proc of procs) {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    // Wait briefly for processes to actually exit so their exit listeners
    // fire BEFORE the DB closes downstream. 200ms é suficiente pro stub.
    await Promise.all(
      procs.map(
        (p) =>
          new Promise<void>((resolve) => {
            if (p.exitCode !== null) {
              resolve();
              return;
            }
            const timer = setTimeout(() => resolve(), 200);
            p.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          }),
      ),
    );
    runHandles.clear();
  });

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
      const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : 50;
      return { runs: listStsRuns(db, limit) };
    },
  );

  fastify.get<{ Params: { runId: string } }>(
    "/sts/runs/:runId/status",
    async (req, reply) => {
      const row = getRunRow(db, req.params.runId);
      if (row === null) {
        return reply.code(404).send({ error: "run_id desconhecido" });
      }
      const result: StsRunStatusResult = {
        run_id: row.run_id,
        status: row.status,
        persona_id: row.persona_id,
        scenario_id: row.scenario_id,
        turns_requested: row.turns_requested,
        turns_completed: row.turns_completed,
        started_at: row.started_at,
        ended_at: row.ended_at,
        pid: row.pid,
        exit_code: row.exit_code,
        error_message: row.error_message,
        last_progress_at: row.last_progress_at,
        stdout_tail: tailFile(row.stdout_path, 100),
        stderr_tail: tailFile(row.stderr_path, 100),
      };
      return result;
    },
  );

  fastify.post<{ Params: { runId: string } }>(
    "/sts/runs/:runId/cancel",
    async (req, reply) => {
      const row = getRunRow(db, req.params.runId);
      if (row === null) {
        return reply.code(404).send({ error: "run_id desconhecido" });
      }
      if (row.status !== "running" && row.status !== "pending") {
        return { run_id: row.run_id, status: row.status, cancelled: false };
      }
      const proc = runHandles.get(row.run_id);
      if (proc !== undefined && proc.pid !== undefined) {
        try {
          proc.kill("SIGTERM");
        } catch {
          /* process already exited */
        }
      }
      db.prepare(
        `UPDATE sts_runs
         SET status='cancelled', ended_at=?
         WHERE run_id = ?`,
      ).run(new Date().toISOString(), row.run_id);
      return { run_id: row.run_id, status: "cancelled", cancelled: true };
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

      const runId = randomUUID();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO sts_runs
         (run_id, persona_id, scenario_id, turns_requested, status, started_at, turns_completed)
         VALUES (?, ?, ?, ?, 'pending', ?, 0)`,
      ).run(runId, body.persona_id, body.scenario_id, turns, now);

      const { pid, status } = spawnStsRun({
        db,
        repoRoot: stsRepoRoot,
        logDir: stsLogDir,
        runHandles,
        runId,
        personaId: body.persona_id,
        scenarioId: body.scenario_id,
        turnsRequested: turns,
        defaultUseMockLlm,
        shutdownState,
      });

      const result: StsRunStartResult = {
        run_id: runId,
        status,
        persona_id: body.persona_id,
        scenario_id: body.scenario_id,
        turns,
        dispatched_at: now,
        pid,
      };
      return result;
    },
  );
};

export default s5Routes;
