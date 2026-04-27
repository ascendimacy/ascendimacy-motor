/**
 * Integration tests pro postgres bootstrap (motor#40).
 *
 * skipIf(!PG_HOST): tests não rodam em CI default (zero DB infra). Devs
 * com postgres local podem rodar setando env vars + db:migrate antes:
 *
 *   PG_HOST=localhost PG_PORT=5432 PG_USER=postgres \
 *   PG_PASSWORD=secret PG_DATABASE=ascendimacy_test \
 *   npm run db:migrate
 *   npm test --workspace shared
 *
 * Alternativa pra CI futuro: testcontainers spawn ephemeral postgres.
 * Fora de escopo de motor#40 v0 — aceitável tests skipados em CI.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closePool, query, _resetPoolForTests } from "../src/db.js";
import { pgStatusMatrixRepo } from "../src/status-matrix-repo-pg.js";
import type { StatusMatrixEntry } from "../src/status-matrix.js";

const HAS_PG = Boolean(process.env["PG_HOST"]);
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

async function ensureTestUser(): Promise<void> {
  await query(
    `INSERT INTO users (id, name, age, trust_level)
     VALUES ($1, 'test-user', 10, 0.33)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_ID],
  );
}

async function cleanTestUser(): Promise<void> {
  // CASCADE em status_matrix.user_id remove rows automaticamente
  await query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID]);
}

describe.skipIf(!HAS_PG)("db.ts — pool integration", () => {
  beforeAll(async () => {
    await ensureTestUser();
  });

  afterAll(async () => {
    await cleanTestUser();
    await closePool();
    _resetPoolForTests();
  });

  it("pool conecta com env vars válidas", async () => {
    const result = await query<{ ok: number }>(`SELECT 1 as ok`);
    expect(result.rows[0]?.ok).toBe(1);
  });

  it("migration 001 aplicou — tabela users existe e aceita inserts", async () => {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM users WHERE id = $1`,
      [TEST_USER_ID],
    );
    expect(Number(result.rows[0]?.count)).toBe(1);
  });

  it("closePool fecha graciosamente (idempotente)", async () => {
    await closePool();
    await closePool(); // segunda chamada é no-op
    expect(true).toBe(true);
  });
});

describe.skipIf(!HAS_PG)("pgStatusMatrixRepo — integration", () => {
  let repo: ReturnType<typeof pgStatusMatrixRepo>;

  beforeAll(async () => {
    await ensureTestUser();
    // Limpa eventual rows residuais
    await query(`DELETE FROM status_matrix WHERE user_id = $1`, [TEST_USER_ID]);
    repo = pgStatusMatrixRepo();
  });

  afterAll(async () => {
    await query(`DELETE FROM status_matrix WHERE user_id = $1`, [TEST_USER_ID]);
    await cleanTestUser();
    await closePool();
    _resetPoolForTests();
  });

  it("upsert + loadAll roundtrip", async () => {
    const entry: StatusMatrixEntry = {
      userId: TEST_USER_ID,
      dimension: "emotional",
      status: "baia",
      lastTransitionAt: new Date().toISOString(),
    };
    await repo.upsert(entry);

    const rows = await repo.loadAll(TEST_USER_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dimension).toBe("emotional");
    expect(rows[0]?.status).toBe("baia");
  });

  it("upsert idempotente — segunda upsert sobrescreve status", async () => {
    await repo.upsert({
      userId: TEST_USER_ID,
      dimension: "cognitive_math",
      status: "brejo",
      lastTransitionAt: new Date().toISOString(),
    });
    await repo.upsert({
      userId: TEST_USER_ID,
      dimension: "cognitive_math",
      status: "baia",
      lastTransitionAt: new Date().toISOString(),
    });
    const rows = await repo.loadAll(TEST_USER_ID);
    const cog = rows.find((r) => r.dimension === "cognitive_math");
    expect(cog?.status).toBe("baia");
  });

  it("CHECK constraint rejeita status inválido", async () => {
    await expect(
      query(
        `INSERT INTO status_matrix (user_id, dimension, status)
         VALUES ($1, 'test_dim', 'invalido')`,
        [TEST_USER_ID],
      ),
    ).rejects.toThrow();
  });

  it("loadAll isola users — não retorna rows de outros users", async () => {
    // user fictício não existente
    const rows = await repo.loadAll("00000000-0000-0000-0000-99999999");
    expect(rows).toEqual([]);
  });
});
