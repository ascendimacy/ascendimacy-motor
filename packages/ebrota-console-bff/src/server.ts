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
 *   GET  /sessions/active                       → { sessionIds: string[] }
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
import {
  initParentalOnboardingSchema,
  readLatest as readLatestOnboarding,
  saveDraft as saveOnboardingDraft,
  markComplete as markOnboardingComplete,
} from "./parental-onboarding-store.js";
import {
  initMc1Schema,
  scheduleMc1,
  latestByPersona as latestMc1ByPersona,
  cancelPendingByPersona as cancelMc1ByPersona,
} from "@ascendimacy/motor-execucao/mc1-repo";
import parentalDashboardRoutes from "./routes/parental-dashboard-routes.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import b1RoutesPlugin from "./routes/b1-routes.js";
import b2RoutesPlugin from "./routes/b2-routes.js";

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
  /**
   * Diretório de fixtures pra escrita do parental-profile.yaml ao
   * finalizar onboarding (US-PO-11). Quando omitido, endpoint completa
   * o draft no SQLite mas não escreve YAML em disco.
   */
  fixturesDir?: string;
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

  initParentalOnboardingSchema(opts.db);
  initMc1Schema(opts.db);
  void fastify.register(async (instance) => (await import("./routes/s1-routes.js")).default(instance, { db: opts.db }));
  void fastify.register(async (instance) => (await import("./routes/s2-routes.js")).default(instance, { db: opts.db }));
  void fastify.register(async (instance) => (await import("./routes/s3-routes.js")).default(instance, opts.tracesDir !== undefined ? { tracesDir: opts.tracesDir } : {}));
  void fastify.register(async (instance) =>
    (await import("./routes/s4-routes.js")).default(instance, {
      db: opts.db,
      ...(opts.tracesDir !== undefined ? { tracesDir: opts.tracesDir } : {}),
    }),
  );
  void fastify.register(async (instance) => (await import("./routes/s5-routes.js")).default(instance, { db: opts.db }));

  // B1/B2 wiring — Camada Social + Drilling. Fastify enfileira o register
  // até .listen()/.ready() resolverem; ok chamar síncrono dentro do factory.
  const sharedRouteOpts = {
    db: opts.db,
    ...(opts.fixturesDir !== undefined
      ? { fixturesDir: opts.fixturesDir }
      : {}),
  };
  void fastify.register(b1RoutesPlugin, sharedRouteOpts);
  void fastify.register(b2RoutesPlugin, sharedRouteOpts);

  // Parental Engaged Dashboard (US-PE-01..09) — plugin Fastify isolado.
  void fastify.register(parentalDashboardRoutes, {});

  // In-memory set de sessionIds ativos (iniciados via /sessions/start-card,
  // removidos via /sessions/:id/end). Permite que App.svelte faça polling
  // em GET /sessions/active e auto-conecte ao live stream (Fix 3 / S-OC-05).
  const activeSessions = new Set<string>();

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
    const result = await opts.daemon.startCardSession(body);
    activeSessions.add(result.sessionId);
    return result;
  });

  // GET /sessions/active — lista sessionIds ativos (iniciados, não encerrados).
  // App.svelte faz polling aqui pra auto-conectar ao live stream (Fix 3).
  fastify.get("/sessions/active", async () => ({
    sessionIds: [...activeSessions],
  }));

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
    async (req) => {
      activeSessions.delete(req.params.id);
      return opts.daemon.endSession(req.params.id);
    },
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

  // ── Parental Onboarding Wizard (US-PO-01..11) ────────────────────
  // MC10 material — bullets + frases JP. V0 hardcoded a partir do spec
  // 2026-05-19-mc10-onboarding-yuji.md §3. Versionamento via spec ID
  // futura quando MC10 final ratificado.
  fastify.get("/parental/mc10-material", async () => ({
    beforeBullets: [
      "Decida em qual cenário vai apresentar — ambos juntos ou um de cada vez (recomendação: um de cada vez).",
    ],
    duringBullets: [
      "Diga o que você quiser sobre quem construiu — mas não minta. Se a criança perguntar, Brota confirma que é IA.",
      'Diga que Brota vai mandar mensagem espontânea: "em breve, o Brota vai mandar mensagem pra você. Você não precisa responder se não quiser."',
    ],
    afterBullets: [
      "Não pergunte sobre as conversas dele com o Brota. Deixe a criança contar por iniciativa.",
      "Se reclamar do Brota, repassa pro Jun ANTES de mudar comportamento.",
    ],
    jpPhrases: [
      {
        pt: "Em breve, o Brota vai mandar mensagem. Você não precisa responder se não quiser.",
        jp: "もうすぐ、ブロータからメッセージが来るよ。返事したくなかったらしなくていいよ。",
      },
    ],
    escalationPath:
      "Kid reclama do tom, JP soa estranho, loop ou tema difícil → escala pro Jun. Yuji não precisa virar professor do Brota.",
  }));

  // POST /parental/onboarding/draft — salva estado idempotente.
  fastify.post<{ Body: Record<string, unknown> }>(
    "/parental/onboarding/draft",
    async (req, reply) => {
      const state = req.body;
      if (state === undefined || state === null || typeof state !== "object") {
        return reply.code(400).send({ error: "body deve ser objeto WizardState" });
      }
      const record = saveOnboardingDraft(opts.db, state);
      return {
        acquirerId: record.acquirerId,
        step: record.step,
        status: record.status,
        updatedAt: record.updatedAt,
      };
    },
  );

  // GET /parental/onboarding/status — retorna current step (retomada).
  fastify.get("/parental/onboarding/status", async () => {
    const record = readLatestOnboarding(opts.db);
    if (!record) return { status: "not_started" };
    return {
      acquirerId: record.acquirerId,
      step: record.step,
      status: record.status,
      updatedAt: record.updatedAt,
      completedAt: record.completedAt,
    };
  });

  // POST /parental/onboarding/complete — finaliza, escreve YAML +
  // dispara evento persona_ready_for_pilot.
  fastify.post<{ Body: Record<string, unknown> }>(
    "/parental/onboarding/complete",
    async (req, reply) => {
      const state = req.body;
      if (state === undefined || state === null || typeof state !== "object") {
        return reply.code(400).send({ error: "body deve ser objeto WizardState" });
      }
      // Validação mínima: precisa de pelo menos 1 criança + telos.
      const family = (state.family ?? {}) as Record<string, unknown>;
      const children = (family.children ?? []) as unknown[];
      if (!Array.isArray(children) || children.length === 0) {
        return reply
          .code(400)
          .send({ error: "ao menos 1 criança obrigatória em family.children" });
      }
      const record = markOnboardingComplete(opts.db, state);

      // YAML write — só se fixturesDir configurado.
      let yamlPath: string | null = null;
      if (opts.fixturesDir) {
        yamlPath = `${opts.fixturesDir}/parental-profile-${record.acquirerId}.yaml`;
        try {
          mkdirSync(dirname(yamlPath), { recursive: true });
          writeFileSync(yamlPath, serializeToYaml(state), "utf8");
        } catch (err) {
          return reply.code(500).send({
            error: `falha ao escrever YAML: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // Evento persona_ready_for_pilot — V0 só loga em debug_actions.
      // Próximo PR pode wire pro orchestrator daemon notificar Jun.
      try {
        opts.db
          .prepare(
            `INSERT INTO debug_actions (session_id, action, rationale, recorded_at)
             VALUES (?, 'persona_ready_for_pilot', ?, ?)`,
          )
          .run(
            record.acquirerId,
            `Family ${record.acquirerId} ready for pilot (${children.length} children)`,
            new Date().toISOString(),
          );
      } catch {
        // best-effort
      }

      // Schedule MC1 entries para cada criança com aprovação válida.
      // Idempotente: cancela pendentes prévias da persona antes (re-run
      // do wizard rescheduleia). Spec
      // 2026-05-19-mc1-primeira-mensagem-brota-jp.md §9 cravou MC1 como
      // canonical first message — entrega na próxima janela aberta.
      const mc1Approvals = Array.isArray(state.mc1Approvals)
        ? (state.mc1Approvals as Array<{
            childId?: unknown;
            text?: unknown;
            approved?: unknown;
          }>)
        : [];
      const scheduledMc1 = [];
      for (const approval of mc1Approvals) {
        if (
          typeof approval.childId !== "string" ||
          typeof approval.text !== "string" ||
          approval.approved !== true ||
          approval.text.length === 0
        ) {
          continue;
        }
        try {
          cancelMc1ByPersona(opts.db, approval.childId);
          const scheduled = scheduleMc1(opts.db, {
            personaId: approval.childId,
            approvedText: approval.text,
            // V0 hard-coded — primeira janela kid post-school. Quando
            // wizard preferir window específica, ler de windowsByChild.
            targetWindowName: "post-school-jp",
          });
          scheduledMc1.push({
            childId: approval.childId,
            mc1ScheduledId: scheduled.id,
            scheduledAt: scheduled.scheduledAt,
          });
        } catch {
          // best-effort; falha em uma criança não bloqueia completion.
        }
      }

      return {
        acquirerId: record.acquirerId,
        status: "complete",
        completedAt: record.completedAt,
        yamlPath,
        event: "persona_ready_for_pilot",
        mc1Scheduled: scheduledMc1,
      };
    },
  );

  // POST /parental/mc1/preview — gera primeira mensagem customizada.
  // V0 retorna template stub. Futuramente chama orchestrator daemon ou
  // LLM gateway com persona context.
  fastify.post<{
    Body: {
      personaId?: string;
      childName?: string;
      age?: number;
      language?: string;
      telos?: { text?: string; tags?: string[] };
      virtues?: Array<{ axis: number; note?: string }>;
    };
  }>("/parental/mc1/preview", async (req, reply) => {
    const body = req.body ?? {};
    if (typeof body.childName !== "string" || body.childName.length === 0) {
      return reply.code(400).send({ error: "childName obrigatório" });
    }
    const name = body.childName;
    const lang = body.language ?? "pt";
    const tags = body.telos?.tags ?? [];
    const tagsStr = tags.length > 0 ? tags.slice(0, 2).join(" e ") : "curiosidade";

    const ptText = `Oi, ${name}! Eu sou o Brota — uma plantinha que conversa. Estou aprendendo sobre ${tagsStr} e queria saber: o que você acha mais legal de explorar hoje? Você não precisa responder se não quiser.`;

    const jpText =
      lang === "jp"
        ? `\n\n${name}くんへ\nぼくはブロータ。話せる小さな植物です。今日、何が一番おもしろいか教えてくれる？返事したくなかったらしなくていいよ。`
        : "";

    return {
      personaId: body.personaId ?? "",
      text: ptText + jpText,
      generatedAt: new Date().toISOString(),
    };
  });

  // GET /parental/mc1/status?childId=X — status MC1 (pending/delivered/
  // cancelled/not_scheduled) + delivered_at. Usado pelo dashboard pra
  // badge "MC1 pendente" enquanto status=pending.
  fastify.get<{ Querystring: { childId?: string } }>(
    "/parental/mc1/status",
    async (req, reply) => {
      const childId = req.query.childId;
      if (typeof childId !== "string" || childId.length === 0) {
        return reply.code(400).send({ error: "childId obrigatório" });
      }
      const rec = latestMc1ByPersona(opts.db, childId);
      if (!rec) {
        return {
          childId,
          status: "not_scheduled" as const,
          deliveredAt: null,
          scheduledAt: null,
        };
      }
      return {
        childId,
        status: rec.status,
        deliveredAt: rec.deliveredAt,
        scheduledAt: rec.scheduledAt,
        targetWindowName: rec.targetWindowName,
      };
    },
  );

  // POST /parental/mc1/cancel?childId=X — cancela MC1 pending. Idempotente:
  // se nada pending, returns cancelled=0.
  fastify.post<{ Querystring: { childId?: string } }>(
    "/parental/mc1/cancel",
    async (req, reply) => {
      const childId = req.query.childId;
      if (typeof childId !== "string" || childId.length === 0) {
        return reply.code(400).send({ error: "childId obrigatório" });
      }
      const cancelled = cancelMc1ByPersona(opts.db, childId);
      return { childId, cancelled };
    },
  );

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
    async listen(port: number, host = "127.0.0.1") {
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

/**
 * Mini-YAML serializer pra parental-profile fixture. Não usa lib (yaml
 * não está em deps). Cobre só os shapes do WizardState — strings, números,
 * booleans, arrays e objetos aninhados. Strings com caracteres especiais
 * são quotadas; chaves sempre nuas.
 */
function serializeToYaml(state: unknown): string {
  const lines: string[] = ["# Parental Profile — gerado por Onboarding Wizard"];
  lines.push(`# Gerado em ${new Date().toISOString()}`);
  lines.push("");
  emitNode(lines, "profile", state, 0);
  return lines.join("\n") + "\n";
}

function emitNode(
  lines: string[],
  key: string | null,
  value: unknown,
  indent: number,
): void {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) {
    if (key !== null) lines.push(`${pad}${key}: null`);
    return;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const serialized = serializeScalar(value);
    if (key !== null) lines.push(`${pad}${key}: ${serialized}`);
    else lines.push(`${pad}${serialized}`);
    return;
  }
  if (Array.isArray(value)) {
    if (key !== null) lines.push(`${pad}${key}:`);
    if (value.length === 0) {
      lines[lines.length - 1] = `${pad}${key !== null ? `${key}: ` : ""}[]`;
      return;
    }
    for (const item of value) {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item)
      ) {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length === 0) {
          lines.push(`${pad}- {}`);
          continue;
        }
        lines.push(`${pad}-`);
        for (const [k, v] of entries) {
          emitNode(lines, k, v, indent + 1);
        }
      } else {
        const scalar = serializeScalar(
          item as string | number | boolean | null | undefined,
        );
        lines.push(`${pad}- ${scalar}`);
      }
    }
    return;
  }
  if (typeof value === "object") {
    if (key !== null) lines.push(`${pad}${key}:`);
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      lines[lines.length - 1] = `${pad}${key !== null ? `${key}: ` : ""}{}`;
      return;
    }
    for (const [k, v] of entries) {
      emitNode(lines, k, v, key !== null ? indent + 1 : indent);
    }
  }
}

function serializeScalar(
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  const s = value;
  if (
    s.length === 0 ||
    /[:#\-?&*!|>'"%@`]|^\s|\s$|^(true|false|null|yes|no)$/i.test(s) ||
    /\n/.test(s) ||
    /^-?\d/.test(s)
  ) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}
