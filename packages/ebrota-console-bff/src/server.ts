/**
 * BFF HTTP/SSE server — C-MX-08 PR2 (S-OC-05 parcial backend).
 *
 * Fastify wrappa as MCP tools do orchestrator daemon (C-MX-07) em
 * endpoints HTTP/JSON + SSE pro frontend Svelte+Vite consumir
 * (browser não fala stdio MCP).
 *
 * D-OC-02 ratificado: porta 3737 (caller config).
 * D-OC-03 ratificado: sem auth em V0.1 (localhost only).
 *
 * Endpoints:
 *   GET  /status                                → BffStatus
 *   GET  /mode                                  → { mode }
 *   POST /mode { mode }                         → { mode }
 *   POST /sessions/start-card                   → startCardSession output
 *   GET  /sessions/:id/turn-state               → SSE stream (polling)
 *   GET  /sessions/:id/options                  → { contentPool }
 *   POST /sessions/:id/override { contentItemId } → OverrideSelectionResult
 *   GET  /sessions/:id/pending-approval         → PendingApproval | null
 *   POST /sessions/:id/approve { ...decision }  → ApproveOrEditResult
 *   POST /sessions/:id/end                      → { closed }
 */

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Database as DatabaseType } from "better-sqlite3";
import type {
  BffStatus,
  ConsoleMode,
  ApprovalDecisionPayload,
} from "./types.js";
import type { OrchestratorDaemonClient } from "./daemon-client.js";
import {
  listRecentJunDecisions,
  recordJunDecision,
} from "./decisions.js";
import {
  listSessionLibrary,
  readSessionTrace,
  scanTraces,
  type SessionLibraryFilters,
} from "./traces-scanner.js";
import { existsSync, watch as fsWatch, type FSWatcher } from "node:fs";
import {
  createDebugEventsStore,
  recordDebugAction,
  type DebugEventsStore,
  type LlmCallEventPayload,
} from "./debug-events.js";
import {
  summarizePersonas,
  getPersonaEvolution,
} from "./analytics.js";
import {
  listSubjectDiscoveries,
  listBoundaryEvents,
  summarizeBoundariesByCategory,
} from "./subject-knowledge-repo.js";
import {
  computeMapPositions,
  listFrameworks,
  type SubjectKnowledgeEntry,
  type JourneyStage,
} from "@ascendimacy/shared";
import {
  readOrComputeJourneyState,
  setParentalOverride,
  clearParentalOverride,
} from "./journey-state-repo.js";
import {
  getStrategyPlan,
  listStrategyPlansBySubject,
} from "./strategy-plan-repo.js";

export interface CreateBffServerOptions {
  daemon: OrchestratorDaemonClient;
  db: DatabaseType;
  /** Modo inicial do console. Default 'auto'. Caller decide via env
   *  ou flag. */
  initialMode?: ConsoleMode;
  /** Polling interval (ms) pro SSE stream de turn-state. Default 200ms
   *  (NFR latency ≤200ms target). */
  ssePollIntervalMs?: number;
  /** Logger desabilitado por default em testes — Fastify usa pino que
   *  polui stdout. */
  logger?: boolean;
  /** Base URL do UI dev server pra redirect das rotas /replay /live.
   *  Default http://localhost:5173 (vite). PR9 deploy serviria o
   *  build estático no próprio BFF. */
  uiBaseUrl?: string;
  /**
   * Diretório de traces — se fornecido, habilita:
   *  - POST /rescan endpoint (manual trigger)
   *  - fs.watch auto-rescan quando novo .json é criado (debounced 1s)
   * Default: undefined → endpoint retorna 503, sem watcher.
   */
  tracesDir?: string;
}

export interface BffServer {
  readonly fastify: FastifyInstance;
  /** Modo corrente — leitura sync; PATCH via endpoint /mode. */
  getMode(): ConsoleMode;
  /** Debug events store pra teste/injection. */
  readonly debugEvents: DebugEventsStore;
  /** Inicia o servidor escutando na porta. */
  listen(port: number, host?: string): Promise<void>;
  /** Fecha o servidor (graceful). */
  close(): Promise<void>;
}

