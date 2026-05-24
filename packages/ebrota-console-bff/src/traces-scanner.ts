/**
 * Scanner de trace JSON files → SQLite índice — S-OC-30 (storage híbrido
 * D-OC-14).
 *
 * Source-of-truth = `~/ascendimacy-motor/traces/<traceId>/trace.json`
 * (orchestrator escreve via trace-writer.ts). Esse scanner walks o dir,
 * parsea cada trace, popula tabelas `sessions` + `messages_fts`.
 *
 * Idempotent: re-scan substitui rows existentes via UPSERT. Permite
 * rebuild on startup + watcher incremental (futuro).
 *
 * Schema dos trace JSON é parcial-aware: extrai apenas campos necessários
 * pra library. Variações entre versões do orchestrator não quebram o
 * scanner (campos undefined → defaults).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";

export interface TracesScannerOptions {
  /** Diretório dos traces (recursive). */
  tracesDir: string;
  /** Database conectado com schema do db.ts já aplicado. */
  db: DatabaseType;
  /** Logger pra status/errors. */
  log?: (msg: string) => void;
}

interface RawTraceEntry {
  service?: string;
  timestamp?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
}

interface RawTraceTurn {
  turnNumber?: number;
  sessionId?: string;
  incomingMessage?: string;
  entries?: RawTraceEntry[];
  finalResponse?: string;
  timestamp?: string;
}

interface RawTrace {
  sessionId?: string;
  persona?: string;
  startedAt?: string;
  endedAt?: string;
  turns?: RawTraceTurn[];
}

export interface ScanResult {
  filesScanned: number;
  sessionsIndexed: number;
  turnsIndexed: number;
  messagesIndexed: number;
  errors: Array<{ file: string; error: string }>;
}

const UPSERT_SESSION_SQL = `
  INSERT INTO sessions (
    session_id, persona_id, conversation_id, kind, started_at,
    ended_at, turn_count, has_overrides, trace_path
  ) VALUES (
    @sessionId, @personaId, @conversationId, @kind, @startedAt,
    @endedAt, @turnCount, @hasOverrides, @tracePath
  )
  ON CONFLICT(session_id) DO UPDATE SET
    persona_id = excluded.persona_id,
    conversation_id = excluded.conversation_id,
    kind = excluded.kind,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    turn_count = excluded.turn_count,
    has_overrides = excluded.has_overrides,
    trace_path = excluded.trace_path
`;

const DELETE_FTS_BY_SESSION_SQL = `
  DELETE FROM messages_fts WHERE session_id = @sessionId
`;

const INSERT_FTS_SQL = `
  INSERT INTO messages_fts (session_id, turn, role, text)
  VALUES (@sessionId, @turn, @role, @text)
`;

const COUNT_OVERRIDES_SQL = `
  SELECT COUNT(*) AS n FROM jun_decisions
  WHERE session_id = @sessionId AND decision IN ('edit', 'override')
`;

/**
 * Detecta kind heuristicamente:
 *  - sessionId que começa com "sts-" → "sts"
 *  - caso contrário → "real"
 *
 * Convenção pode evoluir; PR seguinte pode ler campo explícito do trace.
 */
const inferKind = (sessionId: string): "real" | "sts" =>
  sessionId.startsWith("sts-") ? "sts" : "real";

/**
 * Extrai conversationId do sessionId quando padrão `<persona>__<conv>`,
 * senão usa sessionId inteiro como fallback.
 */
const extractConversationId = (sessionId: string): string => {
  const idx = sessionId.indexOf("__");
  return idx === -1 ? sessionId : sessionId.slice(idx + 2);
};

const indexTrace = (
  db: DatabaseType,
  trace: RawTrace,
  tracePath: string,
  hasOverridesFn: (sessionId: string) => number,
): { turnsIndexed: number; messagesIndexed: number } => {
  if (typeof trace.sessionId !== "string" || trace.sessionId === "") {
    throw new Error("trace.sessionId missing");
  }
  const sessionId = trace.sessionId;
  const personaId = trace.persona ?? "unknown";
  const turns = trace.turns ?? [];
  const turnCount = turns.length;
  const startedAt = trace.startedAt ?? turns[0]?.timestamp ?? "1970-01-01T00:00:00.000Z";
  const endedAt = trace.endedAt ?? turns[turns.length - 1]?.timestamp ?? null;
  const hasOverrides = hasOverridesFn(sessionId);

  db.prepare(UPSERT_SESSION_SQL).run({
    sessionId,
    personaId,
    conversationId: extractConversationId(sessionId),
    kind: inferKind(sessionId),
    startedAt,
    endedAt,
    turnCount,
    hasOverrides: hasOverrides > 0 ? 1 : 0,
    tracePath,
  });

  // Re-populate FTS pra essa sessão (delete-then-insert pra idempotência)
  db.prepare(DELETE_FTS_BY_SESSION_SQL).run({ sessionId });

  let messagesIndexed = 0;
  const insertFts = db.prepare(INSERT_FTS_SQL);
  for (const turn of turns) {
    const turnNumber = turn.turnNumber ?? 0;
    if (
      typeof turn.incomingMessage === "string" &&
      turn.incomingMessage.length > 0
    ) {
      insertFts.run({
        sessionId,
        turn: turnNumber,
        role: "user",
        text: turn.incomingMessage,
      });
      messagesIndexed += 1;
    }
    if (
      typeof turn.finalResponse === "string" &&
      turn.finalResponse.length > 0
    ) {
      insertFts.run({
        sessionId,
        turn: turnNumber,
        role: "bot",
        text: turn.finalResponse,
      });
      messagesIndexed += 1;
    }
  }

  return { turnsIndexed: turnCount, messagesIndexed };
};

