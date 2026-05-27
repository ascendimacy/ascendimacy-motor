/**
 * B1 routes — Camada Social (cards, sacrifice budget, dyad, janelas, pulso).
 *
 * Plugin Fastify registrado em server.ts via:
 *   await fastify.register((await import("./routes/b1-routes.js")).default, opts)
 *
 * Endpoints:
 *   GET /personas/:id/temporal-windows  → TemporalWindow ou 404
 *   GET /personas/:id/pulso-events      → { events: PulsoEventLike[] }  (stub v0)
 *   GET /personas/:id/sacrifice-budget  → { ..., source: "stub_v0" }    (stub v0)
 *   GET /personas/:id/cards             → { cards: EmittedCard[] }
 *   GET /personas/:id/dyad              → { dyad: null, source: "stub_v0" } (stub v0)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import yaml from "js-yaml";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  TemporalWindowSchema,
  initBudget,
  MOOD_HIGH_BONUS,
  MOOD_HIGH_THRESHOLD,
  MOOD_LOW_PENALTY,
  MOOD_LOW_THRESHOLD,
  TRUST_HIGH_BONUS,
  TRUST_HIGH_THRESHOLD,
  TRUST_LOW_PENALTY,
  TRUST_LOW_THRESHOLD,
} from "@ascendimacy/shared";
import { getEmittedCardsByChild } from "@ascendimacy/motor-execucao/cards-repo";

export interface B1RoutesOptions {
  db: DatabaseType;
  /** Diretório raiz onde estão fixtures/temporal-windows/<persona>.yaml.
   *  Default: `fixtures` resolvido a partir de process.cwd(). */
  fixturesDir?: string;
}

/** Baseline budget Kids per spec §3 (sacrifice-budget.ts). */
const KIDS_BASELINE = 15;

interface PulsoEventLike {
  emitted_at: string;
  trigger: string;
  pulso_kind: string;
  text: string;
}

function readTemporalWindow(
  fixturesDir: string,
  personaId: string,
): unknown | null {
  const path = resolve(fixturesDir, "temporal-windows", `${personaId}.yaml`);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  return yaml.load(raw);
}

const b1RoutesPlugin: FastifyPluginAsync<B1RoutesOptions> = async (
  fastify: FastifyInstance,
  opts: B1RoutesOptions,
) => {
  const fixturesDir = opts.fixturesDir
    ? isAbsolute(opts.fixturesDir)
      ? opts.fixturesDir
      : resolve(opts.fixturesDir)
    : resolve(process.cwd(), "fixtures");

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/temporal-windows",
    async (req, reply) => {
      const parsed = readTemporalWindow(fixturesDir, req.params.id);
      if (parsed === null) {
        return reply.code(404).send({
          error: `temporal-window não encontrada para persona ${req.params.id}`,
        });
      }
      const result = TemporalWindowSchema.safeParse(parsed);
      if (!result.success) {
        return reply.code(500).send({
          error: "YAML inválido para TemporalWindowSchema",
          issues: result.error.issues,
        });
      }
      return result.data;
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/pulso-events",
    async () => {
      const events: PulsoEventLike[] = [];
      return { events };
    },
  );

  fastify.get<{
    Params: { id: string };
    Querystring: { mood?: string; trust?: string };
  }>("/personas/:id/sacrifice-budget", async (req) => {
    const mood = req.query.mood !== undefined ? Number(req.query.mood) : 5;
    const trust =
      req.query.trust !== undefined ? Number(req.query.trust) : 0.5;
    const baseline = KIDS_BASELINE;
    const current = initBudget({ baseline }, mood, trust);

    const modifiers: Array<{
      label: string;
      delta: number;
      active: boolean;
    }> = [
      {
        label: `mood ≥ ${MOOD_HIGH_THRESHOLD} (+${MOOD_HIGH_BONUS})`,
        delta: MOOD_HIGH_BONUS,
        active: mood >= MOOD_HIGH_THRESHOLD,
      },
      {
        label: `mood < ${MOOD_LOW_THRESHOLD} (${MOOD_LOW_PENALTY})`,
        delta: MOOD_LOW_PENALTY,
        active: mood < MOOD_LOW_THRESHOLD,
      },
      {
        label: `trust ≥ ${TRUST_HIGH_THRESHOLD} (+${TRUST_HIGH_BONUS})`,
        delta: TRUST_HIGH_BONUS,
        active: trust >= TRUST_HIGH_THRESHOLD,
      },
      {
        label: `trust < ${TRUST_LOW_THRESHOLD} (${TRUST_LOW_PENALTY})`,
        delta: TRUST_LOW_PENALTY,
        active: trust < TRUST_LOW_THRESHOLD,
      },
    ];

    return {
      persona_id: req.params.id,
      baseline,
      current,
      mood,
      trust,
      modifiers,
      source: "stub_v0",
    };
  });

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/cards",
    async (req) => {
      const cards = getEmittedCardsByChild(opts.db, req.params.id);
      return { cards };
    },
  );

  fastify.get<{ Params: { id: string } }>("/personas/:id/dyad", async () => {
    return { dyad: null, source: "stub_v0" };
  });
};

export default b1RoutesPlugin;
