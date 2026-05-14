#!/usr/bin/env node
/**
 * dossier-debug-events.mjs — monta dossier markdown a partir de events.ndjson
 *
 * Lê o NDJSON do debug-logger + resolve prompt_hash/response_hash em
 * `content/<hash>.txt` (CAS blob storage). Produz markdown human-readable
 * com ênfase nos casos de interesse (errors, degraded) para diagnóstico
 * pos-mortem.
 *
 * Spec: ascendimacy-ops/docs/specs/H-AC-12-variancia-geracao-v0.md
 * Origin: gap detectado durante full smoke 2026-05-14 — debug NDJSON cresce
 * rápido + queremos varrer outcomes sem grep manual.
 *
 * Usage:
 *   node scripts/dossier-debug-events.mjs <path/to/events.ndjson> [options]
 *   node scripts/dossier-debug-events.mjs --auto-find  # acha NDJSON mais recente
 *
 * Options:
 *   --filter <list>       outcomes a incluir, comma-separated; default: error,degraded
 *                         valores: ok | ok-retry | degraded | error | all
 *   --max-content <N>     chars por blob (default 3000); use 0 pra completo
 *   --output <path>       salva markdown em arquivo (default: stdout)
 *   --include-prompt      inclui prompt em cada entry (default: só response)
 *   --since <ISO>         filtra ts >= since
 *   --auto-find           usa NDJSON mais recente em ASC_DEBUG_DIR
 *                         (default $REPO/motor-drota/logs/debug)
 *   -h, --help
 *
 * Exemplo concreto (debugar smoke atual):
 *   node scripts/dossier-debug-events.mjs --auto-find --filter error --include-prompt
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ============================================================================
// Args
// ============================================================================

function parseArgs(argv) {
  const args = {
    ndjsonPath: null,
    filter: ["error", "degraded"],
    maxContent: 3000,
    output: null,
    includePrompt: false,
    since: null,
    autoFind: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") { printHelp(); process.exit(0); }
    else if (a === "--filter") {
      const v = argv[++i];
      args.filter = v === "all"
        ? ["ok", "ok-retry", "degraded", "error"]
        : v.split(",").map((s) => s.trim());
    }
    else if (a === "--max-content") args.maxContent = Number.parseInt(argv[++i], 10);
    else if (a === "--output") args.output = argv[++i];
    else if (a === "--include-prompt") args.includePrompt = true;
    else if (a === "--since") args.since = argv[++i];
    else if (a === "--auto-find") args.autoFind = true;
    else if (!a.startsWith("--")) args.ndjsonPath = a;
  }
  return args;
}

function printHelp() {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf-8")
    .split("\n")
    .slice(1, 32)
    .map((l) => l.replace(/^ \*\/?\s?/, ""))
    .join("\n"));
}

// ============================================================================
// NDJSON discovery
// ============================================================================

function findLatestNdjson() {
  // Procura em ordem: ASC_DEBUG_DIR env, /tmp/menu-gen-debug,
  // $REPO/motor-drota/logs/debug
  const candidates = [
    process.env.ASC_DEBUG_DIR,
    "/tmp/menu-gen-debug",
    path.join(REPO_ROOT, "motor-drota", "logs", "debug"),
  ].filter(Boolean);

  let latest = null;
  let latestMtime = 0;

  for (const dir of candidates) {
    try {
      for (const sub of readdirSync(dir)) {
        const ndjson = path.join(dir, sub, "events.ndjson");
        try {
          const st = statSync(ndjson);
          if (st.mtimeMs > latestMtime) {
            latestMtime = st.mtimeMs;
            latest = ndjson;
          }
        } catch { /* not exists */ }
      }
    } catch { /* dir not exists */ }
  }
  return latest;
}

// ============================================================================
// Event parsing + content resolution
// ============================================================================

