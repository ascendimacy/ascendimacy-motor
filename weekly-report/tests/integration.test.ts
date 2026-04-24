import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionTrace } from "@ascendimacy/shared";
import { generateWeeklyReport } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("generateWeeklyReport — fixture v0.3", () => {
  const fixturePath = join(__dirname, "../fixtures/trace-v0.3-example.json");
  const trace = JSON.parse(readFileSync(fixturePath, "utf-8")) as SessionTrace;

  it("aceita fixture v0.3 do shared trace schema (STS integration point)", () => {
    expect(trace.meta.schemaVersion).toBe("0.3.0");
    expect(trace.turns[0]!.statusSnapshot).toBeDefined();
    expect(trace.turns[0]!.gardnerProgramSnapshot).toBeDefined();
    expect(trace.turns[0]!.selectedContent).toBeDefined();
  });

  it("generateWeeklyReport produz data + markdown", () => {
    const report = generateWeeklyReport([trace], "Ryo");
    expect(report.data.child_name).toBe("Ryo");
    expect(report.data.child_age).toBe(13);
    expect(report.data.cards).toHaveLength(1);
    expect(report.markdown).toContain("Ryo");
    expect(report.markdown).toContain("ling_inuit_snow");
  });

  it("renderPdf produz buffer PDF válido a partir da fixture", async () => {
    const report = generateWeeklyReport([trace], "Ryo");
    const buf = await report.renderPdf();
    expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
  }, 10_000);
});
