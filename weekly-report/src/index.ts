/**
 * @ascendimacy/weekly-report
 * Bloco 3 #17 — relatório semanal a partir de traces v0.3.
 *
 * API canônica:
 *   generateWeeklyReport(traces, childName, options?) →
 *     { data, markdown, renderPdf() }
 *
 * PDF é função assíncrona — caller invoca só se quiser output binário.
 */

import type { SessionTrace } from "@ascendimacy/shared";
import type { WeeklyReportData, WeeklyReportOptions } from "./types.js";
import { aggregate } from "./aggregate.js";
import { renderMarkdown } from "./markdown.js";
import { renderPdf } from "./pdf.js";

export * from "./types.js";
export { aggregate, aggregateCards, compareStatusMatrices, detectIgnitions, extractAspirations, summarizeEmittedCard } from "./aggregate.js";
export { computeMetrics } from "./metrics.js";
export { renderMarkdown } from "./markdown.js";
export { renderPdf } from "./pdf.js";

export interface GeneratedReport {
  data: WeeklyReportData;
  markdown: string;
  renderPdf(): Promise<Buffer>;
}

export function generateWeeklyReport(
  traces: SessionTrace[],
  childName: string,
  options: WeeklyReportOptions = {},
): GeneratedReport {
  const data = aggregate(traces, childName, options);
  const markdown = renderMarkdown(data);
  return {
    data,
    markdown,
    renderPdf: () => renderPdf(data),
  };
}
