/**
 * PDF renderer — pdfkit. Gera documento estruturado do WeeklyReportData.
 *
 * API retorna Buffer (ou Promise<Buffer>) — sem I/O de disco aqui.
 * Caller decide onde escrever (ou envia por email/WhatsApp).
 */

import PDFDocument from "pdfkit";
import type {
  WeeklyReportData,
  StatusComparison,
  CardSummary,
  IgnitionEvent,
  AspirationSignal,
} from "./types.js";

interface PdfOptions {
  /** Default 'A4'. */
  size?: string;
  /** Default 40 (pontos, ~14mm). */
  margin?: number;
}

const TREND_SYMBOL: Record<StatusComparison["trend"], string> = {
  improved: "↑ melhorou",
  worsened: "↓ piorou",
  stable: "→ estável",
  new: "✨ novo",
};

function writeHeader(doc: PDFKit.PDFDocument, data: WeeklyReportData): void {
  const ageStr = data.child_age !== null ? `${data.child_age} anos` : "idade ?";
  doc.fontSize(20).text(`Semana de ${data.child_name}`, { align: "left" });
  doc.fontSize(10).fillColor("#555").text(ageStr);
  doc
    .moveDown(0.3)
    .text(`Período: ${data.week.from.slice(0, 10)} → ${data.week.to.slice(0, 10)}`);
  doc.fillColor("black").moveDown(1);
}

function writeProgram(doc: PDFKit.PDFDocument, data: WeeklyReportData): void {
  doc.fontSize(14).text("Programa Dual Helix");
  doc.fontSize(10).moveDown(0.2);
  const p = data.program_status;
  if (p.current_week === null) {
    doc.text("Programa não iniciado.");
  } else {
    const pauseNote = p.paused
      ? ` — pausado (${p.paused_reason ?? "sem motivo"})`
      : "";
    doc.text(`Semana ${p.current_week}/5 · fase: ${p.current_phase ?? "—"}${pauseNote}`);
  }
  doc.moveDown(1);
}

function writeCards(doc: PDFKit.PDFDocument, cards: CardSummary[]): void {
  doc.fontSize(14).text(`Cards recebidos (${cards.length})`);
  doc.fontSize(9).moveDown(0.2);
  if (cards.length === 0) {
    doc.text("Nenhum card nesta semana.");
  } else {
    for (const c of cards.slice(0, 12)) {
      const line = `• ${c.content_id} [${c.content_type}] dom:${c.domain} CASEL:${c.casel_targets.join(",") || "—"} Gardner:${c.gardner_channels.join(",") || "—"} sac:${c.sacrifice_spent}`;
      doc.text(line);
    }
    if (cards.length > 12) doc.text(`… +${cards.length - 12} outros`);
  }
  doc.moveDown(1);
}

function writeStatus(doc: PDFKit.PDFDocument, sc: StatusComparison[]): void {
  doc.fontSize(14).text("Status matriz (vs semana anterior)");
  doc.fontSize(9).moveDown(0.2);
  if (sc.length === 0) {
    doc.text("Sem dados de comparação.");
  } else {
    for (const row of sc) {
      doc.text(
        `• ${row.dimension}: ${row.previous ?? "—"} → ${row.current} (${TREND_SYMBOL[row.trend]})`,
      );
    }
  }
  doc.moveDown(1);
}

function writeIgnitions(doc: PDFKit.PDFDocument, igs: IgnitionEvent[]): void {
  const ignited = igs.filter((i) => i.ignited);
  doc.fontSize(14).text(`Combinações Helix que acenderam (${ignited.length})`);
  doc.fontSize(9).moveDown(0.2);
  if (ignited.length === 0) {
    doc.text("Nenhuma ignição (≥3 canais Gardner × ≥2 CASEL).");
  } else {
    for (const ig of ignited.slice(0, 10)) {
      doc.text(
        `• turn ${ig.turn} — ${ig.gardner_channels.join("×")} / ${ig.casel_dimensions.join("+")}`,
      );
    }
  }
  doc.moveDown(1);
}

function writeAspirations(doc: PDFKit.PDFDocument, aps: AspirationSignal[]): void {
  doc.fontSize(14).text("Sinais de aspiração emergente");
  doc.fontSize(9).moveDown(0.2);
  if (aps.length === 0) {
    doc.text("Sem temas recorrentes.");
  } else {
    for (const a of aps) {
      doc.text(
        `• ${a.key} — ${a.occurrences}x (turns ${a.first_seen_turn}–${a.last_seen_turn})`,
      );
    }
  }
  doc.moveDown(1);
}

function writeMetrics(doc: PDFKit.PDFDocument, data: WeeklyReportData): void {
  const m = data.metrics;
  doc.fontSize(14).text("Métricas operacionais");
  doc.fontSize(9).moveDown(0.2);
  const ratio =
    m.off_on_screen_ratio.ratio === Infinity
      ? "∞ (tudo off)"
      : m.off_on_screen_ratio.ratio.toFixed(2);
  doc.text(`Turns totais: ${m.total_turns}`);
  doc.text(`Sessões: ${m.total_sessions}`);
  doc.text(
    `Ratio off:on screen: ${ratio} (${m.off_on_screen_ratio.off} off / ${m.off_on_screen_ratio.on} on)`,
  );
  doc.text(`Sessões com brejo: ${m.sessions_in_brejo}`);
  doc.text(
    `Frequência de pausa do programa: ${(m.program_pause_frequency * 100).toFixed(0)}%`,
  );
  doc.text(`Milestones faltantes acumulados: ${m.missed_milestones_total}`);
  doc.text(`Sacrifice médio/turn: ${m.avg_sacrifice_per_turn.toFixed(2)}`);
  doc.text(`Tempo de tela total (s): ${m.total_screen_seconds}`);
  doc.moveDown(1);
}

/** Renderiza o relatório como Buffer PDF. */
export function renderPdf(
  data: WeeklyReportData,
  opts: PdfOptions = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: opts.size ?? "A4", margin: opts.margin ?? 40 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      writeHeader(doc, data);
      writeProgram(doc, data);
      writeCards(doc, data.cards);
      writeStatus(doc, data.status_comparison);
      writeIgnitions(doc, data.ignitions);
      writeAspirations(doc, data.aspirations);
      writeMetrics(doc, data);

      doc.fontSize(8).fillColor("#888").moveDown(1).text("🌳 Crescer para colher.");
      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}
