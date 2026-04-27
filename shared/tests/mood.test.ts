import { describe, it, expect } from "vitest";
import {
  MOOD_MIN,
  MOOD_MAX,
  MOOD_DEFAULT,
  COMFORT_GATE,
  isMoodScore,
  clampMoodScore,
  triggersComfortGate,
  computeMoodWindow,
} from "../src/mood.js";
import type { MoodReading, MoodReadingRow } from "../src/mood.js";
import { inMemoryMoodRepo } from "../src/mood-repo-memory.js";

describe("MoodScore guards + clamping", () => {
  it("isMoodScore aceita integers 1-10", () => {
    expect(isMoodScore(1)).toBe(true);
    expect(isMoodScore(5)).toBe(true);
    expect(isMoodScore(10)).toBe(true);
  });

  it("isMoodScore rejeita 0, 11, decimais, não-números", () => {
    expect(isMoodScore(0)).toBe(false);
    expect(isMoodScore(11)).toBe(false);
    expect(isMoodScore(7.5)).toBe(false);
    expect(isMoodScore("5")).toBe(false);
    expect(isMoodScore(null)).toBe(false);
    expect(isMoodScore(undefined)).toBe(false);
    expect(isMoodScore(NaN)).toBe(false);
  });

  it("clampMoodScore arredonda + clampa pro range", () => {
    expect(clampMoodScore(0)).toBe(MOOD_MIN);
    expect(clampMoodScore(11)).toBe(MOOD_MAX);
    expect(clampMoodScore(7.5)).toBe(8);
    expect(clampMoodScore(7.4)).toBe(7);
    expect(clampMoodScore(-3)).toBe(MOOD_MIN);
    expect(clampMoodScore(100)).toBe(MOOD_MAX);
  });

  it("clampMoodScore retorna MOOD_DEFAULT pra valores inválidos", () => {
    expect(clampMoodScore(NaN)).toBe(MOOD_DEFAULT);
    expect(clampMoodScore(Infinity)).toBe(MOOD_DEFAULT);
    expect(clampMoodScore(-Infinity)).toBe(MOOD_DEFAULT);
  });
});

describe("triggersComfortGate", () => {
  it("ativa em mood ≤ COMFORT_GATE (3)", () => {
    expect(triggersComfortGate(1)).toBe(true);
    expect(triggersComfortGate(2)).toBe(true);
    expect(triggersComfortGate(3)).toBe(true);
  });

  it("não ativa em mood > COMFORT_GATE", () => {
    expect(triggersComfortGate(4)).toBe(false);
    expect(triggersComfortGate(7)).toBe(false);
    expect(triggersComfortGate(10)).toBe(false);
  });
});

