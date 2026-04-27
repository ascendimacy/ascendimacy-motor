/**
 * Postgres connection pool — singleton compartilhado por todos os
 * repos concretos (status-matrix-repo-pg, futuras adapters de mood/trust/budget/helix).
 *
 * Spec: ascendimacy-motor#40 (F1-bootstrap-db)
 * Migration framework: node-pg-migrate (DT default Jun 27-abr).
 *
 * Env vars (padrão): PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE.
 * Max connections: 10 (suficiente pra piloto Yuji single-família; subir
 * em multi-família escala futura).
 *
 * Lazy init: pool só é criado no primeiro getPool(). closePool() libera
 * connections graciosamente — testes devem chamar em afterAll.
 */

import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";

const DEFAULT_MAX_CONNECTIONS = 10;
const DEFAULT_PORT = 5432;

let _pool: Pool | null = null;

/** Configuração lida de env vars. Falha se vars críticas ausentes. */
function buildPoolConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  max: number;
} {
  const host = process.env["PG_HOST"];
  const user = process.env["PG_USER"];
  const password = process.env["PG_PASSWORD"];
  const database = process.env["PG_DATABASE"];

  if (!host || !user || !password || !database) {
    throw new Error(
      "db.ts: env vars ausentes. Set PG_HOST, PG_USER, PG_PASSWORD, PG_DATABASE.",
    );
  }

  const portStr = process.env["PG_PORT"];
  const port = portStr ? Number.parseInt(portStr, 10) : DEFAULT_PORT;
  if (Number.isNaN(port)) {
    throw new Error(`db.ts: PG_PORT inválido: "${portStr}"`);
  }

  return {
    host,
    port,
    user,
    password,
    database,
    max: DEFAULT_MAX_CONNECTIONS,
  };
}

/**
 * Retorna o singleton Pool. Cria no primeiro call. Reusa após.
 *
 * Lança Error se env vars críticas ausentes — tests com `skipIf(!PG_HOST)`
 * não chamam getPool() e evitam a falha.
 */
export function getPool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool(buildPoolConfig());
  return _pool;
}

/**
 * Fecha o pool graciosamente. No-op se nunca foi criado.
 * Idempotente — segunda chamada não faz nada.
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Helper de query parametrizada. Pega connection do pool,
 * executa, libera de volta.
 *
 * Tipagem: `T extends QueryResultRow` permite caller passar a row type
 * esperada e receber typed result.rows.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const pool = getPool();
  return pool.query<T>(sql, params);
}

/**
 * Helper de transação. Recebe callback que recebe PoolClient; commita
 * automaticamente se callback resolve, rollback se rejeita.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Para tests — força reset do singleton. NÃO usar em produção. */
export function _resetPoolForTests(): void {
  _pool = null;
}
