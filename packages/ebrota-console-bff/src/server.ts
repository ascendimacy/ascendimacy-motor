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
  type SessionLibraryFilters,
} from "./traces-scanner.js";

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
}

export interface BffServer {
  readonly fastify: FastifyInstance;
  /** Modo corrente — leitura sync; PATCH via endpoint /mode. */
  getMode(): ConsoleMode;
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

  // POST /sessions/:id/end — endSession
  fastify.post<{ Params: { id: string } }>(
    "/sessions/:id/end",
    async (req) => opts.daemon.endSession(req.params.id),
  );

  return {
    fastify,
    getMode: () => mode,
    async listen(port, host = "127.0.0.1") {
      await fastify.listen({ port, host });
    },
    async close() {
      await fastify.close();
      await opts.daemon.close();
      opts.db.close();
    },
  };
}
