#!/usr/bin/env node
/**
 * aggregate-gateway-logs CLI — motor#28e validation infra.
 *
 * Lê NDJSON gerado pelo llm-gateway e produz markdown report.
 *
 * Usage:
 *   node llm-gateway/scripts/aggregate-gateway-logs.mjs [options]
 *
 * Options:
 *   --dir <path>             Diretório com .ndjson (default: motor/logs/llm-gateway)
 *   --prefix <str>           Filtra run_ids por prefix (ex: "nagareyama-14d")
 *   --sla-ms <number>        Threshold E2E SLA proxy em ms (default: 15000)
 *   --required-steps <list>  Steps comma-separated obrigatórios pra "full turn"
 *                            (default: planejador,drota,signal-extractor — motor full pipeline)
 *                            STS context: planejador,drota
 *   --output <path>          Caminho do markdown output (default: stdout)
 */

import { join, dirname } from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEventsFromDir, computeReport, formatReportMarkdown } from "../dist/aggregate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const motorRoot = join(__dirname, "../..");

function parseArgs(argv) {
  const args = {
    dir: join(motorRoot, "logs/llm-gateway"),
    prefix: undefined,
    slaMs: 15000,
    requiredSteps: undefined, // undefined = use default in computeReport
    output: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") args.dir = argv[++i];
    else if (a === "--prefix") args.prefix = argv[++i];
    else if (a === "--sla-ms") args.slaMs = Number.parseInt(argv[++i] ?? "15000", 10);
    else if (a === "--required-steps") {
      const v = argv[++i] ?? "";
      args.requiredSteps = v.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--output") args.output = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        `Usage: aggregate-gateway-logs.mjs [--dir <path>] [--prefix <str>] [--sla-ms <n>] [--required-steps <list>] [--output <path>]`,
      );
      process.exit(0);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

console.error(`[aggregate] reading from ${args.dir}${args.prefix ? ` (prefix=${args.prefix})` : ""}`);
const events = loadEventsFromDir(args.dir, args.prefix);
console.error(`[aggregate] ${events.length} events loaded`);

const reportOpts = { e2eSlaMs: args.slaMs, runIdPrefix: args.prefix };
if (args.requiredSteps) reportOpts.requiredSteps = args.requiredSteps;
const report = computeReport(events, reportOpts);
const md = formatReportMarkdown(report);

if (args.output) {
  writeFileSync(args.output, md);
  console.error(`[aggregate] report written to ${args.output}`);
} else {
  process.stdout.write(md);
}