describe("computeMoodWindow", () => {
  const now = "2026-04-27T12:00:00Z";

  const reading = (
    score: number,
    at: string,
    source: "llm" | "rule_based" | "manual" = "llm",
  ): MoodReading => ({ score, at, source });

  it("histórico vazio retorna null/zeros", () => {
    const w = computeMoodWindow([], now);
    expect(w.recent3turns).toBeNull();
    expect(w.recent7days).toBeNull();
    expect(w.latest).toBeNull();
    expect(w.countIn7Days).toBe(0);
  });

  it("1 leitura: recent3turns == score, latest == leitura", () => {
    const r = reading(7, "2026-04-27T11:00:00Z");
    const w = computeMoodWindow([r], now);
    expect(w.recent3turns).toBe(7);
    expect(w.recent7days).toBe(7);
    expect(w.latest).toEqual(r);
    expect(w.countIn7Days).toBe(1);
  });

  it("recent3turns = média das 3 leituras mais recentes", () => {
    const history: MoodReading[] = [
      reading(2, "2026-04-26T10:00:00Z"),
      reading(4, "2026-04-27T08:00:00Z"),
      reading(8, "2026-04-27T10:00:00Z"),
      reading(6, "2026-04-27T11:00:00Z"),
      reading(5, "2026-04-27T11:30:00Z"),
    ];
    const w = computeMoodWindow(history, now);
    // 3 mais recentes: 5, 6, 8 (timestamps 11:30, 11:00, 10:00)
    expect(w.recent3turns).toBeCloseTo((5 + 6 + 8) / 3);
    expect(w.latest?.score).toBe(5);
  });

  it("recent7days filtra leituras antigas (>7d) corretamente", () => {
    const history: MoodReading[] = [
      reading(3, "2026-04-15T10:00:00Z"), // > 7 days ago — fora
      reading(7, "2026-04-21T10:00:00Z"), // ~6 days ago — dentro
      reading(8, "2026-04-26T10:00:00Z"), // 1 day ago — dentro
    ];
    const w = computeMoodWindow(history, now);
    expect(w.countIn7Days).toBe(2);
    expect(w.recent7days).toBeCloseTo((7 + 8) / 2);
  });

  it("recent7days null se nenhuma leitura na janela 7d", () => {
    const history: MoodReading[] = [
      reading(5, "2026-04-15T10:00:00Z"), // > 7 days ago
    ];
    const w = computeMoodWindow(history, now);
    expect(w.recent7days).toBeNull();
    expect(w.countIn7Days).toBe(0);
    // recent3turns ainda é computado (sobre todo histórico, não janela 7d)
    expect(w.recent3turns).toBe(5);
  });

  it("ordena desc independente da ordem de input", () => {
    const history: MoodReading[] = [
      reading(8, "2026-04-27T10:00:00Z"),
      reading(5, "2026-04-27T11:30:00Z"),
      reading(6, "2026-04-27T11:00:00Z"),
    ];
    const w = computeMoodWindow(history, now);
    expect(w.latest?.score).toBe(5); // timestamp 11:30 é mais recente
  });
});

describe("inMemoryMoodRepo — port adapter", () => {
  it("retorna histórico vazio quando user sem leituras", async () => {
    const repo = inMemoryMoodRepo();
    const rows = await repo.loadHistory("user-1");
    expect(rows).toEqual([]);
  });

  it("isola users — não vaza leituras entre user-1 e user-2", async () => {
    const seed: MoodReadingRow[] = [
      { userId: "user-1", score: 5, at: "2026-04-27T10:00:00Z", source: "llm" },
      { userId: "user-2", score: 8, at: "2026-04-27T10:00:00Z", source: "llm" },
    ];
    const repo = inMemoryMoodRepo(seed);
    const rows1 = await repo.loadHistory("user-1");
    expect(rows1).toHaveLength(1);
    expect(rows1[0]?.score).toBe(5);
  });

  it("append + loadHistory roundtrip", async () => {
    const repo = inMemoryMoodRepo();
    await repo.append({
      userId: "user-1",
      score: 7,
      at: "2026-04-27T10:00:00Z",
      source: "llm",
    });
    await repo.append({
      userId: "user-1",
      score: 6,
      at: "2026-04-27T11:00:00Z",
      source: "rule_based",
    });
    const rows = await repo.loadHistory("user-1");
    expect(rows).toHaveLength(2);
    // ordenado desc por at
    expect(rows[0]?.score).toBe(6);
    expect(rows[1]?.score).toBe(7);
  });

  it("opção limit pega só as N mais recentes", async () => {
    const seed: MoodReadingRow[] = [
      { userId: "user-1", score: 3, at: "2026-04-25T10:00:00Z", source: "llm" },
      { userId: "user-1", score: 5, at: "2026-04-26T10:00:00Z", source: "llm" },
      { userId: "user-1", score: 7, at: "2026-04-27T10:00:00Z", source: "llm" },
    ];
    const repo = inMemoryMoodRepo(seed);
    const rows = await repo.loadHistory("user-1", { limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.score).toBe(7); // mais recente
    expect(rows[1]?.score).toBe(5);
  });

  it("opção since filtra por timestamp", async () => {
    const seed: MoodReadingRow[] = [
      { userId: "user-1", score: 3, at: "2026-04-20T10:00:00Z", source: "llm" },
      { userId: "user-1", score: 7, at: "2026-04-27T10:00:00Z", source: "llm" },
    ];
    const repo = inMemoryMoodRepo(seed);
    const rows = await repo.loadHistory("user-1", {
      since: "2026-04-25T00:00:00Z",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.score).toBe(7);
  });
});
