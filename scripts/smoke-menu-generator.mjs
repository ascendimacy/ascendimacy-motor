#!/usr/bin/env node
/**
 * Smoke test — generateActionMenu contra Infomaniak Kimi K2.5 real.
 *
 * **Gate de aceite da PR motor#88 (H-AC-02).** Roda manualmente por Jun
 * antes de mergear; CC não executa esse script autonomamente porque
 * (a) custa LLM real, (b) requer credenciais Infomaniak.
 *
 * Critério: ≥90% items rotulados com `played_as` válido (enum
 * bridge / espelho / canal / diamante / arena / recovery).
 *
 * Como rodar:
 *   1. Garantir build atual: `npm run build`
 *   2. Garantir credenciais Infomaniak exportadas:
 *        export INFOMANIAK_API_KEY=...
 *        export INFOMANIAK_PRODUCT_ID=...
 *      (ver `shared/src/llm-router.ts` para outras envs específicas)
 *   3. Rodar:  `node scripts/smoke-menu-generator.mjs [ryo|kei|both]`
 *      Default: both
 *
 * Output:
 *   - Imprime menu gerado + distribuição (jogada x count, intensity x count)
 *   - Calcula pct_labeled; falha se < 90%
 *   - Salva menu em fixtures/profiles/{persona_id}-menu.json (escolha de Jun)
 *
 * Refs: motor#88, ops#993, ops#991.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Import via build output (built TypeScript).
const { generateActionMenu } = await import(
  path.join(REPO_ROOT, "motor-drota", "dist", "menu-generator.js")
);
const { RYO_HINT, KEI_HINT } = await import(
  path.join(REPO_ROOT, "motor-drota", "dist", "persona-hints.js")
);

const PERSONAS = {
  ryo: {
    personaId: "ryo-ochiai",
    trustLevel: 0.42,
    fixture: "ryo-ochiai.pre-phase2.json",
    hint: RYO_HINT,
  },
  kei: {
    personaId: "kei-ochiai",
    trustLevel: 0.5,
    fixture: "kei-ochiai.pre-phase2.json",
    hint: KEI_HINT,
  },
};

function loadProfile(fixtureName) {
  const p = path.join(REPO_ROOT, "fixtures", "profiles", fixtureName);
  return JSON.parse(readFileSync(p, "utf-8"));
}

function summarize(menu, personaId) {
  if (!menu) {
    console.log(`[${personaId}] FALHA: generator retornou null.`);
    return { ok: false };
  }
  const total = menu.items.length;
  const labeled = menu.items.filter((it) => it.played_as != null).length;
  const pct = total > 0 ? (labeled / total) * 100 : 0;

  const distPlayed = new Map();
  const distIntensity = new Map();
  let criticals = 0;
  for (const it of menu.items) {
    const k = it.played_as ?? "(unlabeled)";
    distPlayed.set(k, (distPlayed.get(k) ?? 0) + 1);
    const i = it.intensity ?? "(none)";
    distIntensity.set(i, (distIntensity.get(i) ?? 0) + 1);
    if (it.is_critical) criticals++;
  }

  console.log(`\n=== ${personaId} ===`);
  console.log(`Total items: ${total}`);
  console.log(`Items rotulados (played_as): ${labeled} / ${total} (${pct.toFixed(1)}%)`);
  console.log(`Distribuição played_as:`);
  for (const [k, v] of [...distPlayed.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`Distribuição intensity:`);
  for (const [k, v] of [...distIntensity.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`is_critical: ${criticals}`);
  console.log(`schema_version: ${menu.schema_version}`);

  const passes = pct >= 90;
  console.log(`Gate ≥90% rotulado: ${passes ? "PASS" : "FAIL"}`);
  return { ok: passes, pct, labeled, total };
}

async function runPersona(key) {
  const { personaId, trustLevel, fixture, hint } = PERSONAS[key];
  console.log(`\n[${personaId}] Carregando fixture ${fixture}…`);
  const profile = loadProfile(fixture);

  const warnings = [];
  console.log(`[${personaId}] Chamando generateActionMenu (LLM real)…`);
  const t0 = Date.now();
  const menu = await generateActionMenu(
    { personaId, trustLevel, profile, personaHint: hint },
    {
      onWarning: (w) => {
        warnings.push(`${w.code}: ${w.message}`);
        console.warn(`[${personaId}] WARN: ${w.code}: ${w.message}`);
      },
    },
  );
  const elapsedMs = Date.now() - t0;
  console.log(`[${personaId}] Latência: ${elapsedMs} ms`);
  if (warnings.length) {
    console.log(`[${personaId}] Warnings emitidos: ${warnings.length}`);
  }

  const summary = summarize(menu, personaId);

  if (menu) {
    const outPath = path.join(REPO_ROOT, "fixtures", "profiles", `${personaId}-menu.json`);
    writeFileSync(outPath, `${JSON.stringify(menu, null, 2)}\n`, "utf-8");
    console.log(`[${personaId}] Salvo em ${path.relative(REPO_ROOT, outPath)}`);
  }

  return summary;
}

async function main() {
  const targetArg = process.argv[2] ?? "both";
  const targets =
    targetArg === "both" ? ["ryo", "kei"] : [targetArg];

  for (const t of targets) {
    if (!PERSONAS[t]) {
      console.error(`Unknown persona target: ${t}. Valid: ryo, kei, both.`);
      process.exit(2);
    }
  }

  const results = [];
  for (const t of targets) {
    results.push(await runPersona(t));
  }

  console.log("\n=== Resumo geral ===");
  for (let i = 0; i < targets.length; i++) {
    const r = results[i];
    console.log(
      `${targets[i]}: ${r.ok ? "PASS" : "FAIL"} ` +
        `(${r.labeled}/${r.total} = ${r.pct?.toFixed(1) ?? "-"}%)`,
    );
  }

  const allPass = results.every((r) => r.ok);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
