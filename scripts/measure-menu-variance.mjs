#!/usr/bin/env node
/**
 * measure-menu-variance — H-AC-12 (spec ratificada v1, ops#1058).
 *
 * Roda N execuções de `generateActionMenu` por (modelo × persona), agrega
 * em KPIs longitudinais + dist_alignment KL, e emite markdown report.
 *
 * Modes:
 *   --quick      N=10, só Kimi K2.5 (pre-merge gate, GitHub-hosted runner)
 *   --full       N=30, Kimi + Qwen3-30B local (scheduled semanal, self-hosted runner)
 *   --manual     N customizável, modelo + persona específicos
 *
 * Flags principais:
 *   --n <N>                     tamanho de amostra (default depende do mode)
 *   --persona <ryo|kei|both>    default: both
 *   --model <kimi|qwen3|both>   default: depende do mode
 *   --comment-on <pr|issue>#N   posta markdown como comment via gh CLI
 *   --output <path>             salva markdown em arquivo (default: stdout only)
 *   --prompt-version <vX.Y>     metadata pro report (default v0.1)
 *
 * Exit code:
 *   0 — todos os limiares v0 passaram (PASS)
 *   1 — algum limiar reprovou (FAIL) OU erro de execução
 *
 * Spec: ascendimacy-ops/docs/specs/H-AC-12-variancia-geracao-v0.md
 * Issue: ascendimacy-ops#1058
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Imports do build output do motor-drota (postbuild copia prompts/).
const { generateActionMenu } = await import(
  path.join(REPO_ROOT, "motor-drota", "dist", "menu-generator.js")
);
const { RYO_HINT, KEI_HINT } = await import(
  path.join(REPO_ROOT, "motor-drota", "dist", "persona-hints.js")
);
const variance = await import(
  path.join(REPO_ROOT, "motor-drota", "dist", "variance", "index.js")
);

// ============================================================================
// Args parsing
// ============================================================================

function parseArgs(argv) {
  const args = {
    mode: null,
    n: null,
    persona: "both",
    model: null,
    commentOn: null,
    output: null,
    promptVersion: "v0.1",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--quick": args.mode = "quick"; break;
      case "--full":  args.mode = "full"; break;
      case "--manual": args.mode = "manual"; break;
      case "--n": args.n = Number.parseInt(argv[++i], 10); break;
      case "--persona": args.persona = argv[++i]; break;
      case "--model": args.model = argv[++i]; break;
      case "--comment-on": args.commentOn = argv[++i]; break;
      case "--output": args.output = argv[++i]; break;
      case "--prompt-version": args.promptVersion = argv[++i]; break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }
  if (!args.mode) {
    console.error("Erro: especifique --quick, --full ou --manual.");
    printHelp();
    process.exit(2);
  }
  // Defaults por modo
  if (args.n == null) {
    args.n = args.mode === "quick" ? 10 : args.mode === "full" ? 30 : 30;
  }
  if (!args.model) {
    args.model =
      args.mode === "quick" ? "kimi" :
      args.mode === "full" ? "both" : "kimi";
  }
  return args;
}

function printHelp() {
  console.log(`
Usage: node scripts/measure-menu-variance.mjs <mode> [options]

Modes:
  --quick                   N=10, Kimi only (pre-merge gate)
  --full                    N=30, Kimi + Qwen3-30B (scheduled semanal)
  --manual                  N customizável

Options:
  --n <N>                   tamanho de amostra
  --persona <ryo|kei|both>  default: both
  --model <kimi|qwen3|both> default: depende do mode
  --comment-on <ref>        posta comment via gh CLI; ex: "ops#1058" ou "motor#42"
  --output <path>           salva markdown em arquivo (além do stdout)
  --prompt-version <vX.Y>   default: v0.1
  -h, --help                este help

Spec: ascendimacy-ops/docs/specs/H-AC-12-variancia-geracao-v0.md
`);
}

// ============================================================================
// LLM call adapters (Kimi via gateway, Qwen3 via local HTTP)
// ============================================================================

async function loadKimiLlmCall() {
  // Importa direto da build do motor-drota — gateway client + step="drota"
  const { callLlm } = await import(
    path.join(REPO_ROOT, "motor-drota", "dist", "llm-client.js")
  );
  return callLlm; // (system, user) => Promise<LlmCallResult>
}

function makeQwen3LocalLlmCall() {
  const endpoint =
    process.env.LLM_LOCAL_ENDPOINT ??
    "http://172.28.160.1:9000/v1/chat/completions";
  const model = process.env.LLM_LOCAL_MODEL ?? "qwen3-30b";
  return async (systemPrompt, userMessage) => {
    const body = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 3000,
      temperature: 0.7,
    };
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    });
    if (!resp.ok) throw new Error(`LLM local HTTP ${resp.status}`);
    const json = await resp.json();
    return {
      content: json.choices[0].message.content,
      tokens: {
        in: json.usage?.prompt_tokens ?? 0,
        out: json.usage?.completion_tokens ?? 0,
        reasoning: 0,
      },
      provider: "openai-compat",
      model,
    };
  };
}

// ============================================================================
// Run loop
// ============================================================================

function loadProfile(fixtureName) {
  const p = path.join(REPO_ROOT, "fixtures", "profiles", fixtureName);
  return JSON.parse(readFileSync(p, "utf-8"));
}

const PERSONAS = {
  ryo: {
    personaId: "ryo-ochiai",
    personaLabel: "Ryo (deflective)",
    trustLevel: 0.42,
    fixture: "ryo-ochiai.pre-phase2.json",
    hint: RYO_HINT,
  },
  kei: {
    personaId: "kei-ochiai",
    personaLabel: "Kei (philosophical)",
    trustLevel: 0.5,
    fixture: "kei-ochiai.pre-phase2.json",
    hint: KEI_HINT,
  },
};

async function runOnce(personaSpec, llmCall) {
  const warnings = [];
  const t0 = Date.now();
  let lastCallTokens = { in: 0, out: 0 };
  let lastCallCost = 0;
  let lastCallModel = "unknown";
  let lastCallProvider = "unknown";

  // Wrap llmCall pra capturar tokens/cost por chamada (sem confiar no NDJSON)
  const wrappedCall = async (sys, user) => {
    const r = await llmCall(sys, user);
    lastCallTokens = r.tokens;
    lastCallModel = r.model;
    lastCallProvider = r.provider;
    return r;
  };

  const menu = await generateActionMenu(
    {
      personaId: personaSpec.personaId,
      trustLevel: personaSpec.trustLevel,
      profile: loadProfile(personaSpec.fixture),
      personaHint: personaSpec.hint,
    },
    {
      llmCall: wrappedCall,
      onWarning: (w) => warnings.push(w.code),
    },
  );
  const latencyMs = Date.now() - t0;

  // Cost: para Qwen3 local sempre 0 (openai-compat); para Kimi calcular
  // via PRICING_TABLE.
  if (lastCallProvider === "openai-compat") {
    lastCallCost = 0;
  } else {
    // Lookup heurístico — sem importar shared/llm-config aqui (script .mjs);
    // assume Kimi K2.5 com preço aproximado. Reportagem é estimativa.
    if (lastCallModel.toLowerCase().includes("kimi")) {
      // Kimi K2.5: ~$0.6/M input, ~$2.5/M output (Infomaniak pricing)
      lastCallCost =
        (lastCallTokens.in * 0.0000006) + (lastCallTokens.out * 0.0000025);
    } else {
      lastCallCost = 0;
    }
  }

  return {
    menu,
    warnings,
    latencyMs,
    tokensIn: lastCallTokens.in,
    tokensOut: lastCallTokens.out,
    costUsdEst: lastCallCost,
  };
}

async function runCell(modelKey, modelLabel, personaSpec, n, llmCall) {
  console.error(`\n[${modelLabel} × ${personaSpec.personaLabel}] N=${n}…`);
  const runs = [];
  for (let i = 0; i < n; i++) {
    process.stderr.write(`  run ${i + 1}/${n}…`);
    try {
      const r = await runOnce(personaSpec, llmCall);
      runs.push(r);
      const outcome = variance.deriveOutcome(r);
      process.stderr.write(` ${outcome} (${(r.latencyMs / 1000).toFixed(1)}s)\n`);
    } catch (err) {
      console.error(` THROW: ${err.message}`);
      // Conta como error
      runs.push({
        menu: null,
        warnings: ["llm_error"],
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsdEst: 0,
      });
    }
  }
  return {
    model: modelKey,
    modelLabel,
    personaId: personaSpec.personaId,
    personaLabel: personaSpec.personaLabel,
    personaHintBias: personaSpec.hint.bias,
    runs,
  };
}

// ============================================================================
// gh CLI integration (comment posting)
// ============================================================================

function postComment(commentOnRef, markdown) {
  // Ref format: "ops#1058" ou "motor#42"
  const match = commentOnRef.match(/^(ops|motor)#(\d+)$/);
  if (!match) {
    console.error(`--comment-on: formato inválido "${commentOnRef}". Use ops#N ou motor#N.`);
    return false;
  }
  const repoMap = { ops: "ascendimacy/ascendimacy-ops", motor: "ascendimacy/ascendimacy-motor" };
  const repo = repoMap[match[1]];
  const num = match[2];

  // Tenta primeiro como issue, fallback pra PR. gh issue comment funciona em ambos.
  const tempFile = path.join(REPO_ROOT, `.tmp-hac12-comment-${Date.now()}.md`);
  writeFileSync(tempFile, markdown, "utf-8");
  const r = spawnSync(
    "gh",
    ["issue", "comment", num, "--repo", repo, "--body-file", tempFile],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try { execSync(`rm -f ${tempFile}`); } catch {}
  if (r.status === 0) {
    console.error(`\n✓ Posted comment: ${r.stdout.toString().trim()}`);
    return true;
  }
  console.error(`\n✗ Failed to post comment: ${r.stderr.toString()}`);
  return false;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const personasToRun =
    args.persona === "both" ? ["ryo", "kei"] :
    args.persona === "ryo"  ? ["ryo"] :
    args.persona === "kei"  ? ["kei"] : null;
  if (!personasToRun) {
    console.error(`--persona inválido: ${args.persona}. Use ryo, kei, ou both.`);
    process.exit(2);
  }

  const modelsToRun =
    args.model === "both"  ? ["kimi", "qwen3"] :
    args.model === "kimi"  ? ["kimi"] :
    args.model === "qwen3" ? ["qwen3"] : null;
  if (!modelsToRun) {
    console.error(`--model inválido: ${args.model}. Use kimi, qwen3, ou both.`);
    process.exit(2);
  }

  const runId = `hac12-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const timestamp = new Date().toISOString();

  console.error(`H-AC-12 — measure-menu-variance`);
  console.error(`Mode: ${args.mode} | N=${args.n} | personas: ${personasToRun} | models: ${modelsToRun}`);
  console.error(`Run ID: ${runId}\n`);

  const cells = [];
  for (const modelKey of modelsToRun) {
    let llmCall;
    let modelLabel;
    if (modelKey === "kimi") {
      modelLabel = "Kimi K2.5";
      llmCall = await loadKimiLlmCall();
    } else if (modelKey === "qwen3") {
      modelLabel = "Qwen3-30B Q4";
      llmCall = makeQwen3LocalLlmCall();
    } else {
      console.error(`Modelo desconhecido: ${modelKey}`);
      process.exit(2);
    }

    for (const personaKey of personasToRun) {
      const personaSpec = PERSONAS[personaKey];
      const cell = await runCell(modelKey, modelLabel, personaSpec, args.n, llmCall);
      cells.push(cell);
    }
  }

  // === Renderiza relatório ===
  const markdown = variance.renderReport({
    promptVersion: args.promptVersion,
    mode: args.mode,
    timestamp,
    runId,
    cells,
  });

  console.log(markdown);

  if (args.output) {
    writeFileSync(args.output, markdown, "utf-8");
    console.error(`\n✓ Saved markdown to ${args.output}`);
  }

  if (args.commentOn) {
    postComment(args.commentOn, markdown);
  }

  // Exit code: PASS=0, FAIL=1
  let allPass = true;
  for (const cell of cells) {
    const kpis = variance.computeKpis(cell.runs);
    const dist = variance.computeDistAlignment(cell.runs, cell.personaHintBias);
    const p = variance.passesV0Thresholds(kpis, dist);
    if (!p.ok) allPass = false;
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("measure-menu-variance: fatal", err);
  process.exit(1);
});
