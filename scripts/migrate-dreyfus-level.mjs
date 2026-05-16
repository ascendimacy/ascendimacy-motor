#!/usr/bin/env node
/**
 * Migration script ops#1015 G-01: preenche `dreyfus_level_target` em todos
 * os items de `content/hooks/seed.json` que ainda não tenham o field.
 *
 * Idempotente: re-execução não modifica items que já têm `dreyfus_level_target`.
 *
 * Pré-requisito: `npm run build -w @ascendimacy/shared` (script importa
 * deriveDreyfusLevel do dist compilado).
 *
 * Uso:
 *   npm run build -w @ascendimacy/shared
 *   node scripts/migrate-dreyfus-level.mjs [path/to/seed.json]
 *
 * Default path: content/hooks/seed.json (relativo ao repo root).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { deriveDreyfusLevel } from "../shared/dist/dreyfus-derive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SEED_PATH = path.join(REPO_ROOT, "content/hooks/seed.json");

function main() {
  const seedPath = path.resolve(process.argv[2] ?? DEFAULT_SEED_PATH);

  if (!fs.existsSync(seedPath)) {
    console.error(`[migrate-dreyfus-level] seed not found: ${seedPath}`);
    process.exit(2);
  }

  const raw = fs.readFileSync(seedPath, "utf8");
  const items = JSON.parse(raw);

  if (!Array.isArray(items)) {
    console.error("[migrate-dreyfus-level] seed root must be an array");
    process.exit(2);
  }

  let migrated = 0;
  let skipped = 0;
  const breakdown = new Map();

  for (const item of items) {
    if (item.dreyfus_level_target !== undefined) {
      skipped += 1;
      continue;
    }
    const range = deriveDreyfusLevel(item);
    item.dreyfus_level_target = range;
    migrated += 1;

    const key = `${range[0]}→${range[1]}`;
    breakdown.set(key, (breakdown.get(key) ?? 0) + 1);
  }

  if (migrated > 0) {
    fs.writeFileSync(seedPath, JSON.stringify(items, null, 2) + "\n", "utf8");
  }

  console.log(`[migrate-dreyfus-level] seed: ${seedPath}`);
  console.log(`[migrate-dreyfus-level] migrated=${migrated} skipped=${skipped} total=${items.length}`);
  if (breakdown.size > 0) {
    console.log("[migrate-dreyfus-level] derivation breakdown:");
    for (const [range, count] of [...breakdown.entries()].sort()) {
      console.log(`  ${range}  ×${count}`);
    }
  }
  if (migrated === 0) {
    console.log("[migrate-dreyfus-level] no-op (idempotent re-run)");
  }
}

main();
