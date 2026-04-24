/**
 * Tests do auto-hook (Bloco 5a hotfix motor#17).
 *
 * Cobre:
 *   - signal detected → card persisted
 *   - archetype scaffold + env=test → emite
 *   - archetype scaffold + env=production → skip silencioso (warning)
 *   - latency < 100ms da pipeline em mock provider
 *   - trace tem emittedCardId quando emitido
 *
 * Roda contra MCP server seria heavy (spawn). Em vez disso, exercita as
 * funções de pipeline diretamente como o MCP tool faria.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectAchievement,
  selectArchetypeForSignal,
  proposeCardSpec,
  triageCardSpec,
  generateCardImage,
  emitCard,
} from "../src/card-generation.js";
import { loadArchetypes } from "../src/archetype-loader.js";
import { saveEmittedCard, getEmittedCardsByChild, EMITTED_CARDS_DDL, getNextSequence } from "../src/cards-repo.js";
import { MockCardImageProvider } from "@ascendimacy/shared";

const SECRET = "test-secret-very-secret-0000";
const NOW = "2026-04-24T12:00:00Z";

let db: Database.Database;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "auto-hook-"));
  db = new Database(":memory:");
  db.exec(EMITTED_CARDS_DDL);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const archetypes = loadArchetypes();

const baseProvider = new MockCardImageProvider();

/** Replica a lógica do MCP tool emit_card_for_signal pra cobertura sem spawn. */
async function runEmitPipeline(opts: {
  signal: ReturnType<typeof detectAchievement>;
  childName?: string;
  parentalProfile?: import("@ascendimacy/shared").ParentalProfile;
  env: string;
}): Promise<{ ok?: boolean; card_id?: string; skipped?: boolean; skip_reason?: string }> {
  if (!opts.signal) return { skipped: true, skip_reason: "no_signal" };
  const archetype = selectArchetypeForSignal(opts.signal, archetypes);
  if (!archetype) return { skipped: true, skip_reason: "no_archetype_available" };

  if (archetype.is_scaffold && opts.env !== "test") {
    return { skipped: true, skip_reason: "scaffold_in_non_test" };
  }

  const sequence = getNextSequence(db, opts.signal.child_id);
  const spec = proposeCardSpec(opts.signal, archetype, sequence);
  const triage = await triageCardSpec(spec, opts.parentalProfile);
  if (!triage.approved) {
    return { skipped: true, skip_reason: "triage_rejected" };
  }

  const image = await generateCardImage(spec, baseProvider);
  const card = emitCard({
    spec,
    approved_at: NOW,
    emitted_at: NOW,
    image,
    secret: SECRET,
    env: opts.env,
    child_name: opts.childName ?? spec.child_id,
  });
  saveEmittedCard(db, card);
  return { ok: true, card_id: card.card_id };
}

describe("auto-hook — signal detection + emit", () => {
  it("ignition signal → card persisted (env=test)", async () => {
    const signal = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      gardner_observed: ["linguistic", "logical_mathematical", "spatial"],
      casel_touched: ["SA", "DM"],
    });
    expect(signal?.kind).toBe("ignition");

    const result = await runEmitPipeline({ signal, childName: "Ryo", env: "test" });
    expect(result.ok).toBe(true);
    expect(result.card_id).toBeDefined();

    const persisted = getEmittedCardsByChild(db, "ryo");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.card_id).toBe(result.card_id);
  });

  it("no signal → no emission", async () => {
    const signal = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      // sem gardner/casel/sacrifice → nenhum kind
    });
    expect(signal).toBeNull();
    const result = await runEmitPipeline({ signal, env: "test" });
    expect(result.skipped).toBe(true);
    expect(result.skip_reason).toBe("no_signal");
  });
});

describe("auto-hook — scaffold guard", () => {
  it("scaffold archetype + env='test' → emite", async () => {
    const signal = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      gardner_observed: ["linguistic", "logical_mathematical", "spatial"],
      casel_touched: ["SA", "DM"],
    });
    const result = await runEmitPipeline({ signal, env: "test" });
    expect(result.ok).toBe(true);
    // archetype escolhido tem is_scaffold=true (todos os 5 do seed são)
    const card = getEmittedCardsByChild(db, "ryo")[0]!;
    expect(card.spec_snapshot.archetype.is_scaffold).toBe(true);
  });

  it("scaffold archetype + env='production' → skip silencioso (skip_reason=scaffold_in_non_test)", async () => {
    const signal = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      gardner_observed: ["linguistic", "logical_mathematical", "spatial"],
      casel_touched: ["SA", "DM"],
    });
    const result = await runEmitPipeline({ signal, env: "production" });
    expect(result.skipped).toBe(true);
    expect(result.skip_reason).toBe("scaffold_in_non_test");
    expect(getEmittedCardsByChild(db, "ryo")).toHaveLength(0);
  });

  it("scaffold archetype + env='development' → skip silencioso", async () => {
    const signal = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      gardner_observed: ["linguistic", "logical_mathematical", "spatial"],
      casel_touched: ["SA", "DM"],
    });
    const result = await runEmitPipeline({ signal, env: "development" });
    expect(result.skipped).toBe(true);
    expect(result.skip_reason).toBe("scaffold_in_non_test");
  });
});

describe("auto-hook — latency budget", () => {
  it("pipeline completa em < 100ms com mock provider", async () => {
    const signal = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      gardner_observed: ["linguistic", "logical_mathematical", "spatial"],
      casel_touched: ["SA", "DM"],
    });
    const start = Date.now();
    const result = await runEmitPipeline({ signal, env: "test" });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(100);
  });
});

describe("auto-hook — trace integration shape", () => {
  it("emittedCardId é string quando ok", async () => {
    const signal = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      gardner_observed: ["linguistic", "logical_mathematical", "spatial"],
      casel_touched: ["SA", "DM"],
    });
    const result = await runEmitPipeline({ signal, env: "test" });
    expect(typeof result.card_id).toBe("string");
    expect(result.card_id!.length).toBeGreaterThan(0);
  });

  it("skipped não devolve card_id", async () => {
    const signal = detectAchievement({
      child_id: "ryo",
      session_id: "s1",
      now: NOW,
      gardner_observed: ["linguistic", "logical_mathematical", "spatial"],
      casel_touched: ["SA", "DM"],
    });
    const result = await runEmitPipeline({ signal, env: "production" });
    expect(result.card_id).toBeUndefined();
  });
});
