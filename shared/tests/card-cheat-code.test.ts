import { describe, it, expect } from "vitest";
import {
  generateCheatCode,
  slugify,
  relativeDateLabel,
} from "../src/card-cheat-code.js";

describe("slugify", () => {
  it("lowercases + strips accents", () => {
    expect(slugify("Ação Aérea")).toBe("acao_aerea");
  });
  it("replaces spaces with underscores", () => {
    expect(slugify("tres palavras aqui")).toBe("tres_palavras_aqui");
  });
  it("strips punctuation", () => {
    expect(slugify("hello, world!")).toBe("hello_world");
  });
  it("clamps at 32 chars", () => {
    const long = "a".repeat(50);
    expect(slugify(long).length).toBe(32);
  });
  it("preserves unicode letters (japanese ok)", () => {
    expect(slugify("学習")).toBe("学習");
  });
});

describe("relativeDateLabel", () => {
  const now = "2026-04-24T12:00:00Z";
  it("< 1 day = hoje", () => {
    expect(relativeDateLabel("2026-04-24T01:00:00Z", now)).toBe("hoje");
  });
  it("1-2 days = ontem", () => {
    expect(relativeDateLabel("2026-04-23T11:00:00Z", now)).toBe("ontem");
  });
  it("2-7 days = semana", () => {
    expect(relativeDateLabel("2026-04-20T12:00:00Z", now)).toBe("semana");
  });
  it(">=7 days < 30 = mês", () => {
    expect(relativeDateLabel("2026-04-15T12:00:00Z", now)).toBe("mês");
  });
  it(">=30 days = ISO date", () => {
    expect(relativeDateLabel("2025-12-01T12:00:00Z", now)).toBe("2025-12-01");
  });
  it("future issued_at returns 'futuro'", () => {
    expect(relativeDateLabel("2027-01-01T00:00:00Z", now)).toBe("futuro");
  });
});

describe("generateCheatCode", () => {
  const now = "2026-04-24T12:00:00Z";
  it("3 parts separated by ' · '", () => {
    const code = generateCheatCode({
      context_word: "persistence",
      issued_at: "2026-04-24T10:00:00Z",
      gardner_channel: "logical_mathematical",
      now,
    });
    expect(code.split(" · ")).toHaveLength(3);
  });
  it("deterministic given same inputs", () => {
    const c1 = generateCheatCode({
      context_word: "persistence",
      issued_at: "2026-04-24T10:00:00Z",
      gardner_channel: "logical_mathematical",
      now,
    });
    const c2 = generateCheatCode({
      context_word: "persistence",
      issued_at: "2026-04-24T10:00:00Z",
      gardner_channel: "logical_mathematical",
      now,
    });
    expect(c1).toBe(c2);
  });
  it("word normalizado (lowercase + accent strip)", () => {
    const code = generateCheatCode({
      context_word: "Coragem Pequena",
      issued_at: "2026-04-24T10:00:00Z",
      gardner_channel: "linguistic",
      now,
    });
    expect(code.startsWith("coragem_pequena ·")).toBe(true);
  });
  it("includes gardner icon", () => {
    const code = generateCheatCode({
      context_word: "x",
      issued_at: "2026-04-24T10:00:00Z",
      gardner_channel: "musical",
      now,
    });
    expect(code).toContain("🎵");
  });
  it("fallback 'conquista' when context_word reduz a empty slug", () => {
    const code = generateCheatCode({
      context_word: "!!!",
      issued_at: "2026-04-24T10:00:00Z",
      gardner_channel: "spatial",
      now,
    });
    expect(code.startsWith("conquista ·")).toBe(true);
  });
});
