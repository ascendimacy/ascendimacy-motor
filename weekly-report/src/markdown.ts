/**
 * Renderiza WeeklyReportData em markdown pt-BR legível.
 * Zero dependência externa, testável por regex/asserção de conteúdo.
 */

import type {
  WeeklyReportData,
  StatusComparison,
  IgnitionEvent,
  CardSummary,
  EmittedCardSummary,
  JointSessionSummary,
  AspirationSignal,
} from "./types.js";

const TREND_EMOJI: Record<StatusComparison["trend"], string> = {
  improved: "↑",
  worsened: "↓",
  stable: "→",
  new: "✨",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function renderHeader(data: WeeklyReportData): string {
  const ageStr = data.child_age !== null ? `${data.child_age}a` : "idade ?";
  return [
    `# Semana de ${data.child_name} (${ageStr})`,
    ``,
    `**Período:** ${formatDate(data.week.from)} → ${formatDate(data.week.to)}`,
    ``,
  ].join("\n");
}

function renderProgram(data: WeeklyReportData): string {
  const p = data.program_status;
  if (p.current_week === null) {
    return `## Programa Dual Helix\n\nPrograma não iniciado.\n`;
  }
  const pauseLine = p.paused ? ` — **pausado** (${p.paused_reason ?? "sem motivo registrado"})` : "";
  return [
    `## Programa Dual Helix`,
    ``,
    `Semana ${p.current_week}/5 · fase: ${p.current_phase ?? "—"}${pauseLine}`,
    ``,
  ].join("\n");
}

function renderCards(cards: CardSummary[]): string {
  if (cards.length === 0) return `## Cards recebidos\n\nNenhum card nesta semana.\n`;
  const lines = [
    `## Cards recebidos (${cards.length})`,
    ``,
    `| # | Conteúdo | Tipo | Domínio | CASEL | Gardner | Sacrifice |`,
    `|---|---|---|---|---|---|---|`,
  ];
  cards.slice(0, 10).forEach((c, i) => {
    lines.push(
      `| ${i + 1} | ${c.content_id} | ${c.content_type} | ${c.domain} | ${c.casel_targets.join(",") || "—"} | ${c.gardner_channels.join(",") || "—"} | ${c.sacrifice_spent} |`,
    );
  });
  if (cards.length > 10) lines.push(`\n*(+${cards.length - 10} outros omitidos)*`);
  lines.push("");
  return lines.join("\n");
}

function renderStatus(sc: StatusComparison[]): string {
  if (sc.length === 0)
    return `## Status matriz (vs semana anterior)\n\nSem dados de comparação.\n`;
  const lines = [
    `## Status matriz (vs semana anterior)`,
    ``,
    `| Dimensão | Antes | Agora | Tendência |`,
    `|---|---|---|---|`,
  ];
  for (const row of sc) {
    lines.push(
      `| ${row.dimension} | ${row.previous ?? "—"} | ${row.current} | ${TREND_EMOJI[row.trend]} ${row.trend} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderIgnitions(igs: IgnitionEvent[]): string {
  const ignited = igs.filter((i) => i.ignited);
  if (ignited.length === 0) {
    return `## Combinações Helix que acenderam\n\nNenhuma ignição (≥3 canais Gardner × ≥2 CASEL) nesta semana.\n`;
  }
  const lines = [
    `## Combinações Helix que acenderam (${ignited.length})`,
    ``,
    `> Ignição = ≥3 canais Gardner × ≥2 dimensões CASEL simultâneos no mesmo turn.`,
    ``,
  ];
  for (const ig of ignited.slice(0, 8)) {
    lines.push(
      `- Turn ${ig.turn} (${ig.session_id.slice(0, 12)}): ${ig.gardner_channels.join(" × ")} / ${ig.casel_dimensions.join(" + ")}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderAspirations(aps: AspirationSignal[]): string {
  if (aps.length === 0)
    return `## Sinais de aspiração emergente\n\nSem temas recorrentes (threshold: 3+ ocorrências).\n`;
  const lines = [
    `## Sinais de aspiração emergente`,
    ``,
    `> Temas que repetiram ≥3 vezes. Não são "aspiração" ainda — são sinais a observar.`,
    ``,
  ];
  for (const a of aps) {
    lines.push(
      `- **${a.key}** — ${a.occurrences}x (turns ${a.first_seen_turn}–${a.last_seen_turn}; ex: ${a.contexts.slice(0, 3).join(", ")})`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderMetrics(data: WeeklyReportData): string {
  const m = data.metrics;
  const ratio =
    m.off_on_screen_ratio.ratio === Infinity
      ? "∞ (tudo off-screen)"
      : m.off_on_screen_ratio.ratio.toFixed(2);
  return [
    `## Métricas operacionais`,
    ``,
    `| Métrica | Valor |`,
    `|---|---|`,
    `| Turns totais | ${m.total_turns} |`,
    `| Sessões | ${m.total_sessions} |`,
    `| Ratio off:on screen | ${ratio} (${m.off_on_screen_ratio.off} off / ${m.off_on_screen_ratio.on} on) |`,
    `| Sessões c/ brejo | ${m.sessions_in_brejo} |`,
    `| Frequência de pausa do programa | ${(m.program_pause_frequency * 100).toFixed(0)}% |`,
    `| Milestones faltantes (acumulado) | ${m.missed_milestones_total} |`,
    `| Sacrifice médio/turn | ${m.avg_sacrifice_per_turn.toFixed(2)} |`,
    `| Tempo de tela (s) | ${m.total_screen_seconds} |`,
    ``,
  ].join("\n");
}

function renderEmittedCards(ems: EmittedCardSummary[] | undefined): string {
  const list = ems ?? [];
  if (list.length === 0) {
    return `## 🏆 Cartas recebidas\n\nNenhuma carta emitida nesta semana.\n`;
  }
  const lines = [`## 🏆 Cartas recebidas (${list.length})`, ``];
  for (const c of list) {
    lines.push(`### ${c.title} · ${c.rarity.toUpperCase()}`);
    lines.push(``);
    lines.push(`![${c.title}](${c.image_url})`);
    lines.push(``);
    lines.push(`> ${c.narrative}`);
    lines.push(``);
    lines.push(`**Verso:** ${c.gardner_channel_icon} · ${c.casel_dimension} · serial \`${c.serial_number}\``);
    lines.push(``);
    lines.push(`**Cheat code:** \`${c.cheat_code}\``);
    lines.push(``);
    lines.push(`[QR / verificar autenticidade](${c.qr_payload})`);
    lines.push(``);
  }
  return lines.join("\n");
}

function renderJointSessions(
  sessions: JointSessionSummary[] | undefined,
  trend: number | null | undefined,
): string {
  const list = sessions ?? [];
  if (list.length === 0) {
    return `## 👥 Dinâmicas conjuntas\n\nNenhuma sessão joint nesta semana.\n`;
  }
  const lines = [`## 👥 Dinâmicas conjuntas (${list.length})`, ``];
  const trendStr =
    typeof trend === "number"
      ? ` (tendência vs semana anterior: ${trend >= 0 ? "+" : ""}${trend.toFixed(2)})`
      : "";
  lines.push(`> Trust médio do dyad${trendStr}.`);
  lines.push("");
  lines.push(`| Sessão | Parceiro | Turns | Engagement médio | Flags de bullying |`);
  lines.push(`|---|---|---|---|---|`);
  for (const s of list) {
    const flags = Object.entries(s.bullying_flags_count)
      .map(([k, v]) => `${k}:${v}`)
      .join(", ") || "—";
    const partnerLabel = s.partner_name ?? s.partner_child_id;
    lines.push(
      `| \`${s.session_id.slice(0, 12)}\` | ${partnerLabel} | ${s.turns_count} | ${s.avg_engagement_score.toFixed(2)} | ${flags} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function renderMarkdown(data: WeeklyReportData): string {
  return [
    renderHeader(data),
    renderProgram(data),
    renderEmittedCards(data.emitted_cards),
    renderCards(data.cards),
    renderJointSessions(data.joint_sessions, data.dyad_trust_trend),
    renderStatus(data.status_comparison),
    renderIgnitions(data.ignitions),
    renderAspirations(data.aspirations),
    renderMetrics(data),
    `---\n\n> 🌳 Crescer para colher.\n`,
  ].join("\n");
}