export function createBffServer(opts: CreateBffServerOptions): BffServer {
  const fastify = Fastify({ logger: opts.logger ?? false });
  const startedAt = new Date().toISOString();
  const pollMs = opts.ssePollIntervalMs ?? 200;
  const uiBaseUrl = opts.uiBaseUrl ?? "http://localhost:5173";
  const debugEvents = createDebugEventsStore();
  let mode: ConsoleMode = opts.initialMode ?? "auto";

  // GET /status — health + observabilidade
  fastify.get("/status", async () => {
    const daemonStatus = await opts.daemon.daemonStatus();
    const status: BffStatus = {
      mode,
      daemonConnected: daemonStatus.started,
      // PR2: channelConnected ainda não wireado (motor-channels client
      // será adicionado quando spawn pattern bater). Por ora hardcoded
      // false até PR seguinte ligar.
      channelConnected: false,
      sessionCount: daemonStatus.sessionCount,
      startedAt,
    };
    return status;
  });

  // GET /mode — modo corrente
  fastify.get("/mode", async () => ({ mode }));

  // POST /mode — set modo (operador toggle Auto/Semi-auto)
  fastify.post<{ Body: { mode: ConsoleMode } }>(
    "/mode",
    async (req, reply) => {
      const body = req.body;
      if (body?.mode !== "auto" && body?.mode !== "semi-auto") {
        return reply.code(400).send({
          error: "mode deve ser 'auto' ou 'semi-auto'",
        });
      }
      mode = body.mode;
      return { mode };
    },
  );

  // POST /sessions/start-card — startCardSession via daemon
  fastify.post<{
    Body: {
      cardId: string;
      conversationId: string;
      from: string;
      pkg: { cardId: string; raw: string; sourcePath: string };
      personaId?: string;
    };
  }>("/sessions/start-card", async (req, reply) => {
    const body = req.body;
    if (
      body === undefined ||
      typeof body.cardId !== "string" ||
      typeof body.conversationId !== "string" ||
      typeof body.from !== "string" ||
      body.pkg === undefined
    ) {
      return reply
        .code(400)
        .send({ error: "campos obrigatórios: cardId, conversationId, from, pkg" });
    }
    return opts.daemon.startCardSession(body);
  });

  // GET /sessions/:id/turn-state — SSE stream polling subscribeTurnState
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/turn-state",
    async (req, reply) => {
      const sessionId = req.params.id;
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let nextIndex = 0;
      let closed = false;
      req.raw.on("close", () => {
        closed = true;
      });

      const sendEvent = (data: unknown): void => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // initial snapshot
      try {
        const snap = await opts.daemon.subscribeTurnState(sessionId, 0);
        for (const ev of snap.events) sendEvent(ev);
        nextIndex = snap.nextIndex;
      } catch (err) {
        sendEvent({ error: String(err) });
      }

      // polling loop
      while (!closed) {
        await new Promise<void>((r) => setTimeout(r, pollMs));
        if (closed) break;
        try {
          const snap = await opts.daemon.subscribeTurnState(
            sessionId,
            nextIndex,
          );
          for (const ev of snap.events) sendEvent(ev);
          nextIndex = snap.nextIndex;
        } catch (err) {
          sendEvent({ error: String(err) });
          break;
        }
      }
      try {
        reply.raw.end();
      } catch {
        // ignore
      }
    },
  );

  // GET /sessions/:id/options — listOptions
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/options",
    async (req) => opts.daemon.listOptions(req.params.id),
  );

  // POST /sessions/:id/override — overrideSelection + log jun_decisions
  fastify.post<{
    Params: { id: string };
    Body: { contentItemId: string; turn?: number; rationale?: string };
  }>("/sessions/:id/override", async (req, reply) => {
    const { contentItemId, turn, rationale } = req.body ?? {};
    if (typeof contentItemId !== "string") {
      return reply
        .code(400)
        .send({ error: "contentItemId obrigatório" });
    }
    const result = await opts.daemon.overrideSelection(
      req.params.id,
      contentItemId,
    );
    // Edit Learner v0 — só loga se override aplicado (accepted=true)
    if (result.accepted) {
      recordJunDecision(opts.db, {
        sessionId: req.params.id,
        turn: typeof turn === "number" ? turn : -1,
        decision: "override",
        overrideCardId: contentItemId,
        ...(typeof rationale === "string" ? { rationale } : {}),
      });
    }
    return result;
  });

  // GET /sessions/:id/pending-approval — getPendingApproval
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/pending-approval",
    async (req) => opts.daemon.getPendingApproval(req.params.id),
  );

  // POST /sessions/:id/approve — approveOrEdit + log jun_decisions
  fastify.post<{
    Params: { id: string };
    Body: ApprovalDecisionPayload & {
      turn?: number;
      originalText?: string;
    };
  }>("/sessions/:id/approve", async (req, reply) => {
    const body = req.body;
    if (body === undefined || typeof body.approved !== "boolean") {
      return reply
        .code(400)
        .send({ error: "approved (boolean) obrigatório" });
    }
    const { turn, originalText, ...decision } = body;
    const result = await opts.daemon.approveOrEdit(
      req.params.id,
      decision,
    );
    // Edit Learner v0 — sempre loga, mesmo gate inativo (caller pode
    // ter clicado approve sem haver pending; rastreável pra debug)
    if (result.gateWasActive) {
      const decisionType: "approve" | "edit" | "reject" =
        !decision.approved
          ? "reject"
          : decision.editedText !== undefined &&
              decision.editedText !== originalText
            ? "edit"
            : "approve";
      recordJunDecision(opts.db, {
        sessionId: req.params.id,
        turn: typeof turn === "number" ? turn : -1,
        decision: decisionType,
        ...(originalText !== undefined ? { originalText } : {}),
        ...(decision.editedText !== undefined
          ? { finalText: decision.editedText }
          : originalText !== undefined && decision.approved
            ? { finalText: originalText }
            : {}),
        ...(decision.rationale !== undefined
          ? { rationale: decision.rationale }
          : {}),
      });
    }
    return result;
  });

  // GET /sessions/:id/decisions — histórico Edit Learner v0 pra UI
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>("/sessions/:id/decisions", async (req) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    return { decisions: listRecentJunDecisions(opts.db, req.params.id, limit) };
  });

  // GET /sessions/library — session library com filtros (S-OC-30/31/32)
  fastify.get<{
    Querystring: {
      persona?: string;
      kind?: string;
      from?: string;
      to?: string;
      hasOverrides?: string;
      q?: string;
      limit?: string;
    };
  }>("/sessions/library", async (req) => {
    const q = req.query;
    const filters: SessionLibraryFilters = {};
    if (typeof q.persona === "string" && q.persona.length > 0) {
      filters.persona = q.persona;
    }
    if (q.kind === "real" || q.kind === "sts") {
      filters.kind = q.kind;
    }
    if (typeof q.from === "string" && q.from.length > 0) {
      filters.fromIso = q.from;
    }
    if (typeof q.to === "string" && q.to.length > 0) {
      filters.toIso = q.to;
    }
    if (q.hasOverrides === "true") {
      filters.hasOverrides = true;
    }
    if (typeof q.q === "string" && q.q.length > 0) {
      filters.q = q.q;
    }
    if (typeof q.limit === "string") {
      const n = Number(q.limit);
      if (!Number.isNaN(n)) filters.limit = n;
    }
    return { sessions: listSessionLibrary(opts.db, filters) };
  });

  // GET /sessions/:id/replay — trace JSON full pra replay UI
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/replay",
    async (req, reply) => {
      const trace = await readSessionTrace(opts.db, req.params.id);
      if (trace === null) {
        return reply
          .code(404)
          .send({ error: `trace not found for sessionId=${req.params.id}` });
      }
      return trace;
    },
  );

  // GET /replay/:id — visualizer deep link (S-OC-22 / Fase F). Redirect
  // pro UI dev server com query param. Em PR9 deploy, pode servir
  // build estático aqui mesmo. STS scenarios + Baileys smoke imprimem
  // essa URL no output (memory feedback Q15).
  fastify.get<{ Params: { id: string } }>(
    "/replay/:id",
    async (req, reply) => {
      const target = `${uiBaseUrl}/?replay=${encodeURIComponent(req.params.id)}`;
      return reply.redirect(target, 302);
    },
  );

  // GET /live/:id — visualizer live deep link
  fastify.get<{ Params: { id: string } }>(
    "/live/:id",
    async (req, reply) => {
      const target = `${uiBaseUrl}/?live=${encodeURIComponent(req.params.id)}`;
      return reply.redirect(target, 302);
    },
  );

  // POST /debug/llm-calls — gateway-client (futuro hook) ou tests
  // publicam events. body = LlmCallEventPayload.
  fastify.post<{ Body: LlmCallEventPayload }>(
    "/debug/llm-calls",
    async (req, reply) => {
      const body = req.body;
      if (
        body === undefined ||
        typeof body.step !== "string" ||
        typeof body.provider !== "string" ||
        typeof body.model !== "string" ||
        typeof body.prompt !== "object"
      ) {
        return reply.code(400).send({
          error: "campos obrigatórios: step, provider, model, prompt",
        });
      }
      const event = debugEvents.push(body);
      return { id: event.id, receivedAt: event.receivedAt };
    },
  );

  // GET /debug/llm-calls?sinceId=N — UI polling
  fastify.get<{ Querystring: { sinceId?: string } }>(
    "/debug/llm-calls",
    async (req) => {
      const sinceId =
        req.query.sinceId !== undefined
          ? Number(req.query.sinceId)
          : 0;
      const events = debugEvents.since(Number.isNaN(sinceId) ? 0 : sinceId);
      return {
        events,
        totalEmitted: debugEvents.totalEmitted(),
      };
    },
  );

  // DELETE /debug/llm-calls — clear buffer (dev utility)
  fastify.delete("/debug/llm-calls", async () => {
    debugEvents.clear();
    return { cleared: true };
  });

  // POST /debug/actions — log telemetry de actions (S-OC-29)
  fastify.post<{
    Body: {
      sessionId: string;
      llmCallId?: string;
      action: "tail" | "approve" | "edit" | "cancel" | "swap" | "bypass";
      originalPromptHash?: string;
      editedPromptHash?: string;
      swapTo?: string;
      rationale?: string;
    };
  }>("/debug/actions", async (req, reply) => {
    const body = req.body;
    if (
      body === undefined ||
      typeof body.sessionId !== "string" ||
      typeof body.action !== "string"
    ) {
      return reply.code(400).send({
        error: "campos obrigatórios: sessionId, action",
      });
    }
    const result = recordDebugAction(opts.db, body);
    if ("error" in result) {
      return reply.code(500).send({ error: result.error });
    }
    return { id: result.id };
  });

  // GET /analytics/personas — cross-session summary (S-OC-34)
  fastify.get("/analytics/personas", async () => {
    return { personas: summarizePersonas(opts.db) };
  });

  // GET /analytics/personas/:id/evolution — drill-down (S-OC-35/36)
  fastify.get<{ Params: { id: string } }>(
    "/analytics/personas/:id/evolution",
    async (req, reply) => {
      const evolution = getPersonaEvolution(opts.db, req.params.id);
      if (evolution === null) {
        return reply
          .code(404)
          .send({ error: `persona não encontrada: ${req.params.id}` });
      }
      return evolution;
    },
  );

  // POST /sessions/:id/end — endSession
  fastify.post<{ Params: { id: string } }>(
    "/sessions/:id/end",
    async (req) => opts.daemon.endSession(req.params.id),
  );

  // ── Subject Knowledge endpoints (Fase 2) ─────────────────────────
  // GET /subjects/:id/discoveries — interest/value/need/discovery
  fastify.get<{
    Params: { id: string };
    Querystring: { type?: string; session?: string; limit?: string };
  }>("/subjects/:id/discoveries", async (req) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const type =
      req.query.type === "interest" ||
      req.query.type === "value" ||
      req.query.type === "need" ||
      req.query.type === "discovery"
        ? req.query.type
        : undefined;
    return {
      discoveries: listSubjectDiscoveries(opts.db, req.params.id, {
        ...(type ? { type } : {}),
        ...(req.query.session ? { sessionId: req.query.session } : {}),
        ...(limit ? { limit } : {}),
      }),
    };
  });

  // GET /subjects/:id/boundaries — boundary_events crus
  fastify.get<{
    Params: { id: string };
    Querystring: { session?: string; limit?: string };
  }>("/subjects/:id/boundaries", async (req) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    return {
      boundaries: listBoundaryEvents(opts.db, req.params.id, {
        ...(req.query.session ? { sessionId: req.query.session } : {}),
        ...(limit ? { limit } : {}),
      }),
    };
  });

  // GET /subjects/:id/boundaries/summary — agregação por topic_category
  fastify.get<{ Params: { id: string } }>(
    "/subjects/:id/boundaries/summary",
    async (req) => ({
      summary: summarizeBoundariesByCategory(opts.db, req.params.id),
    }),
  );

  // ── MapFramework endpoints (Fase 8 sub-fase 8.3) ──────────────────
  // GET /frameworks — lista frameworks registrados (display_name + dims)
  fastify.get("/frameworks", async () => ({
    frameworks: listFrameworks().map((fw) => ({
      id: fw.id,
      display_name: fw.display_name,
      dimensions: fw.dimensions,
      render_hint: fw.render_hint,
    })),
  }));

  // GET /subjects/:id/maps[?framework=X,Y] — projeções multi-framework
  fastify.get<{
    Params: { id: string };
    Querystring: { framework?: string };
  }>("/subjects/:id/maps", async (req) => {
    const frameworkIds = req.query.framework
      ? req.query.framework.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : undefined;

    // Carrega entries do ledger pra projeção (todas as types relevantes).
    const entries = opts.db
      .prepare(
        `SELECT id, subject_id, type, source, confidence, confirmed_at,
                alignment, payload_json, turn_ref, session_id, created_at
         FROM subject_knowledge
         WHERE subject_id = ?`,
      )
      .all(req.params.id) as Array<{
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
      }>;

    const skEntries: SubjectKnowledgeEntry[] = entries.map((row) => ({
      id: row.id,
      subject_id: row.subject_id,
      type: row.type as SubjectKnowledgeEntry["type"],
      source: row.source as SubjectKnowledgeEntry["source"],
      confidence: row.confidence,
      confirmed_at: row.confirmed_at,
      alignment: row.alignment as SubjectKnowledgeEntry["alignment"],
      payload: JSON.parse(row.payload_json),
      turn_ref: row.turn_ref,
      session_id: row.session_id,
      created_at: row.created_at,
    }));

    return {
      maps: computeMapPositions({
        subjectId: req.params.id,
        entries: skEntries,
        ...(frameworkIds ? { frameworkIds } : {}),
      }),
    };
  });

  // ── Journey State endpoints (Fase 8 PR 1) ────────────────────────
  // GET /subjects/:id/journey-state — recomputa e retorna estado atual
  fastify.get<{ Params: { id: string } }>(
    "/subjects/:id/journey-state",
    async (req) => ({
      state: readOrComputeJourneyState(opts.db, req.params.id),
    }),
  );

  // POST /subjects/:id/journey-state/override — pai força stage específico
  fastify.post<{
    Params: { id: string };
    Body: { stage: JourneyStage; reason: string };
  }>("/subjects/:id/journey-state/override", async (req, reply) => {
    const { stage, reason } = req.body ?? ({} as { stage?: JourneyStage; reason?: string });
    if (
      stage !== "discovery_only" &&
      stage !== "mapping_ready" &&
      stage !== "applied_double_helix"
    ) {
      return reply.code(400).send({ error: "stage inválido" });
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return reply.code(400).send({ error: "reason obrigatório" });
    }
    return { state: setParentalOverride(opts.db, req.params.id, stage, reason) };
  });

  // DELETE /subjects/:id/journey-state/override — remove override
  fastify.delete<{ Params: { id: string } }>(
    "/subjects/:id/journey-state/override",
    async (req) => ({
      state: clearParentalOverride(opts.db, req.params.id),
    }),
  );

  // ── StrategyPlan endpoints (Fase 8 PR 3) ─────────────────────────
  // GET /sessions/:id/strategy-plan — plan composto pra esta sessão
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/strategy-plan",
    async (req, reply) => {
      const plan = getStrategyPlan(opts.db, req.params.id);
      if (!plan) {
        return reply.code(404).send({ error: "strategy_plan não encontrado" });
      }
      return { plan };
    },
  );

  // GET /subjects/:id/strategy-plans — histórico recente
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>("/subjects/:id/strategy-plans", async (req) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    return {
      plans: listStrategyPlansBySubject(opts.db, req.params.id, limit ?? 20),
    };
  });

  // POST /rescan — re-indexa o tracesDir (manual trigger).
  // Útil quando STS roda em outro processo e deposita novos traces;
  // o BFF normalmente só scaneia no startup.
  fastify.post("/rescan", async (_req, reply) => {
    if (!opts.tracesDir) {
      return reply
        .code(503)
        .send({ error: "tracesDir não configurado — rescan indisponível" });
    }
    const result = await scanTraces({
      tracesDir: opts.tracesDir,
      db: opts.db,
      log: () => {},
    });
    return result;
  });

  // fs.watch auto-rescan — debounce 1s pra agregar bursts.
  // Watcher só sobe se tracesDir existir; ausente vira no-op silencioso.
  let watcher: FSWatcher | null = null;
  let watchDebounce: NodeJS.Timeout | null = null;
  if (opts.tracesDir && existsSync(opts.tracesDir)) {
    watcher = fsWatch(opts.tracesDir, { recursive: true }, (_event, filename) => {
      if (!filename || !filename.toString().endsWith(".json")) return;
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        watchDebounce = null;
        void scanTraces({
          tracesDir: opts.tracesDir!,
          db: opts.db,
          log: () => {},
        });
      }, 1000);
    });
  }

  return {
    fastify,
    getMode: () => mode,
    debugEvents,
    async listen(port, host = "127.0.0.1") {
      await fastify.listen({ port, host });
    },
    async close() {
      if (watchDebounce) {
        clearTimeout(watchDebounce);
        watchDebounce = null;
      }
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      await fastify.close();
      await opts.daemon.close();
      opts.db.close();
    },
  };
}
