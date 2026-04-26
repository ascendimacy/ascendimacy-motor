#!/usr/bin/env node
/**
 * debug-by-session — agrupa events.ndjson por sessão (mapeada pra day),
 * mostra prompt + reasoning + response de cada step organizadamente.
 *
 * Uso:
 *   node scripts/debug-by-session.mjs --run <run_id> [--out file.md]
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const opts = { run: null, dir: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run" && argv[i + 1]) opts.run = argv[++i];
    else if (argv[i] === "--dir" && argv[i + 1]) opts.dir = argv[++i];
    else if (argv[i] === "--out" && argv[i + 1]) opts.out = argv[++i];
  }
  return opts;
}

function getBaseDir(opts) {
  return opts.dir ?? join(process.cwd(), "logs", "debug");
}

function loadEvents(baseDir, runId) {
  const path = join(baseDir, runId, "events.ndjson");
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
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

function groupBySession(events) {
  // Sessions são session_ids distintos (ignorando null/persona-sim).
  // persona-sim events são associados à session anterior baseado em ts.
  const sessions = [];
  let currentSession = null;

  for (const e of events) {
    if (e.step === "persona-sim") {
      if (currentSession) currentSession.events.push(e);
      continue;
    }
    if (e.session_id == null) continue;
    if (!currentSession || currentSession.session_id !== e.session_id) {
      currentSession = {
        session_id: e.session_id,
        user_id: e.user_id,
        partner_user_id: e.partner_user_id,
        first_ts: e.ts,
        events: [],
      };
      sessions.push(currentSession);
    }
    currentSession.events.push(e);
  }
  return sessions;
}

function inferEventLabel(idx, total, session) {
  // Mapa heurístico de session #N → day label do smoke-3d/nagareyama.
  // Genérico baseado em ordem; usuário pode customizar via convenção.
  return `Sessão ${idx + 1}/${total} (${session.user_id}${session.partner_user_id ? "+" + session.partner_user_id : ""})`;
}

function fmtSnapshot(snap, max = 800) {
  if (!snap) return "(none)";
  try {
    const obj = JSON.parse(snap);
    const pretty = JSON.stringify(obj, null, 2);
    if (pretty.length <= max) return pretty;
    return pretty.slice(0, max) + "\n... [truncated]";
  } catch {
    return snap.slice(0, max);
  }
}

function fmtContent(s, max) {
  if (!s) return "(none)";
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... [truncated, +${s.length - max} chars]`;
}

function renderSession(session, idx, total, baseDir, runId) {
  const lines = [];
  lines.push(`\n## ${inferEventLabel(idx, total, session)}`);
  lines.push(`\n**Session ID**: \`${session.session_id.slice(0, 12)}...\``);
  lines.push(`**Started**: ${session.first_ts}`);
  lines.push(`**Events**: ${session.events.length}`);

  // Group by turn_number
  const turns = {};
  for (const e of session.events) {
    const t = e.turn_number ?? 0;
    if (!turns[t]) turns[t] = [];
    turns[t].push(e);
  }

  for (const turnKey of Object.keys(turns).sort((a, b) => Number(a) - Number(b))) {
    const turnEvents = turns[turnKey];
    lines.push(`\n### Turn ${turnKey}`);
    // Order: planejador → drota → auto-hook → persona-sim
    const order = ["planejador", "drota", "auto-hook", "persona-sim"];
    const sorted = [...turnEvents].sort((a, b) => {
      const ai = order.indexOf(a.step);
      const bi = order.indexOf(b.step);
      if (ai === bi) return a.ts.localeCompare(b.ts);
      return ai - bi;
    });

    for (const e of sorted) {
      const tsShort = e.ts.slice(11, 23);
      const tokTag = e.tokens
        ? `${e.tokens.in}+${e.tokens.out} tok`
        : "no LLM";
      const latTag = e.latency_ms != null ? `${e.latency_ms}ms` : "";
      const modelTag = e.model ? ` [${e.model}]` : "";
      lines.push(`\n#### \`${e.step}\` — ${tsShort} (${latTag}, ${tokTag})${modelTag}`);
      if (e.outcome !== "ok") lines.push(`*outcome: ${e.outcome}${e.error_class ? " — " + e.error_class : ""}*`);

      // Snapshots PRE
      if (e.snapshots_pre) {
        for (const [engine, hash] of Object.entries(e.snapshots_pre)) {
          if (hash) {
            const snap = loadBlob(baseDir, runId, hash, "snapshots");
            lines.push(`\n<details><summary>📸 snapshot.${engine}.PRE</summary>\n\n\`\`\`json\n${fmtSnapshot(snap, 1500)}\n\`\`\`\n</details>`);
          }
        }
      }

      // Prompt
      if (e.prompt_hash) {
        const prompt = loadBlob(baseDir, runId, e.prompt_hash, "content");
        lines.push(`\n<details><summary>📝 PROMPT (${prompt?.length ?? 0} chars)</summary>\n\n\`\`\`\n${fmtContent(prompt, 4000)}\n\`\`\`\n</details>`);
      }

      // Reasoning
      if (e.reasoning_hash) {
        const reasoning = loadBlob(baseDir, runId, e.reasoning_hash, "content");
        lines.push(`\n<details><summary>🧠 REASONING (${reasoning?.length ?? 0} chars)</summary>\n\n\`\`\`\n${fmtContent(reasoning, 4000)}\n\`\`\`\n</details>`);
      }

      // Response
      if (e.response_hash) {
        const response = loadBlob(baseDir, runId, e.response_hash, "content");
        lines.push(`\n**RESPONSE**:\n\n\`\`\`\n${fmtContent(response, 2000)}\n\`\`\``);
      }

      // Snapshots POST
      if (e.snapshots_post) {
        for (const [engine, hash] of Object.entries(e.snapshots_post)) {
          if (hash) {
            const snap = loadBlob(baseDir, runId, hash, "snapshots");
            lines.push(`\n<details><summary>📸 snapshot.${engine}.POST</summary>\n\n\`\`\`json\n${fmtSnapshot(snap, 1500)}\n\`\`\`\n</details>`);
          }
        }
      }
    }
  }

  return lines.join("\n");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.run) {
    console.error("Usage: --run <run_id> [--dir path] [--out file.md]");
    process.exit(1);
  }
  const baseDir = getBaseDir(opts);
  const events = loadEvents(baseDir, opts.run);
  events.sort((a, b) => a.ts.localeCompare(b.ts));
  const sessions = groupBySession(events);

  const out = [];
  out.push(`# Debug por Sessão — \`${opts.run}\``);
  out.push(`\n**Total events**: ${events.length}`);
  out.push(`**Sessions**: ${sessions.length}`);
  out.push(`**Steps**: ${[...new Set(events.map((e) => e.step))].join(", ")}`);
  out.push(`\n---\n`);
  // ToC
  out.push(`## Sumário\n`);
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    out.push(`- [Sessão ${i + 1}](#sessão-${i + 1}${s.partner_user_id ? "" : ""}) — ${s.user_id}${s.partner_user_id ? "+" + s.partner_user_id : ""} (${s.events.length} events)`);
  }
  out.push(`\n---`);

  for (let i = 0; i < sessions.length; i++) {
    out.push(renderSession(sessions[i], i, sessions.length, baseDir, opts.run));
  }

  const result = out.join("\n");
  if (opts.out) {
    writeFileSync(opts.out, result);
    console.log(`Written: ${opts.out} (${result.length} chars, ${result.split("\n").length} lines)`);
  } else {
    console.log(result);
  }
}

main();