/**
 * Recursive walk procurando trace.json files. Skip nodes com erro
 * (não trava scan).
 */
async function* walkTraceFiles(
  dir: string,
): AsyncGenerator<string, void, void> {
  let entries: Array<{
    name: string;
    isDirectory: () => boolean;
    isFile: () => boolean;
  }>;
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as never;
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = String(entry.name);
    const full = join(dir, name);
    if (entry.isDirectory()) {
      yield* walkTraceFiles(full);
    } else if (entry.isFile() && name === "trace.json") {
      yield full;
    }
  }
}

/**
 * Scan trace files no tracesDir + popula índice. Idempotente.
 * Retorna stats agregados.
 */
export async function scanTraces(
  opts: TracesScannerOptions,
): Promise<ScanResult> {
  const log = opts.log ?? (() => undefined);
  const result: ScanResult = {
    filesScanned: 0,
    sessionsIndexed: 0,
    turnsIndexed: 0,
    messagesIndexed: 0,
    errors: [],
  };

  // Sanity check: dir existe?
  try {
    await stat(opts.tracesDir);
  } catch {
    log(`[traces-scanner] dir not found: ${opts.tracesDir} — skip`);
    return result;
  }

  const overrideCountStmt = opts.db.prepare(COUNT_OVERRIDES_SQL);
  const countOverrides = (sessionId: string): number => {
    const row = overrideCountStmt.get({ sessionId }) as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
  };

  const tx = opts.db.transaction(
    (traces: Array<{ trace: RawTrace; tracePath: string }>) => {
      for (const { trace, tracePath } of traces) {
        try {
          const r = indexTrace(opts.db, trace, tracePath, countOverrides);
          result.sessionsIndexed += 1;
          result.turnsIndexed += r.turnsIndexed;
          result.messagesIndexed += r.messagesIndexed;
        } catch (err) {
          result.errors.push({
            file: tracePath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  );

  const batch: Array<{ trace: RawTrace; tracePath: string }> = [];
  for await (const tracePath of walkTraceFiles(opts.tracesDir)) {
    result.filesScanned += 1;
    try {
      const raw = await readFile(tracePath, "utf-8");
      const trace = JSON.parse(raw) as RawTrace;
      batch.push({ trace, tracePath });
    } catch (err) {
      result.errors.push({
        file: tracePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  tx(batch);
  log(
    `[traces-scanner] ${result.sessionsIndexed} sessions indexed ` +
      `(${result.filesScanned} files, ${result.messagesIndexed} messages, ` +
      `${result.errors.length} errors)`,
  );
  return result;
}

export interface SessionLibraryFilters {
  /** Filtra por persona_id (exato). */
  persona?: string;
  /** Filtra por kind (real | sts). */
  kind?: "real" | "sts";
  /** started_at >= esse ISO. */
  fromIso?: string;
  /** started_at <= esse ISO. */
  toIso?: string;
  /** Só sessões com overrides. */
  hasOverrides?: boolean;
  /** Full-text search nas mensagens. */
  q?: string;
  /** Default 50. */
  limit?: number;
}

export interface SessionLibraryEntry {
  sessionId: string;
  personaId: string;
  conversationId: string;
  kind: "real" | "sts";
  startedAt: string;
  endedAt: string | null;
  turnCount: number;
  hasOverrides: boolean;
  tracePath: string | null;
}

export function listSessionLibrary(
  db: DatabaseType,
  filters: SessionLibraryFilters = {},
): SessionLibraryEntry[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.persona !== undefined) {
    where.push("persona_id = @persona");
    params["persona"] = filters.persona;
  }
  if (filters.kind !== undefined) {
    where.push("kind = @kind");
    params["kind"] = filters.kind;
  }
  if (filters.fromIso !== undefined) {
    where.push("started_at >= @fromIso");
    params["fromIso"] = filters.fromIso;
  }
  if (filters.toIso !== undefined) {
    where.push("started_at <= @toIso");
    params["toIso"] = filters.toIso;
  }
  if (filters.hasOverrides === true) {
    where.push("has_overrides = 1");
  }
  if (filters.q !== undefined && filters.q.length > 0) {
    where.push(
      "session_id IN (SELECT DISTINCT session_id FROM messages_fts WHERE text MATCH @q)",
    );
    params["q"] = filters.q;
  }

  const limit = Math.max(1, Math.min(500, filters.limit ?? 50));
  const sql = `
    SELECT
      session_id AS sessionId,
      persona_id AS personaId,
      conversation_id AS conversationId,
      kind,
      started_at AS startedAt,
      ended_at AS endedAt,
      turn_count AS turnCount,
      has_overrides AS hasOverridesInt,
      trace_path AS tracePath
    FROM sessions
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `;
  const rows = db.prepare(sql).all(params) as Array<
    SessionLibraryEntry & { hasOverridesInt: number }
  >;
  return rows.map((row) => ({
    sessionId: row.sessionId,
    personaId: row.personaId,
    conversationId: row.conversationId,
    kind: row.kind,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    turnCount: row.turnCount,
    hasOverrides: row.hasOverridesInt === 1,
    tracePath: row.tracePath,
  }));
}

/**
 * Lê o trace JSON full de uma sessão. Retorna null se sessionId não
 * está indexado ou file não acessível.
 */
export async function readSessionTrace(
  db: DatabaseType,
  sessionId: string,
): Promise<RawTrace | null> {
  const row = db
    .prepare("SELECT trace_path AS tracePath FROM sessions WHERE session_id = ?")
    .get(sessionId) as { tracePath: string | null } | undefined;
  if (row?.tracePath === undefined || row.tracePath === null) return null;
  try {
    const raw = await readFile(row.tracePath, "utf-8");
    return JSON.parse(raw) as RawTrace;
  } catch {
    return null;
  }
}
