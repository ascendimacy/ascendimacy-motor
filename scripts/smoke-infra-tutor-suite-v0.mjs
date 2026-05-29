#!/usr/bin/env node
/**
 * Smoke INFRA SUITE — Tutor Clássico v0 (Lote 1 — CP1+CP2+CP3+CP4)
 *
 * Orquestrador. Roda em sequência todos os smokes infra do Tutor v0,
 * captura stdout, parseia o "Total: X pass, Y fail, Z bypass" de cada um,
 * agrega e imprime resumo. Propaga exit code != 0 se qualquer filho falhar.
 *
 * Não duplica os testes — invoca os scripts existentes via child process.
 *
 * Uso:
 *   npm run build --workspace shared && \
 *   npm run build --workspace motor-execucao && \
 *   npm run build --workspace planejador && \
 *   npm run build --workspace motor-drota
 *   node scripts/smoke-infra-tutor-suite-v0.mjs
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SMOKES = [
  { cp: "CP1", item: "Item 1", name: "contract", file: "smoke-infra-tutor-contract-v0.mjs" },
  { cp: "CP1", item: "Item 2", name: "pipeline", file: "smoke-infra-tutor-pipeline-v0.mjs" },
  { cp: "CP2", item: "Item 3", name: "trace", file: "smoke-infra-tutor-trace-v0.mjs" },
  { cp: "CP2", item: "Item 4", name: "regression", file: "smoke-infra-tutor-regression-v0.mjs" },
  { cp: "CP3", item: "Item 5", name: "mastery-ref", file: "smoke-infra-tutor-mastery-ref-v0.mjs" },
  { cp: "CP4", item: "Itens 6+7", name: "decision", file: "smoke-infra-tutor-decision-v0.mjs" },
  { cp: "CP5", item: "Item 8", name: "materializer-reaction", file: "smoke-infra-tutor-materializer-reaction-v0.mjs" },
  { cp: "CP6", item: "Itens 9+11", name: "policies", file: "smoke-infra-tutor-policies-v0.mjs" },
  { cp: "CP7", item: "Item 10", name: "persistence", file: "smoke-infra-tutor-persistence-v0.mjs" },
  { cp: "CP8", item: "Item 12", name: "helix", file: "smoke-infra-tutor-helix-v0.mjs" },
  { cp: "CP9", item: "Item 13", name: "e2e [func]", file: "smoke-func-tutor-e2e-v0.mjs" },
  { cp: "v0.2.7", item: "Bandas", name: "inaugural-bands", file: "smoke-infra-tutor-inaugural-bands-v0.mjs" },
];

const TOTALS_RE = /Total:\s+(\d+)\s+pass,\s+(\d+)\s+fail,\s+(\d+)\s+bypass/;
const HR = "═".repeat(72);

let totalPass = 0;
let totalFail = 0;
let totalBypass = 0;
let suiteExitCode = 0;
const results = [];

console.log(`\n${HR}`);
console.log("[suite] Tutor Clássico v0 — Lote 1 (CP1-CP4) + Lote 2 (CP5+)");
console.log(HR);

for (const { cp, item, name, file } of SMOKES) {
  const filePath = path.join(__dirname, file);

  console.log(`\n${"─".repeat(72)}`);
  console.log(`[suite] ${cp} · ${item} · ${file}`);
  console.log("─".repeat(72));

  const t0 = Date.now();
  const result = spawnSync("node", [filePath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const durationMs = Date.now() - t0;

  const stdout = result.stdout?.toString() ?? "";
  const stderr = result.stderr?.toString() ?? "";
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const m = stdout.match(TOTALS_RE);
  let p = 0;
  let f = 0;
  let b = 0;
  let parsed = false;
  if (m) {
    p = parseInt(m[1], 10);
    f = parseInt(m[2], 10);
    b = parseInt(m[3], 10);
    parsed = true;
  } else {
    console.error(`[suite] ⚠ não foi possível parsear totais de ${file}`);
  }

  totalPass += p;
  totalFail += f;
  totalBypass += b;

  const exitCode = result.status ?? -1;
  if (exitCode !== 0) suiteExitCode = 1;

  results.push({ cp, item, name, pass: p, fail: f, bypass: b, exit: exitCode, durationMs, parsed });
}

const padRight = (s, n) => (s + " ".repeat(n)).slice(0, n);
const padLeft = (s, n) => (" ".repeat(n) + s).slice(-n);

console.log(`\n${HR}`);
console.log("[suite] Resumo");
console.log(HR);
console.log(
  `  ${padRight("CP", 5)} ${padRight("escopo", 11)} ${padRight("smoke", 24)} ${padLeft("pass", 6)} ${padLeft("fail", 6)} ${padLeft("bypass", 8)} ${padLeft("ms", 6)} ${padLeft("exit", 6)}`,
);
console.log(`  ${"-".repeat(74)}`);
for (const r of results) {
  console.log(
    `  ${padRight(r.cp, 5)} ${padRight(r.item, 11)} ${padRight(r.name, 24)} ${padLeft(String(r.pass), 6)} ${padLeft(String(r.fail), 6)} ${padLeft(String(r.bypass), 8)} ${padLeft(String(r.durationMs), 6)} ${padLeft(String(r.exit), 6)}`,
  );
}
console.log(`  ${"-".repeat(74)}`);
console.log(
  `  ${padRight("TOTAL", 5)} ${padRight("", 11)} ${padRight("", 24)} ${padLeft(String(totalPass), 6)} ${padLeft(String(totalFail), 6)} ${padLeft(String(totalBypass), 8)}`,
);

console.log("");
if (suiteExitCode === 0 && totalFail === 0) {
  console.log(`[suite] ✓ suite verde (${SMOKES.length} smokes, ${totalPass} asserts, ${totalBypass} bypass)`);
} else {
  console.log(`[suite] ✗ falhas detectadas (fail total=${totalFail}, suite exit=${suiteExitCode})`);
}

process.exit(suiteExitCode);
