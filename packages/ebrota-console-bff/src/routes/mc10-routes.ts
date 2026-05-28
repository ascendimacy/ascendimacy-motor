/**
 * MC10 Mobile Onboarding routes — wrappa a state machine de
 * `mc10-mobile-flow.ts` em endpoints HTTP. Cliente final será o webhook
 * Twilio/WhatsApp (PR futuro); por ora os endpoints existem pra teste
 * e integração progressiva.
 *
 * Feature flag: `MC10_MOBILE_ONBOARDING=true` no env do BFF. Quando
 * desabilitado, todos endpoints respondem 503.
 *
 * Persistence: tabela `mc10_mobile_sessions` no SQLite BFF.
 *   - session_id, started_at, current_step, replies_json, completed_at,
 *     completion_payload_json, child_name, child_age.
 *
 * Endpoints:
 *   POST /mc10/mobile/start              → { sessionId, firstPrompt }
 *   POST /mc10/mobile/:sessionId/reply   → { nextPrompt | completionPayload, complete }
 *   GET  /mc10/mobile/:sessionId         → status atual (debug)
 */

import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  FIRST_STEP,
  MC10_STEPS,
  buildCompletionPayload,
  getNextStep,
  parseReply,
  type Mc10CompletionPayload,
  type Mc10ParsedValue,
  type Mc10ReplyHistoryEntry,
  type Mc10StepId,
} from "../mc10-mobile-flow.js";

export interface Mc10RoutesOptions {
  db: DatabaseType;
  /** Process env injetável pra tests. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
}

interface Mc10SessionRow {
  session_id: string;
  started_at: string;
  current_step: string;
  replies_json: string;
  completed_at: string | null;
  completion_payload_json: string | null;
  child_name: string | null;
  child_age: number | null;
}

function isEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.MC10_MOBILE_ONBOARDING === "true";
}

function loadHistory(row: Mc10SessionRow): Mc10ReplyHistoryEntry[] {
  try {
    const arr = JSON.parse(row.replies_json) as Mc10ReplyHistoryEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const mc10Routes: FastifyPluginAsync<Mc10RoutesOptions> = async (fastify, opts) => {
  const { db } = opts;
  const env = opts.env ?? process.env;

  const guard = (
    reply: { code: (n: number) => { send: (body: unknown) => unknown } },
  ): unknown | null => {
    if (!isEnabled(env)) {
      return reply
        .code(503)
        .send({ error: "MC10 mobile onboarding disabled" });
    }
    return null;
  };

  fastify.post("/mc10/mobile/start", async (_req, reply) => {
    const blocked = guard(reply);
    if (blocked !== null) return blocked;

    const sessionId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO mc10_mobile_sessions
         (session_id, started_at, current_step, replies_json)
       VALUES (?, ?, ?, '[]')`,
    ).run(sessionId, now, FIRST_STEP);
    return {
      sessionId,
      firstPrompt: MC10_STEPS[FIRST_STEP].promptText,
      currentStep: FIRST_STEP,
    };
  });

  fastify.post<{
    Params: { sessionId: string };
    Body: { text?: string };
  }>("/mc10/mobile/:sessionId/reply", async (req, reply) => {
    const blocked = guard(reply);
    if (blocked !== null) return blocked;

    const { sessionId } = req.params;
    const text = req.body?.text;
    if (typeof text !== "string") {
      return reply.code(400).send({ error: "body.text obrigatório (string)" });
    }

    const row = db
      .prepare(
        `SELECT session_id, started_at, current_step, replies_json,
                completed_at, completion_payload_json, child_name, child_age
         FROM mc10_mobile_sessions WHERE session_id = ?`,
      )
      .get(sessionId) as Mc10SessionRow | undefined;
    if (!row) {
      return reply.code(404).send({ error: `session ${sessionId} não encontrada` });
    }

    // Idempotency: se já completa, retorna payload sem mudar estado.
    if (row.completed_at !== null && row.completion_payload_json) {
      return {
        sessionId,
        complete: true,
        completionPayload: JSON.parse(
          row.completion_payload_json,
        ) as Mc10CompletionPayload,
        currentStep: row.current_step as Mc10StepId,
      };
    }

    const currentStep = row.current_step as Mc10StepId;
    const parsed = parseReply(currentStep, text);
    if (!parsed.ok) {
      return reply.code(400).send({
        sessionId,
        error: parsed.error,
        hint: parsed.hint,
        currentStep,
        retryPrompt: MC10_STEPS[currentStep].promptText,
      });
    }

    const transition = getNextStep(currentStep, text);
    const history = loadHistory(row);
    history.push({
      stepId: currentStep,
      rawText: text,
      parsed: parsed.parsed,
    });

    const nextStep = transition.nextStep;
    const isComplete = nextStep === "complete";

    let completionPayload: Mc10CompletionPayload | null = null;
    let childName: string | null = row.child_name;
    let childAge: number | null = row.child_age;

    if (parsed.parsed.kind === "name") {
      childName = parsed.parsed.value;
    }
    if (parsed.parsed.kind === "age") {
      childAge = parsed.parsed.value;
    }

    if (isComplete) {
      // Só compõe payload se consent foi sim. Se sim/não veio falso, ainda
      // marca como complete (terminou o fluxo) mas consentGranted=false.
      completionPayload = buildCompletionPayload(history);
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE mc10_mobile_sessions
       SET current_step = ?,
           replies_json = ?,
           completed_at = ?,
           completion_payload_json = ?,
           child_name = ?,
           child_age = ?
       WHERE session_id = ?`,
    ).run(
      nextStep,
      JSON.stringify(history),
      isComplete ? now : null,
      completionPayload ? JSON.stringify(completionPayload) : null,
      childName,
      childAge,
      sessionId,
    );

    if (isComplete && completionPayload) {
      return {
        sessionId,
        complete: true,
        completionPayload,
        currentStep: nextStep,
      };
    }
    return {
      sessionId,
      complete: false,
      nextPrompt: MC10_STEPS[nextStep].promptText,
      currentStep: nextStep,
    };
  });

  fastify.get<{ Params: { sessionId: string } }>(
    "/mc10/mobile/:sessionId",
    async (req, reply) => {
      const blocked = guard(reply);
      if (blocked !== null) return blocked;

      const { sessionId } = req.params;
      const row = db
        .prepare(
          `SELECT session_id, started_at, current_step, replies_json,
                  completed_at, completion_payload_json, child_name, child_age
           FROM mc10_mobile_sessions WHERE session_id = ?`,
        )
        .get(sessionId) as Mc10SessionRow | undefined;
      if (!row) {
        return reply
          .code(404)
          .send({ error: `session ${sessionId} não encontrada` });
      }
      const history = loadHistory(row);
      const replies: Record<string, Mc10ParsedValue> = {};
      for (const h of history) {
        replies[h.stepId] = h.parsed;
      }
      return {
        sessionId,
        startedAt: row.started_at,
        currentStep: row.current_step as Mc10StepId,
        complete: row.completed_at !== null,
        completedAt: row.completed_at,
        completionPayload: row.completion_payload_json
          ? (JSON.parse(row.completion_payload_json) as Mc10CompletionPayload)
          : null,
        replies,
        childName: row.child_name,
        childAge: row.child_age,
      };
    },
  );
};

export default mc10Routes;