function readEvents(ndjsonPath) {
  const raw = readFileSync(ndjsonPath, "utf-8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l, i) => {
      try { return JSON.parse(l); }
      catch (err) {
        console.error(`Skip line ${i + 1}: ${err.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

function blobPath(ndjsonPath, hash) {
  // hash é "sha256:<hex>". Blobs ficam em ../content/<hex>.txt
  if (!hash || typeof hash !== "string") return null;
  const m = hash.match(/^sha256:([0-9a-f]+)$/);
  if (!m) return null;
  const hex = m[1];
  const runDir = path.dirname(ndjsonPath);
  return path.join(runDir, "content", `${hex}.txt`);
}

function readBlob(ndjsonPath, hash, maxLen) {
  const p = blobPath(ndjsonPath, hash);
  if (!p) return null;
  try {
    const content = readFileSync(p, "utf-8");
    if (maxLen > 0 && content.length > maxLen) {
      const half = Math.floor(maxLen / 2);
      return content.slice(0, half) +
        `\n\n[...${content.length - maxLen} chars truncados...]\n\n` +
        content.slice(-half);
    }
    return content;
  } catch {
    return null;
  }
}

// ============================================================================
// Markdown rendering
// ============================================================================

function fmtDuration(ms) {
  if (ms == null) return "n/a";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTokens(t) {
  if (!t) return "n/a";
  return `in=${t.in ?? 0} out=${t.out ?? 0}${t.reasoning ? ` reasoning=${t.reasoning}` : ""}`;
}

function fmtCost(c) {
  if (c == null) return "null (unknown model)";
  if (c === 0) return "$0 (local/free)";
  return `$${c.toFixed(6)}`;
}

function renderDossier(args, events, ndjsonPath) {
  const lines = [];

  // === Header ===
  lines.push(`# Dossier — events.ndjson investigação`);
  lines.push("");
  lines.push(`**Source:** \`${ndjsonPath}\``);
  lines.push(`**Filter:** \`${args.filter.join(", ")}\`${args.since ? ` (since ${args.since})` : ""}`);
  lines.push(`**Gerado:** ${new Date().toISOString()}`);
  lines.push("");

  // === Summary (todos os outcomes, mesmo filtrados depois) ===
  const allOutcomes = events.reduce((acc, e) => {
    const k = e.outcome ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  lines.push("## Sumário");
  lines.push("");
  lines.push("| outcome | count | % |");
  lines.push("|---|---|---|");
  const total = events.length;
  for (const [k, v] of Object.entries(allOutcomes).sort((a, b) => b[1] - a[1])) {
    const pct = total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "-";
    lines.push(`| ${k} | ${v} | ${pct} |`);
  }
  lines.push(`| **total** | **${total}** | 100% |`);
  lines.push("");

  // Latência por outcome
  const latencyByOutcome = {};
  for (const e of events) {
    if (e.latency_ms == null) continue;
    const k = e.outcome ?? "unknown";
    (latencyByOutcome[k] ??= []).push(e.latency_ms);
  }
  if (Object.keys(latencyByOutcome).length > 0) {
    lines.push("### Latência por outcome (mean / min / max)");
    lines.push("");
    lines.push("| outcome | n | mean | min | max |");
    lines.push("|---|---|---|---|---|");
    for (const [k, lats] of Object.entries(latencyByOutcome)) {
      const mean = lats.reduce((s, v) => s + v, 0) / lats.length;
      lines.push(`| ${k} | ${lats.length} | ${fmtDuration(mean)} | ${fmtDuration(Math.min(...lats))} | ${fmtDuration(Math.max(...lats))} |`);
    }
    lines.push("");
  }

  // === Filtered entries ===
  let filtered = events.filter((e) => args.filter.includes(e.outcome));
  if (args.since) {
    filtered = filtered.filter((e) => e.ts && e.ts >= args.since);
  }

  lines.push(`## Entries (${filtered.length} de ${total} eventos)`);
  lines.push("");

  if (filtered.length === 0) {
    lines.push("_Nenhum evento bate com o filtro._");
    lines.push("");
  }

  for (let i = 0; i < filtered.length; i++) {
    const e = filtered[i];
    lines.push(`### #${i + 1} — \`${e.outcome}\` @ \`${e.ts ?? "?"}\``);
    lines.push("");
    lines.push("| field | value |");
    lines.push("|---|---|");
    lines.push(`| user_id | \`${e.user_id ?? "?"}\` |`);
    lines.push(`| step | \`${e.step ?? "?"}\` |`);
    lines.push(`| model | \`${e.model ?? "?"}\` |`);
    lines.push(`| provider | \`${e.provider ?? "?"}\` |`);
    lines.push(`| latency | ${fmtDuration(e.latency_ms)} |`);
    lines.push(`| tokens | ${fmtTokens(e.tokens)} |`);
    lines.push(`| cost_usd_est | ${fmtCost(e.cost_usd_est)} |`);
    lines.push(`| seq | ${e.seq ?? "?"} (scope=\`${e.scope_id ?? "?"}\`) |`);
    if (e.error_class) lines.push(`| error_class | \`${e.error_class}\` |`);
    lines.push("");

    // Response (sempre que disponível)
    const response = e.response_hash ? readBlob(ndjsonPath, e.response_hash, args.maxContent) : null;
    if (response) {
      lines.push(`**Response (\`${e.response_hash.slice(0, 19)}…\`):**`);
      lines.push("");
      lines.push("```");
      lines.push(response);
      lines.push("```");
      lines.push("");
    } else if (e.response_hash) {
      lines.push(`**Response:** _blob não encontrado (${e.response_hash})_`);
      lines.push("");
    } else {
      lines.push(`**Response:** _não capturado_ (debug-logger gap pré-motor#96, OU LLM não respondeu)`);
      lines.push("");
    }

    // Prompt (opt-in pq é grande — ~30k chars cada)
    if (args.includePrompt) {
      const prompt = e.prompt_hash ? readBlob(ndjsonPath, e.prompt_hash, args.maxContent) : null;
      if (prompt) {
        lines.push(`**Prompt (\`${e.prompt_hash.slice(0, 19)}…\`):**`);
        lines.push("");
        lines.push("```");
        lines.push(prompt);
        lines.push("```");
        lines.push("");
      } else if (e.prompt_hash) {
        lines.push(`**Prompt:** _blob não encontrado (${e.prompt_hash})_`);
        lines.push("");
      } else {
        lines.push(`**Prompt:** _não capturado_`);
        lines.push("");
      }
    }

    lines.push("---");
    lines.push("");
  }

  // === Footer ===
  lines.push("_Gerado por `scripts/dossier-debug-events.mjs`._");

  return lines.join("\n");
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let ndjsonPath = args.ndjsonPath;
  if (args.autoFind || !ndjsonPath) {
    ndjsonPath = findLatestNdjson();
    if (!ndjsonPath) {
      console.error("Nenhum events.ndjson encontrado. Especifique path ou rode debug primeiro.");
      process.exit(2);
    }
    console.error(`Auto-find: ${ndjsonPath}`);
  }

  const events = readEvents(ndjsonPath);
  console.error(`Read ${events.length} events from ${ndjsonPath}`);

  const md = renderDossier(args, events, ndjsonPath);

  if (args.output) {
    writeFileSync(args.output, md, "utf-8");
    console.error(`Saved to ${args.output}`);
  } else {
    console.log(md);
  }
}

main().catch((err) => {
  console.error("dossier: fatal", err);
  process.exit(1);
});
