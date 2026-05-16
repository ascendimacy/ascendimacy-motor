/**
 * Unit tests — trio orchestrator wire-up (ops#1092, follow-up motor#129).
 *
 * Cobre:
 *   - loadTrioConfigFromPlaybook (canon YAML + missing file fallback)
 *   - initTrioState (dyad + trio modes)
 *   - nextRoundNumber
 *   - prepareTurn (per-turn hook integration)
 *   - appendTurnHistory
 *   - annotateWarnings + emitWarnings (fail-soft sink)
 *   - composeBrejoSignals (emotional + sensory paths)
 *   - trioParticipantFromPersona (profile shape extraction)
 *
 * Doctrine cross-ref: ebrota-kids-dinamicas-grupo.md §10 + §11.
 */

import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  loadTrioConfigFromPlaybook,
  resolveGroupPlaybookPath,
  initTrioState,
  nextRoundNumber,
  prepareTurn,
  appendTurnHistory,
  annotateWarnings,
  emitWarnings,
  TRIO_WARNING_SEVERITY,
  type WarningSink,
} from "../src/trio-orchestrator.js";
import {
  composeBrejoSignals,
  trioParticipantFromPersona,
  DEFAULT_SENSORY_DIMENSIONS,
} from "../src/brejo-composer.js";
import {
  DEFAULT_TRIO_RUNTIME_CONFIG,
  type BrejoSignal,
  type StatusMatrix,
  type TrioParticipant,
  type TrioState,
} from "@ascendimacy/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

