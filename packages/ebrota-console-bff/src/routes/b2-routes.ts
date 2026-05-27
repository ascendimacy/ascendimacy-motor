/**
 * B2 routes — Drilling (banks, drill state, due, mastered).
 *
 * Plugin Fastify registrado em server.ts via:
 *   await fastify.register((await import("./routes/b2-routes.js")).default, opts)
 *
 * Endpoints:
 *   GET /banks                          → { banks: [{ bank_id, title, item_count }] }
 *   GET /banks/:bankId                  → DrillBank (full content)
 *   GET /personas/:id/drill-state       → { states: DrillState[] }
 *   GET /personas/:id/drill-due         → { states: DrillState[] }
 *   GET /personas/:id/drill-mastered    → { states: DrillState[] }
 */

import { readdirSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { Database as DatabaseType } from "better-sqlite3";
import type { DrillResponse, DrillState } from "@ascendimacy/shared";
import {
  listAttempts,
  loadBank,
  listDue,
  listMastered,
  type DrillAttemptRow,
} from "@ascendimacy/motor-execucao/drill-repo";

export interface B2RoutesOptions {
  db: DatabaseType;
  /** Diretório raiz onde estão fixtures/banks/*.yaml.
   *  Default: `fixtures` resolvido a partir de process.cwd(). */
  fixturesDir?: string;
}

interface DrillStateRow {
  persona_id: string;
  item_id: string;
  presented_count: number;
  correct_count: number;
  last_seen_at: string;
  next_due_at: string;
  current_interval_days: number;
  current_easiness: number;
  mastery_reached_at: string | null;
  last_5_attempts_json: string;
}

function rowToState(row: DrillStateRow): DrillState {
  return {
    persona_id: row.persona_id,
    item_id: row.item_id,
    presented_count: row.presented_count,
    correct_count: row.correct_count,
    last_seen_at: row.last_seen_at,
    next_due_at: row.next_due_at,
    current_interval_days: row.current_interval_days,
    current_easiness: row.current_easiness,
    mastery_reached_at: row.mastery_reached_at,
    last_5_attempts: JSON.parse(row.last_5_attempts_json) as DrillResponse[],
  };
}

const b2RoutesPlugin: FastifyPluginAsync<B2RoutesOptions> = async (
  fastify: FastifyInstance,
  opts: B2RoutesOptions,
) => {
  const fixturesDir = opts.fixturesDir
    ? isAbsolute(opts.fixturesDir)
      ? opts.fixturesDir
      : resolve(opts.fixturesDir)
    : resolve(process.cwd(), "fixtures");

  const banksRoot = resolve(fixturesDir, "banks");

  fastify.get("/banks", async () => {
    if (!existsSync(banksRoot)) return { banks: [] };
    const files = readdirSync(banksRoot).filter((f) => f.endsWith(".yaml"));
    const banks = files.map((file) => {
      const bankId = file.replace(/\.yaml$/, "");
      try {
        const { bank } = loadBank(bankId, { root: banksRoot });
        return {
          bank_id: bank.bank_id,
          title: bank.title,
          curator: bank.curator,
          item_count: bank.items.length,
          target_personas: bank.target_personas ?? [],
        };
      } catch {
        return {
          bank_id: bankId,
          title: "(falha ao carregar)",
          curator: "?",
          item_count: 0,
          target_personas: [],
        };
      }
    });
    return { banks };
  });

  fastify.get<{ Params: { bankId: string } }>(
    "/banks/:bankId",
    async (req, reply) => {
      try {
        const { bank, items } = loadBank(req.params.bankId, {
          root: banksRoot,
        });
        return { bank, items };
      } catch (err) {
        return reply.code(404).send({
          error: `bank não encontrado: ${req.params.bankId}`,
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/drill-state",
    async (req) => {
      const rows = opts.db
        .prepare("SELECT * FROM drill_states WHERE persona_id = ?")
        .all(req.params.id) as DrillStateRow[];
      return { states: rows.map(rowToState) };
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/drill-due",
    async (req) => {
      return { states: listDue(opts.db, req.params.id) };
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/drill-mastered",
    async (req) => {
      return { states: listMastered(opts.db, req.params.id) };
    },
  );

  /**
   * GET /personas/:id/drill-attempts?limit=N
   *
   * Última tentativas (drill_attempts), ordenadas DESC por attempted_at.
   * Usado pelo B2 panel pra "last attempts" block.
   * Limit default 20, máximo 200.
   *
   * Spec: ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md
   */
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>(
    "/personas/:id/drill-attempts",
    async (req) => {
      const rawLimit = req.query?.limit;
      let limit = 20;
      if (rawLimit !== undefined) {
        const parsed = Number.parseInt(rawLimit, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          limit = Math.min(parsed, 200);
        }
      }
      const all = listAttempts(opts.db, req.params.id);
      const attempts: DrillAttemptRow[] = all.slice().reverse().slice(0, limit);
      return { attempts };
    },
  );
};

export default b2RoutesPlugin;
