/**
 * Variância report — renderiza markdown agregado p/ H-AC-12.
 *
 * Spec ratificada v1 (ops#1058 §5.2): comment em PR (trigger-por-mudança)
 * ou em ops#1058 (scheduled semanal). NÃO commitar em docs/measurements/.
 */

import type { PlayedAs } from "@ascendimacy/shared";

import {
  computeCostStats,
  computeDistAlignment,
  computeKpis,
  observedDistribution,
  normalizeDistribution,
  passesV0Thresholds,
  type RunResult,
} from "./kpis.js";

/** Spec de uma célula (modelo × persona) no relatório. */
export interface CellInput {
  model: string;
  modelLabel: string;            // ex: "Kimi K2.5"
  personaId: string;
  personaLabel: string;          // ex: "Ryo (deflective)"
  personaHintBias: ReadonlyArray<{ played_as: PlayedAs; weight: number }>;
  runs: ReadonlyArray<RunResult>;
}

/** Configuração de rendering. */
export interface ReportConfig {
  promptVersion: string;          // ex: "v0.1" (motor#90)
  mode: "quick" | "full" | "manual";
  timestamp: string;              // ISO 8601 do início da execução
  runId: string;                  // ex: "hac12-2026-05-20T03-00-00"
  cells: ReadonlyArray<CellInput>;
}

const PLAYED_AS_KEYS: ReadonlyArray<PlayedAs> = [
  "bridge",
  "espelho",
  "canal",
  "diamante",
  "arena",
  "recovery",
];

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function top2(dist: Record<PlayedAs, number>): string {
  const sorted = [...PLAYED_AS_KEYS].sort((a, b) => dist[b] - dist[a]);
  return sorted.slice(0, 2).join(", ");
}

function passEmoji(ok: boolean): string {
  return ok ? "PASS" : "FAIL";
}

/**
 * Renderiza markdown completo do relatório, ready pra ser passado pra
 * `gh pr comment --body-file` ou `gh issue comment --body-file`.
 */
export function renderReport(config: ReportConfig): string {
  const date = config.timestamp.split("T")[0];
  const lines: string[] = [];

  lines.push(`# H-AC-12 — Variância de geração — ${date}`);
  lines.push("");
  lines.push(
    `**Mode:** \`${config.mode}\` | **Prompt:** \`${config.promptVersion}\` | ` +
      `**Run:** \`${config.runId}\``,
  );
  lines.push("");

  // === Resumo (tabela principal) ===
  lines.push("## Resumo");
  lines.push("");
  lines.push(
    "| Modelo | Persona | N | pass_first | recovery | degraded | error | dist_align | Pass? |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|");

  let allPass = true;
  const cellResults: Array<{
    cell: CellInput;
    kpis: ReturnType<typeof computeKpis>;
    distAlignment: number;
    pass: ReturnType<typeof passesV0Thresholds>;
    cost: ReturnType<typeof computeCostStats>;
  }> = [];

  for (const cell of config.cells) {
    const kpis = computeKpis(cell.runs);
    const distAlignment = computeDistAlignment(cell.runs, cell.personaHintBias);
    const pass = passesV0Thresholds(kpis, distAlignment);
    const cost = computeCostStats(cell.runs);
    cellResults.push({ cell, kpis, distAlignment, pass, cost });
    if (!pass.ok) allPass = false;

    lines.push(
      `| ${cell.modelLabel} | ${cell.personaLabel} | ${kpis.total} | ` +
        `${pct(kpis.passRateFirst)} | ${pct(kpis.recoveryRate)} | ` +
        `${pct(kpis.degradationRate)} | ${pct(kpis.errorRate)} | ` +
        `${distAlignment.toFixed(2)} | ${passEmoji(pass.ok)} |`,
    );
  }

  lines.push("");
  lines.push(
    `**Resultado global:** ${allPass ? "PASS — todos os limiares v0 atendidos" : "FAIL — pelo menos uma célula reprovou (detalhes abaixo)"}`,
  );
  lines.push("");

  // === Distribuição played_as por célula ===
  lines.push("## Distribuição played_as (realizada × esperada)");
  lines.push("");
  for (const { cell } of cellResults) {
    const observed = normalizeDistribution(observedDistribution(cell.runs));
    const expectedMap: Record<PlayedAs, number> = {
      bridge: 0,
      espelho: 0,
      canal: 0,
      diamante: 0,
      arena: 0,
      recovery: 0,
    };
    for (const b of cell.personaHintBias) expectedMap[b.played_as] = b.weight;
    const expected = normalizeDistribution(expectedMap);

    lines.push(`### ${cell.modelLabel} × ${cell.personaLabel}`);
    lines.push("");
    lines.push("| jogada | realizada | esperada (hint) | Δ |");
    lines.push("|---|---|---|---|");
    for (const k of PLAYED_AS_KEYS) {
      const delta = observed[k] - expected[k];
      const sign = delta >= 0 ? "+" : "";
      lines.push(`| ${k} | ${pct(observed[k])} | ${pct(expected[k])} | ${sign}${(delta * 100).toFixed(0)}pp |`);
    }
    lines.push("");
    lines.push(`Top-2 realizado: **${top2(observed)}** vs esperado: **${top2(expected)}**.`);
    lines.push("");
  }

  // === Sinais acionáveis (só aparecem se algum KPI falha) ===
  const actionable = cellResults.filter((r) => !r.pass.ok);
  if (actionable.length > 0) {
    lines.push("## Sinais acionáveis");
    lines.push("");
    for (const r of actionable) {
      lines.push(`### ${r.cell.modelLabel} × ${r.cell.personaLabel} — FAIL`);
      lines.push("");
      if (!r.pass.ok) {
        for (const f of r.pass.failures) {
          lines.push(`- ${f}`);
        }
      }
      lines.push("");
    }
  }

  // === Custo + latência ===
  lines.push("## Custo + latência");
  lines.push("");
  lines.push(
    "| Modelo | Persona | total $ | $/run | mean latency | mean tokens (in/out) |",
  );
  lines.push("|---|---|---|---|---|---|");
  let totalCost = 0;
  for (const { cell, cost } of cellResults) {
    totalCost += cost.totalUsd;
    lines.push(
      `| ${cell.modelLabel} | ${cell.personaLabel} | ` +
        `$${cost.totalUsd.toFixed(3)} | $${cost.meanUsdPerRun.toFixed(4)} | ` +
        `${(cost.meanLatencyMs / 1000).toFixed(1)}s | ` +
        `${Math.round(cost.meanTokensIn)}/${Math.round(cost.meanTokensOut)} |`,
    );
  }
  lines.push("");
  lines.push(`**Total execução:** $${totalCost.toFixed(2)}`);
  lines.push("");

  // === Footer ===
  lines.push("---");
  lines.push(
    `_Gerado por \`scripts/measure-menu-variance.mjs\` em \`${config.timestamp}\` — spec H-AC-12 ratificada v1 (ops#1058)._`,
  );

  return lines.join("\n");
}
