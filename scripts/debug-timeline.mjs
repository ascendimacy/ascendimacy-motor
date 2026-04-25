#!/usr/bin/env node
/**
 * debug-timeline — utilitário de replay cronológico pra runs com ASC_DEBUG_MODE=true.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-24-debug-mode.md
 *
 * Uso:
 *   node scripts/debug-timeline.mjs --run <run_id>
 *   node scripts/debug-timeline.mjs --run <run_id> --user ryo-ochiai
 *   node scripts/debug-timeline.mjs --run <run_id> --step drota
 *   node scripts/debug-timeline.mjs --run <run_id> --turn 5
 *   node scripts/debug-timeline.mjs --run <run_id> --tokens-only
 *   node scripts/debug-timeline.mjs --run <run_id> --reasoning-only
 *   node scripts/debug-timeline.mjs --run <run_id> --no-content
 *
 * Dirs default:
 *   logs/debug/<run_id>/events.ndjson
 *   logs/debug/<run_id>/content/<hash>.txt
 *   logs/debug/<run_id>/snapshots/<hash>.json
 *
 * Override dir com --dir /path/to/logs/debug
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const opts = {
    run: null,
    dir: null,
    user: null,
    includePartner: false,
    step: null,
    turn: null,
    day: null,
    session: null,
    tokensOnly: false,
    reasoningOnly: false,
    noContent: false,
    list: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run" && argv[i + 1]) opts.run = argv[++i];
    else if (a === "--dir" && argv[i + 1]) opts.dir = argv[++i];
    else if (a === "--user" && argv[i + 1]) opts.user = argv[++i];
    else if (a === "--include-partner") opts.includePartner = true;
    else if (a === "--step" && argv[i + 1]) opts.step = argv[++i];
    else if (a === "--turn" && argv[i + 1]) opts.turn = parseInt(argv[++i], 10);
    else if (a === "--day" && argv[i + 1]) opts.day = parseInt(argv[++i], 10);
    else if (a === "--session" && argv[i + 1]) opts.session = argv[++i];
    else if (a === "--tokens-only") opts.tokensOnly = true;
    else if (a === "--reasoning-only") opts.reasoningOnly = true;
    else if (a === "--no-content") opts.noContent = true;
    else if (a === "--list") opts.list = true;
    else if (a === "-h" || a === "--help") opts.help = true;
  }
  return opts;
}

function usage() {
  console.log(`Usage:
  node scripts/debug-timeline.mjs --run <run_id> [filters]

Filters:
  --user <id>           Filter to events involving this user
  --include-partner     Include events where user is partner (joint sessions)
  --step <name>         Filter by step (planejador|drota|persona-sim|auto-hook|...)
  --turn <n>            Filter by turn_number
  --day <n>             Filter by scenario_day
  --session <id>        Filter by session_id prefix

Views:
  --tokens-only         Summary of cost/latency per step, no content
  --reasoning-only      Only print reasoning blocks
  --no-content          Metadata only, no prompts/responses
  --list                List available runs

Dir override:
  --dir <path>          Override debug logs base dir (default: ./logs/debug)
`);
}

function getBaseDir(opts) {
  return opts.dir ?? join(process.cwd(), "logs", "debug");
}

function listRuns(baseDir) {
  if (!existsSync(baseDir)) {
    console.log(`(no runs — ${baseDir} does not exist)`);
    return;
  }
  const entries = readdirSync(baseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  console.log(`Available runs in ${baseDir}:`);
  for (const name of entries) console.log(`  ${name}`);
}

function loadEvents(baseDir, runId) {
  const path = join(baseDir, runId, "events.ndjson");
  if (!existsSync(path)) {
    throw new Error(`events.ndjson not found at ${path}`);
  }
  const raw = readFileSync(path, "utf-8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

function loadBlob(baseDir, runId, hash, kind) {
  if (!hash) return null;
  const hashHex = hash.replace(/^sha256:/, "");
  const ext = kind === "snapshots" ? "json" : "txt";
  const path = join(baseDir, runId, kind, `${hashHex}.${ext}`);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

function filterEvents(events, opts) {
  return events.filter((e) => {
    if (opts.user) {
      const match =
        e.user_id === opts.user ||
        (opts.includePartner && e.partner_user_id === opts.user);
      if (!match) return false;
    }
    if (opts.step && e.step !== opts.step) return false;
    if (opts.turn !== null && e.turn_number !== opts.turn) return false;
    if (opts.day !== null && e.scenario_day !== opts.day) return false;
    if (opts.session && !e.session_id?.startsWith(opts.session)) return false;
    return true;
  });
}

function printTokensSummary(events) {
  const byStep = {};
  let totalCost = 0;
  let totalLatency = 0;
  let totalIn = 0, totalOut = 0, totalReasoning = 0;

  for (const e of events) {
    if (!e.tokens) continue;
    if (!byStep[e.step]) byStep[e.step] = { count: 0, in: 0, out: 0, reasoning: 0, latency: 0, cost: 0 };
    const s = byStep[e.step];
    s.count++;
    s.in += e.tokens.in || 0;
    s.out += e.tokens.out || 0;
    s.reasoning += e.tokens.reasoning || 0;
    s.latency += e.latency_ms || 0;
    s.cost += e.cost_usd_est || 0;
    totalIn += e.tokens.in || 0;
    totalOut += e.tokens.out || 0;
    totalReasoning += e.tokens.reasoning || 0;
    totalLatency += e.latency_ms || 0;
    totalCost += e.cost_usd_est || 0;
  }
  console.log(`\nToken/cost summary — ${events.length} events\n`);
  console.log("step              calls  tokens_in  tokens_out  reasoning  avg_lat  total_cost");
  console.log("-".repeat(90));
  for (const [step, s] of Object.entries(byStep).sort()) {
    const avgLat = s.count > 0 ? Math.round(s.latency / s.count) : 0;
    console.log(
      `${step.padEnd(18)}${String(s.count).padStart(5)}${String(s.in).padStart(11)}${String(s.out).padStart(12)}${String(s.reasoning).padStart(11)}${(avgLat + "ms").padStart(9)}${("$" + s.cost.toFixed(4)).padStart(12)}`,
    );
  }
  console.log("-".repeat(90));
  console.log(
    `${"TOTAL".padEnd(18)}${String(events.length).padStart(5)}${String(totalIn).padStart(11)}${String(totalOut).padStart(12)}${String(totalReasoning).padStart(11)}${("~" + Math.round(totalLatency / Math.max(1, events.length)) + "ms").padStart(9)}${("$" + totalCost.toFixed(4)).padStart(12)}`,
  );
}

function printEvent(baseDir, runId, e, opts) {
  const tsShort = e.ts.slice(11, 23);
  const header = `[${tsShort}] ${e.side} → ${e.step}`;
  const modelTag = e.model ? ` (${e.model}` : "";
  const latTag = e.latency_ms != null ? `, ${e.latency_ms}ms` : "";
  const tokTag = e.tokens
    ? `, ${e.tokens.in}+${e.tokens.out}${e.tokens.reasoning ? "+" + e.tokens.reasoning + "🧠" : ""} tok`
    : "";
  const closer = e.model ? ")" : "";
  const userTag = ` user=${e.user_id}${e.partner_user_id ? "+" + e.partner_user_id : ""}`;
  const sessTag = e.session_id ? ` session=${e.session_id.slice(0, 8)}` : "";
  const turnTag = e.turn_number != null ? ` turn=${e.turn_number}` : "";
  console.log(`\n${header}${modelTag}${latTag}${tokTag}${closer}${userTag}${sessTag}${turnTag}`);

  if (e.outcome === "skip") console.log(`   outcome=skip ${e.error_class ?? ""}`);
  if (e.outcome === "error") console.log(`   outcome=error error_class=${e.error_class ?? "?"}`);

  if (opts.reasoningOnly) {
    const reasoning = loadBlob(baseDir, runId, e.reasoning_hash, "content");
    if (reasoning) console.log(`   REASONING ↓\n${indent(reasoning, "     ")}`);
    return;
  }

  if (opts.noContent) return;

  if (e.snapshots_pre) {
    for (const [engine, hash] of Object.entries(e.snapshots_pre)) {
      const snap = loadBlob(baseDir, runId, hash, "snapshots");
      if (snap) {
        const summary = summarizeSnapshot(JSON.parse(snap));
        console.log(`   SNAPSHOT.${engine}.PRE: ${summary}`);
      }
    }
  }

  if (e.prompt_hash) {
    const prompt = loadBlob(baseDir, runId, e.prompt_hash, "content");
    if (prompt) console.log(`   PROMPT ↓\n${indent(truncate(prompt, 2000), "     ")}`);
  }

  if (e.reasoning_hash) {
    const reasoning = loadBlob(baseDir, runId, e.reasoning_hash, "content");
    if (reasoning) console.log(`   REASONING ↓\n${indent(truncate(reasoning, 2000), "     ")}`);
  }

  if (e.response_hash) {
    const response = loadBlob(baseDir, runId, e.response_hash, "content");
    if (response) console.log(`   RESPONSE ↓\n${indent(truncate(response, 1500), "     ")}`);
  }

  if (e.snapshots_post) {
    for (const [engine, hash] of Object.entries(e.snapshots_post)) {
      const snap = loadBlob(baseDir, runId, hash, "snapshots");
      if (snap) {
        const summary = summarizeSnapshot(JSON.parse(snap));
        console.log(`   SNAPSHOT.${engine}.POST: ${summary}`);
      }
    }
  }
}

function summarizeSnapshot(snap) {
  const keys = Object.keys(snap).slice(0, 6);
  return keys.map((k) => `${k}=${JSON.stringify(snap[k]).slice(0, 60)}`).join(", ");
}

function indent(s, prefix) {
  return s.split("\n").map((l) => prefix + l).join("\n");
}

function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... [truncated, ${s.length - max} more chars]`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.run && !opts.list)) {
    usage();
    process.exit(opts.help ? 0 : 1);
  }
  const baseDir = getBaseDir(opts);
  if (opts.list) {
    listRuns(baseDir);
    return;
  }
  const events = loadEvents(baseDir, opts.run);
  events.sort((a, b) => a.ts.localeCompare(b.ts));
  const filtered = filterEvents(events, opts);

  if (opts.tokensOnly) {
    printTokensSummary(filtered);
    return;
  }

  console.log(`\n═══ Run: ${opts.run} ═══`);
  console.log(`Total events: ${events.length} (${filtered.length} after filters)\n`);

  for (const e of filtered) {
    printEvent(baseDir, opts.run, e, opts);
  }
  console.log("\n═══ End ═══");
}

main();