function ryo(): TrioParticipant {
  return { personaId: "ryo", name: "Ryo" };
}
function kei(): TrioParticipant {
  return { personaId: "kei", name: "Kei" };
}
function saki(): TrioParticipant {
  return {
    personaId: "saki",
    name: "Saki",
    regulation_strategy: "sensory",
    silence_tolerance_rounds: 5,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// loadTrioConfigFromPlaybook
// ─────────────────────────────────────────────────────────────────────────

describe("loadTrioConfigFromPlaybook", () => {
  it("returns DEFAULT config when playbook path doesn't resolve", () => {
    const config = loadTrioConfigFromPlaybook(
      "/nonexistent/path/playbook.yaml",
    );
    expect(config).toEqual(DEFAULT_TRIO_RUNTIME_CONFIG);
  });

  it("loads canon kids.group.playbook.yaml from motor playbooks dir", () => {
    // Canon foi copiado em ops#1092 wire-up.
    const canonPath = join(
      __dirname,
      "../../playbooks/kids.group.playbook.yaml",
    );
    if (!existsSync(canonPath)) {
      // Skip se ambiente não tem canon (CI sem sync).
      return;
    }
    const config = loadTrioConfigFromPlaybook(canonPath, { saki: "saki" });
    // Valores canonicalizados em ops#1086 (Jun GO 2026-05-16).
    expect(config.bot_turn_ratio_trio).toBe(0.2);
    expect(config.bot_turn_ratio_dyad).toBe(0.25);
    expect(config.dominance_threshold_trio).toBe(0.5);
    expect(config.dominance_threshold_dyad).toBe(0.6);
    expect(config.absence_threshold_rounds_default).toBe(3);
    expect(config.absence_threshold_rounds_overrides["saki"]).toBe(5);
    expect(config.brejo_pause_policy_trio.sensory_saki).toBe("partial");
    expect(config.brejo_pause_policy_trio.emotional_any).toBe("full");
    expect(config.max_consecutive_bot_turns).toBe(2);
  });

  it("loads from temp YAML w/ partial moderation_rules (fallback to defaults)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "trio-cfg-"));
    try {
      const path = join(tmpDir, "partial.yaml");
      writeFileSync(
        path,
        `
base_mixins:
  - name: withCrossing
    config:
      max_group_size: 3
      moderation_rules:
        bot_turn_ratio_trio: 0.18
`,
      );
      const config = loadTrioConfigFromPlaybook(path);
      expect(config.max_group_size).toBe(3);
      expect(config.bot_turn_ratio_trio).toBe(0.18);
      // Resto cai em defaults.
      expect(config.dominance_threshold_trio).toBe(0.5);
      expect(config.absence_threshold_rounds_default).toBe(3);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("resolveGroupPlaybookPath", () => {
  it("returns undefined for nonexistent override", () => {
    expect(resolveGroupPlaybookPath("/nope.yaml")).toBeUndefined();
  });

  it("returns override path when exists", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "trio-resolve-"));
    try {
      const path = join(tmpDir, "p.yaml");
      writeFileSync(path, "{}");
      expect(resolveGroupPlaybookPath(path)).toBe(path);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// initTrioState + nextRoundNumber
// ─────────────────────────────────────────────────────────────────────────

describe("initTrioState", () => {
  it("infers dyad mode from 2 participants", () => {
    const state = initTrioState([ryo(), kei()]);
    expect(state.mode).toBe("dyad");
    expect(state.participants).toHaveLength(2);
    expect(state.turnHistory).toEqual([]);
    expect(state.brejoSignals).toEqual([]);
  });

  it("infers trio mode from 3 participants", () => {
    const state = initTrioState([ryo(), kei(), saki()]);
    expect(state.mode).toBe("trio");
    expect(state.participants).toHaveLength(3);
  });

  it("respects explicit mode override", () => {
    const state = initTrioState([ryo(), kei(), saki()], "dyad");
    expect(state.mode).toBe("dyad");
  });

  it("throws on empty participants", () => {
    expect(() => initTrioState([])).toThrow(/participants vazio/);
  });
});

describe("nextRoundNumber", () => {
  it("returns 1 for empty history", () => {
    const state = initTrioState([ryo(), kei()]);
    expect(nextRoundNumber(state)).toBe(1);
  });

  it("returns max(round)+1 for non-empty history", () => {
    const state = initTrioState([ryo(), kei()]);
    state.turnHistory.push(
      { round: 1, speakerType: "bot" },
      { round: 1, speakerType: "child", personaId: "ryo" },
      { round: 2, speakerType: "bot" },
    );
    expect(nextRoundNumber(state)).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// prepareTurn (per-turn hook)
// ─────────────────────────────────────────────────────────────────────────

describe("prepareTurn", () => {
  it("returns bot target on empty history (round 1 opening)", () => {
    const state = initTrioState([ryo(), kei(), saki()]);
    const { decision, roundNumber } = prepareTurn(
      state,
      DEFAULT_TRIO_RUNTIME_CONFIG,
    );
    expect(decision.target).toBe("bot");
    expect(roundNumber).toBe(1);
  });

  it("returns child target after bot opens", () => {
    const state = initTrioState([ryo(), kei(), saki()]);
    state.turnHistory.push({ round: 1, speakerType: "bot" });
    // bot ratio = 1.0 → cap exceeded; runtime force child target.
    const { decision } = prepareTurn(state, DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(decision.target).toBe("child");
    expect(decision.nextSpeakerHint).toBeDefined();
  });

  it("returns pause_full when emotional brejo signal injected", () => {
    const state = initTrioState([ryo(), kei(), saki()]);
    state.turnHistory.push({ round: 1, speakerType: "bot" });
    const brejoSignals: BrejoSignal[] = [
      { personaId: "kei", type: "emotional" },
    ];
    const { decision } = prepareTurn(
      state,
      DEFAULT_TRIO_RUNTIME_CONFIG,
      brejoSignals,
    );
    expect(decision.target).toBe("pause_full");
    // Estado também guarda brejoSignals pra próxima call ler.
    expect(state.brejoSignals).toEqual(brejoSignals);
  });

  it("trio: returns child target w/ Saki excluded on sensory partial-pause", () => {
    const state = initTrioState([ryo(), kei(), saki()]);
    // Histórico equilibrado pra evitar dominance warning.
    state.turnHistory.push(
      { round: 1, speakerType: "bot" },
      { round: 1, speakerType: "child", personaId: "ryo" },
      { round: 1, speakerType: "child", personaId: "kei" },
      { round: 1, speakerType: "child", personaId: "saki" },
      { round: 2, speakerType: "bot" },
    );
    const brejoSignals: BrejoSignal[] = [
      { personaId: "saki", type: "sensory" },
    ];
    const { decision } = prepareTurn(
      state,
      DEFAULT_TRIO_RUNTIME_CONFIG,
      brejoSignals,
    );
    // Saki excluded; Ryo ou Kei deve ser sugerido (bot ratio já alto → child).
    expect(decision.excludedParticipants).toContain("saki");
    if (decision.target === "child") {
      expect(decision.nextSpeakerHint).not.toBe("saki");
    }
  });

  it("dyad: emotional brejo signal still triggers full pause (§10 invariant)", () => {
    const state = initTrioState([ryo(), kei()], "dyad");
    state.turnHistory.push({ round: 1, speakerType: "bot" });
    const brejoSignals: BrejoSignal[] = [
      { personaId: "ryo", type: "emotional" },
    ];
    const { decision } = prepareTurn(
      state,
      DEFAULT_TRIO_RUNTIME_CONFIG,
      brejoSignals,
    );
    expect(decision.target).toBe("pause_full");
  });

  it("dyad: sensory brejo also full pause (no partial path in dyad)", () => {
    const state = initTrioState([ryo(), kei()], "dyad");
    state.turnHistory.push({ round: 1, speakerType: "bot" });
    const brejoSignals: BrejoSignal[] = [
      { personaId: "kei", type: "sensory" },
    ];
    const { decision } = prepareTurn(
      state,
      DEFAULT_TRIO_RUNTIME_CONFIG,
      brejoSignals,
    );
    expect(decision.target).toBe("pause_full");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// appendTurnHistory
// ─────────────────────────────────────────────────────────────────────────

describe("appendTurnHistory", () => {
  it("appends entry with default timestamp", () => {
    const state = initTrioState([ryo(), kei()]);
    const entry = appendTurnHistory(state, {
      round: 1,
      speakerType: "child",
      personaId: "ryo",
    });
    expect(state.turnHistory).toHaveLength(1);
    expect(entry.timestamp).toBeDefined();
    expect(entry.round).toBe(1);
    expect(entry.personaId).toBe("ryo");
  });

  it("preserves explicit timestamp", () => {
    const state = initTrioState([ryo(), kei()]);
    const entry = appendTurnHistory(state, {
      round: 1,
      speakerType: "bot",
      timestamp: "2026-05-16T20:00:00Z",
    });
    expect(entry.timestamp).toBe("2026-05-16T20:00:00Z");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// annotateWarnings + emitWarnings (fail-soft sink)
// ─────────────────────────────────────────────────────────────────────────

describe("annotateWarnings", () => {
  it("maps each warning to severity correctly", () => {
    const annotated = annotateWarnings([
      { kind: "dominance_detected", personaId: "ryo", reason: "r1", value: 0.7 },
      { kind: "bot_ratio_exceeded", reason: "r2", value: 0.3 },
    ]);
    expect(annotated[0].severity).toBe("info");
    expect(annotated[1].severity).toBe("warn");
    expect(TRIO_WARNING_SEVERITY.bot_ratio_exceeded).toBe("warn");
    expect(TRIO_WARNING_SEVERITY.absence_detected).toBe("info");
  });
});

describe("emitWarnings", () => {
  it("no-op when sink absent", async () => {
    await emitWarnings(
      {
        target: "bot",
        excludedParticipants: [],
        warnings: [{ kind: "dominance_detected", reason: "r", value: 0.6 }],
        turnDistribution: {},
        botTurnRatio: 0.5,
      },
      { sessionId: "s1", roundNumber: 1 },
    );
    // No throw, no side-effect.
  });

  it("calls sink with annotated warnings + context", async () => {
    const calls: Array<{ warnings: unknown; context: unknown }> = [];
    const sink: WarningSink = async (warnings, context) => {
      calls.push({ warnings, context });
    };
    await emitWarnings(
      {
        target: "child",
        nextSpeakerHint: "ryo",
        excludedParticipants: [],
        warnings: [
          {
            kind: "absence_detected",
            personaId: "kei",
            reason: "silent",
            value: 4,
          },
        ],
        turnDistribution: { ryo: 3 },
        botTurnRatio: 0.2,
      },
      { sessionId: "s1", roundNumber: 5 },
      sink,
    );
    expect(calls).toHaveLength(1);
    const ctx = calls[0].context as { decisionTarget: string; roundNumber: number };
    expect(ctx.decisionTarget).toBe("child");
    expect(ctx.roundNumber).toBe(5);
  });

  it("swallows sink errors (fail-soft)", async () => {
    const sink: WarningSink = async () => {
      throw new Error("event_log offline");
    };
    // No throw expected.
    await emitWarnings(
      {
        target: "bot",
        excludedParticipants: [],
        warnings: [
          { kind: "dominance_detected", personaId: "ryo", reason: "r", value: 0.7 },
        ],
        turnDistribution: {},
        botTurnRatio: 0.1,
      },
      { sessionId: "s1", roundNumber: 1 },
      sink,
    );
  });

  it("no sink call when no warnings", async () => {
    let called = false;
    const sink: WarningSink = async () => {
      called = true;
    };
    await emitWarnings(
      {
        target: "bot",
        excludedParticipants: [],
        warnings: [],
        turnDistribution: {},
        botTurnRatio: 0.1,
      },
      { sessionId: "s1", roundNumber: 1 },
      sink,
    );
    expect(called).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// composeBrejoSignals (caller-side helper)
// ─────────────────────────────────────────────────────────────────────────

describe("composeBrejoSignals", () => {
  it("emits no signal when matrices all baia", () => {
    const matrix: StatusMatrix = {
      emotional: "baia",
      social_with_sibling: "baia",
    };
    const signals = composeBrejoSignals({
      participants: [ryo(), kei(), saki()],
      statusMatrixByPersona: { ryo: matrix, kei: matrix, saki: matrix },
    });
    expect(signals).toEqual([]);
  });

  it("emits emotional signal for any participant with emotional=brejo", () => {
    const signals = composeBrejoSignals({
      participants: [ryo(), kei(), saki()],
      statusMatrixByPersona: {
        ryo: { emotional: "baia" },
        kei: { emotional: "brejo" },
        saki: { emotional: "baia" },
      },
    });
    expect(signals).toEqual([{ personaId: "kei", type: "emotional" }]);
  });

  it("emits sensory signal ONLY for participant w/ regulation_strategy=sensory", () => {
    const signals = composeBrejoSignals({
      participants: [ryo(), kei(), saki()],
      statusMatrixByPersona: {
        // Ryo NÃO tem regulation_strategy=sensory; mesmo com social_with_sibling=brejo
        // não emite sensory signal.
        ryo: { emotional: "baia", social_with_sibling: "brejo" },
        kei: { emotional: "baia" },
        saki: { emotional: "baia", social_with_sibling: "brejo" },
      },
    });
    expect(signals).toEqual([{ personaId: "saki", type: "sensory" }]);
  });

  it("emits both emotional + sensory signals when applicable", () => {
    const signals = composeBrejoSignals({
      participants: [ryo(), saki()],
      statusMatrixByPersona: {
        ryo: { emotional: "brejo" },
        saki: { emotional: "baia", social_with_sibling: "brejo" },
      },
    });
    expect(signals).toContainEqual({ personaId: "ryo", type: "emotional" });
    expect(signals).toContainEqual({ personaId: "saki", type: "sensory" });
  });

  it("ignores participants without matrix entry (graceful)", () => {
    const signals = composeBrejoSignals({
      participants: [ryo(), kei()],
      statusMatrixByPersona: {
        ryo: { emotional: "brejo" },
        // kei sem matrix
      },
    });
    expect(signals).toEqual([{ personaId: "ryo", type: "emotional" }]);
  });

  it("respects extraSensoryDimensions override", () => {
    const signals = composeBrejoSignals({
      participants: [saki()],
      statusMatrixByPersona: {
        saki: { emotional: "baia", auditory: "brejo" },
      },
      extraSensoryDimensions: ["auditory"],
    });
    expect(signals).toEqual([{ personaId: "saki", type: "sensory" }]);
  });

  it("DEFAULT_SENSORY_DIMENSIONS includes social_with_sibling + sensory", () => {
    expect(DEFAULT_SENSORY_DIMENSIONS).toContain("social_with_sibling");
    expect(DEFAULT_SENSORY_DIMENSIONS).toContain("sensory");
  });
});

describe("trioParticipantFromPersona", () => {
  it("extracts regulation_strategy + silence_tolerance_rounds", () => {
    const p = trioParticipantFromPersona("saki", "Saki", {
      regulation_strategy: "sensory",
      silence_tolerance_rounds: 5,
    });
    expect(p.regulation_strategy).toBe("sensory");
    expect(p.silence_tolerance_rounds).toBe(5);
  });

  it("omits invalid regulation_strategy", () => {
    const p = trioParticipantFromPersona("x", "X", {
      regulation_strategy: "invalid-value",
    });
    expect(p.regulation_strategy).toBeUndefined();
  });

  it("omits non-positive silence_tolerance_rounds", () => {
    const p = trioParticipantFromPersona("x", "X", {
      silence_tolerance_rounds: 0,
    });
    expect(p.silence_tolerance_rounds).toBeUndefined();
  });

  it("handles undefined profile gracefully", () => {
    const p = trioParticipantFromPersona("x", "X", undefined);
    expect(p.personaId).toBe("x");
    expect(p.name).toBe("X");
    expect(p.regulation_strategy).toBeUndefined();
    expect(p.silence_tolerance_rounds).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Dyad backward-compat smoke (regression guard)
// ─────────────────────────────────────────────────────────────────────────

describe("dyad backward-compat", () => {
  it("dyad runtime decisions stay identical to pre-wireup behavior", () => {
    // Same scenarios cover by trio-runtime.unit.test.ts; here apenas
    // verificamos que initTrioState + prepareTurn não muda thresholds dyad.
    const state = initTrioState([ryo(), kei()]);
    expect(state.mode).toBe("dyad");
    const { decision } = prepareTurn(state, DEFAULT_TRIO_RUNTIME_CONFIG);
    // Bot abre dinâmica (turnHistory vazio).
    expect(decision.target).toBe("bot");
    // Append, próximo turn:
    appendTurnHistory(state, { round: 1, speakerType: "bot" });
    const { decision: next } = prepareTurn(state, DEFAULT_TRIO_RUNTIME_CONFIG);
    // bot ratio 100% > 25% cap → child.
    expect(next.target).toBe("child");
    expect(["ryo", "kei"]).toContain(next.nextSpeakerHint);
  });
});
