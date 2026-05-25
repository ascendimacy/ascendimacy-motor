#!/usr/bin/env node
/**
 * BFF entry point — C-MX-08 PR2 (S-OC-05).
 *
 * Lê env vars + boots servidor Fastify. Daemon client é stdio pro
 * orchestrator daemon (C-MX-07 binary `motor-daemon`); fallback pra
 * mock quando EBROTA_BFF_USE_MOCK_DAEMON=true.
 *
 * Env vars:
 *   EBROTA_BFF_PORT          (default 3737, D-OC-02 ratificado)
 *   EBROTA_BFF_HOST          (default 127.0.0.1)
 *   EBROTA_BFF_DB_PATH       (default ./.ebrota-console.db)
 *   EBROTA_BFF_INITIAL_MODE  (default 'auto')
 *   EBROTA_BFF_USE_MOCK_DAEMON (default false; useful pra dev sem daemon)
 *
 * Production: daemon spawn vira PR seguinte (precisa C-MX-07 mergeado
 * em main + binary path resolvable). PR2 ship com mock por default
 * pra UI dev workflow não bloquear.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initDb } from "./db.js";
import { createBffServer } from "./server.js";
import { createMockDaemonClient } from "./daemon-client.js";
import { scanTraces } from "./traces-scanner.js";
import type { ConsoleMode } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TRACES_DIR = resolve(join(__dirname, "../../../traces"));

const port = Number(process.env["EBROTA_BFF_PORT"] ?? "3737");
const host = process.env["EBROTA_BFF_HOST"] ?? "127.0.0.1";
const dbPath = process.env["EBROTA_BFF_DB_PATH"] ?? "./.ebrota-console.db";
const tracesDir =
  process.env["EBROTA_BFF_TRACES_DIR"] ?? DEFAULT_TRACES_DIR;
const modeEnv = process.env["EBROTA_BFF_INITIAL_MODE"];
const initialMode: ConsoleMode =
  modeEnv === "semi-auto" ? "semi-auto" : "auto";

const useMockDaemon =
  (process.env["EBROTA_BFF_USE_MOCK_DAEMON"] ?? "true") !== "false";

const log = (msg: string): void => {
  process.stderr.write(`[ebrota-console-bff] ${msg}\n`);
};

log(`starting on ${host}:${port}`);
log(`db path: ${dbPath}`);
log(`traces dir: ${tracesDir}`);
log(`mode: ${initialMode}`);

if (useMockDaemon) {
  log("⚠️  EBROTA_BFF_USE_MOCK_DAEMON=true — using in-memory mock daemon");
  log("   (set EBROTA_BFF_USE_MOCK_DAEMON=false when C-MX-07 daemon merged)");
}

const db = initDb({ dbPath });
const daemon = useMockDaemon
  ? createMockDaemonClient()
  : (() => {
      // Production stdio impl vira PR seguinte. Pra V0.1 PR2, sai com
      // erro explícito se EBROTA_BFF_USE_MOCK_DAEMON=false ainda.
      throw new Error(
        "Stdio daemon client não implementado em PR2 — ship em PR seguinte " +
          "após C-MX-07 mergeado. Use EBROTA_BFF_USE_MOCK_DAEMON=true ou " +
          "deixe unset (default mock).",
      );
    })();

const server = createBffServer({
  daemon,
  db,
  initialMode,
  logger: true,
  tracesDir,
});

// Scan traces ANTES de listen (idempotente; ok mesmo se dir não existe).
const scanResult = await scanTraces({ tracesDir, db, log });
log(
  `traces scan: ${scanResult.sessionsIndexed} sessions, ` +
    `${scanResult.messagesIndexed} messages, ` +
    `${scanResult.errors.length} errors`,
);

await server.listen(port, host);
log(`✅ ready on http://${host}:${port}`);

const shutdown = async (sig: NodeJS.Signals): Promise<void> => {
  log(`received ${sig}, shutting down`);
  await server.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
