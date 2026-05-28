/**
 * Unit tests for scripts/smoke-trio-yuji.mjs pure functions.
 *
 * Spec: agent E6-M batch 6 (smoke trio Yuji concurrent E2E).
 *
 * Não roda o script real (E2E ~3min). Testa apenas funções puras
 * (aggregateKpis, detectCrossPollination, loadPersonaFixture,
 * evaluateRubric) + asserções de presença/shebang do script.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ES module — __dirname não existe; derivar de import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Caminho até o repo root (3 levels up from packages/ebrota-console-bff/tests).
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "smoke-trio-yuji.mjs");

// Dynamic import — .mjs cross-package via path absoluto.
async function loadScript(): Promise<{
  PERSONAS: Array<{ id: string; name: string; age: number }>;
  CANNED_MESSAGES: string[];
  aggregateKpis: (
    turns: Array<{
      persona: string;
      turnIdx: number;
      latencyMs: number;
      finalResponse: string;
      error?: string;
    }>,
  ) => Record<
    string,
    {
      totalTurns: number;
      successTurns: number;
      fallbackRate: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      distinctResponses: number;
    }
  >;
  detectCrossPollination: (
    sessions: Array<{ sessionId: string; persona: string; responses: string[] }>,
  ) => Array<{
    sessionId: string;
    turnIdx: number;
    otherPersona: string;
    response: string;
  }>;
  loadPersonaFixture: (personaId: string, fixturesDir?: string) => string;
  evaluateRubric: (
    kpis: Record<string, { totalTurns: number; fallbackRate: number }>,
    crossPollination: unknown[],
    expectedTurns: number,
  ) => { pass: boolean; failures: string[] };
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await import(SCRIPT_PATH)) as any;
}

describe("smoke-trio-yuji.mjs — script presence", () => {
  it("script file exists and starts with shebang", () => {
    const stat = statSync(SCRIPT_PATH);
    expect(stat.isFile()).toBe(true);
    const head = readFileSync(SCRIPT_PATH, "utf-8").slice(0, 32);
    expect(head.startsWith("#!/usr/bin/env node")).toBe(true);
  });
});

describe("smoke-trio-yuji.mjs — persona fixtures", () => {
  it("loadPersonaFixture returns YAML for all 3 Yuji kids", async () => {
    const { PERSONAS, loadPersonaFixture } = await loadScript();
    expect(PERSONAS.map((p) => p.id).sort()).toEqual(
      ["kei-kid", "ryo-kid", "saki-kid"].sort(),
    );
    for (const p of PERSONAS) {
      const raw = loadPersonaFixture(p.id);
      expect(raw).toMatch(/^id:\s*\S/m);
      expect(raw).toMatch(new RegExp(`name:\\s*${p.name}`, "m"));
    }
  });

  it("loadPersonaFixture throws on missing fixture", async () => {
    const { loadPersonaFixture } = await loadScript();
    expect(() => loadPersonaFixture("nonexistent-persona-xyz")).toThrow(
      /not found/i,
    );
  });
});

describe("smoke-trio-yuji.mjs — aggregateKpis", () => {
  it("computes per-persona totals, fallback rate, and latency stats", async () => {
    const { aggregateKpis } = await loadScript();
    const turns = [
      { persona: "ryo-kid", turnIdx: 0, latencyMs: 100, finalResponse: "A" },
      { persona: "ryo-kid", turnIdx: 1, latencyMs: 200, finalResponse: "B" },
      { persona: "ryo-kid", turnIdx: 2, latencyMs: 300, finalResponse: "B" },
      {
        persona: "kei-kid",
        turnIdx: 0,
        latencyMs: 150,
        finalResponse: "",
        error: "boom",
      },
      { persona: "kei-kid", turnIdx: 1, latencyMs: 250, finalResponse: "X" },
    ];
    const k = aggregateKpis(turns);

    expect(k["ryo-kid"]?.totalTurns).toBe(3);
    expect(k["ryo-kid"]?.successTurns).toBe(3);
    expect(k["ryo-kid"]?.fallbackRate).toBe(0);
    expect(k["ryo-kid"]?.avgLatencyMs).toBe(200); // (100+200+300)/3
    expect(k["ryo-kid"]?.distinctResponses).toBe(2); // A, B

    expect(k["kei-kid"]?.totalTurns).toBe(2);
    expect(k["kei-kid"]?.successTurns).toBe(1);
    expect(k["kei-kid"]?.fallbackRate).toBe(0.5);
    expect(k["kei-kid"]?.avgLatencyMs).toBe(250); // só a success
    expect(k["kei-kid"]?.distinctResponses).toBe(1);
  });

  it("handles empty input gracefully", async () => {
    const { aggregateKpis } = await loadScript();
    expect(aggregateKpis([])).toEqual({});
  });
});

describe("smoke-trio-yuji.mjs — detectCrossPollination", () => {
  it("returns empty when responses are clean (no persona name leak)", async () => {
    const { detectCrossPollination } = await loadScript();
    const sessions = [
      {
        sessionId: "s-ryo",
        persona: "Ryo",
        responses: ["Olá, tudo bem?", "Que legal!", "Vou te contar uma história"],
      },
      {
        sessionId: "s-kei",
        persona: "Kei",
        responses: ["Oi!", "Adorei!", "Conta mais"],
      },
      {
        sessionId: "s-saki",
        persona: "Saki",
        responses: ["Tchau", "Até", "Eba"],
      },
    ];
    expect(detectCrossPollination(sessions)).toEqual([]);
  });

  it("detects leak when persona A's session mentions persona B's name", async () => {
    const { detectCrossPollination } = await loadScript();
    const sessions = [
      {
        sessionId: "s-ryo",
        persona: "Ryo",
        responses: [
          "Olá! Tudo bem?",
          "Bom te ver, Kei!", // <- leak: Ryo's session called "Kei"
          "Continuamos",
        ],
      },
      {
        sessionId: "s-kei",
        persona: "Kei",
        responses: ["Oi", "Que bom", "Sigo"],
      },
    ];
    const issues = detectCrossPollination(sessions);
    expect(issues.length).toBe(1);
    expect(issues[0]?.sessionId).toBe("s-ryo");
    expect(issues[0]?.otherPersona).toBe("Kei");
    expect(issues[0]?.turnIdx).toBe(1);
  });

  it("does not flag when response mentions own persona alongside another (ambiguous)", async () => {
    // Caso bordeline: "Ryo e Kei estão aqui" em sessão Ryo — ownRe matches,
    // então não flagamos (heurística conservadora pra evitar falso positivo
    // em casos onde bot legitimamente nomeia múltiplos children).
    const { detectCrossPollination } = await loadScript();
    const sessions = [
      {
        sessionId: "s-ryo",
        persona: "Ryo",
        responses: ["Ryo e Kei são bons amigos"],
      },
      { sessionId: "s-kei", persona: "Kei", responses: ["ok"] },
    ];
    expect(detectCrossPollination(sessions)).toEqual([]);
  });
});

describe("smoke-trio-yuji.mjs — evaluateRubric", () => {
  it("passes when all personas hit expected turns, no fallback, no leaks", async () => {
    const { evaluateRubric } = await loadScript();
    const kpis = {
      "ryo-kid": { totalTurns: 50, fallbackRate: 0 },
      "kei-kid": { totalTurns: 50, fallbackRate: 0 },
      "saki-kid": { totalTurns: 50, fallbackRate: 0 },
    };
    const { pass, failures } = evaluateRubric(kpis, [], 50);
    expect(pass).toBe(true);
    expect(failures).toEqual([]);
  });

  it("fails when fallback rate >= 10%", async () => {
    const { evaluateRubric } = await loadScript();
    const kpis = {
      "ryo-kid": { totalTurns: 50, fallbackRate: 0.2 },
      "kei-kid": { totalTurns: 50, fallbackRate: 0 },
      "saki-kid": { totalTurns: 50, fallbackRate: 0 },
    };
    const { pass, failures } = evaluateRubric(kpis, [], 50);
    expect(pass).toBe(false);
    expect(failures.some((f) => f.includes("ryo-kid") && f.includes("fallback"))).toBe(
      true,
    );
  });

  it("fails when cross-pollination present", async () => {
    const { evaluateRubric } = await loadScript();
    const kpis = {
      "ryo-kid": { totalTurns: 50, fallbackRate: 0 },
      "kei-kid": { totalTurns: 50, fallbackRate: 0 },
      "saki-kid": { totalTurns: 50, fallbackRate: 0 },
    };
    const { pass, failures } = evaluateRubric(
      kpis,
      [{ sessionId: "x", turnIdx: 0, otherPersona: "Y", response: "z" }],
      50,
    );
    expect(pass).toBe(false);
    expect(failures.some((f) => f.includes("cross-pollination"))).toBe(true);
  });
});

describe("smoke-trio-yuji.mjs — canned messages", () => {
  it("exports exactly 50 canned user messages", async () => {
    const { CANNED_MESSAGES } = await loadScript();
    expect(CANNED_MESSAGES).toHaveLength(50);
    for (const msg of CANNED_MESSAGES) {
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});
