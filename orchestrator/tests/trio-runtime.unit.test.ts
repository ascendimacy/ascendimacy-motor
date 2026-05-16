/**
 * Unit tests — Trio runtime engine (ops#1086).
 *
 * Cobre primitivas + decisão composta + config loader.
 * Doctrine cross-ref: ebrota-kids-dinamicas-grupo.md §10 + §11.
 */

import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { readFileSync, existsSync } from "node:fs";
import {
  computeTurnDistribution,
  detectDominance,
  detectAbsence,
  absenceThresholdFor,
  decideBrejoPause,
  shouldBotTakeTurn,
  pickNextChild,
  decideNextSpeaker,
  buildTrioConfigFromPlaybook,
  modeFromParticipantCount,
  DEFAULT_ROLLING_WINDOW,
} from "../src/trio-runtime.js";
import {
  DEFAULT_TRIO_RUNTIME_CONFIG,
  type TrioParticipant,
  type TrioRuntimeConfig,
  type TrioState,
  type TurnHistoryEntry,
} from "@ascendimacy/shared";

// ─────────────────────────────────────────────────────────────────────────
// Fixtures helpers
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

function botTurn(round: number): TurnHistoryEntry {
  return { round, speakerType: "bot" };
}
function childTurn(round: number, personaId: string): TurnHistoryEntry {
  return { round, speakerType: "child", personaId };
}

function trioState(
  history: TurnHistoryEntry[] = [],
  brejoSignals: TrioState["brejoSignals"] = [],
): TrioState {
  return {
    mode: "trio",
    participants: [ryo(), kei(), saki()],
    turnHistory: history,
    brejoSignals,
  };
}

function dyadState(
  history: TurnHistoryEntry[] = [],
  brejoSignals: TrioState["brejoSignals"] = [],
): TrioState {
  return {
    mode: "dyad",
    participants: [ryo(), kei()],
    turnHistory: history,
    brejoSignals,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// computeTurnDistribution
// ─────────────────────────────────────────────────────────────────────────

describe("computeTurnDistribution", () => {
  it("retorna zero counts em história vazia", () => {
    const result = computeTurnDistribution([]);
    expect(result.botCount).toBe(0);
    expect(result.total).toBe(0);
    expect(result.perPersona).toEqual({});
  });

  it("agrega per-persona e bot count separadamente", () => {
    const history = [
      botTurn(1),
      childTurn(1, "ryo"),
      childTurn(1, "kei"),
      childTurn(2, "ryo"),
    ];
    const result = computeTurnDistribution(history);
    expect(result.botCount).toBe(1);
    expect(result.total).toBe(4);
    expect(result.perPersona).toEqual({ ryo: 2, kei: 1 });
  });

  it("respeita rolling window (slice tail)", () => {
    const history: TurnHistoryEntry[] = [];
    for (let i = 1; i <= 15; i++) {
      history.push(childTurn(i, "ryo"));
    }
    const result = computeTurnDistribution(history, 10);
    expect(result.total).toBe(10);
    expect(result.perPersona.ryo).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Bot turn ratio enforcement (§10.1 + §11.1)
// ─────────────────────────────────────────────────────────────────────────

describe("bot turn ratio enforcement — §11.1 trio", () => {
  it("trio: ratio 0% (5 child turns, 0 bot) → bot pode falar", () => {
    const history = [
      childTurn(1, "ryo"),
      childTurn(1, "kei"),
      childTurn(1, "saki"),
      childTurn(2, "ryo"),
      childTurn(2, "kei"),
    ];
    const { shouldBotSpeak } = shouldBotTakeTurn(trioState(history), DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(shouldBotSpeak).toBe(true);
  });

  it("trio: ratio 20% (1 bot / 5 total) → bot bloqueado (≥ cap)", () => {
    const history = [
      botTurn(1),
      childTurn(1, "ryo"),
      childTurn(1, "kei"),
      childTurn(1, "saki"),
      childTurn(2, "ryo"),
    ];
    const { shouldBotSpeak, warnings } = shouldBotTakeTurn(
      trioState(history),
      DEFAULT_TRIO_RUNTIME_CONFIG,
    );
    expect(shouldBotSpeak).toBe(false);
    expect(warnings.some((w) => w.kind === "bot_ratio_exceeded")).toBe(true);
  });

  it("trio: em 10 turns com cap 0.20 → max ~2 bot turns aceitáveis", () => {
    // Compose 10 turns: 2 bot + 8 child. Ratio = 0.2 (no limite).
    const history: TurnHistoryEntry[] = [];
    history.push(botTurn(1));
    for (let i = 0; i < 4; i++) history.push(childTurn(1, ["ryo", "kei", "saki", "ryo"][i]));
    history.push(botTurn(2));
    for (let i = 0; i < 4; i++) history.push(childTurn(2, ["kei", "saki", "ryo", "kei"][i]));
    const { shouldBotSpeak } = shouldBotTakeTurn(trioState(history), DEFAULT_TRIO_RUNTIME_CONFIG);
    // Ratio = 2/10 = 0.20 — cap é < 0.20, então 0.20 ≥ 0.20 bloqueia (estrita).
    expect(shouldBotSpeak).toBe(false);
  });

  it("dyad cap 0.25 mais permissivo que trio 0.20", () => {
    // Compose 4 turns: 1 bot + 3 child. Ratio = 0.25.
    const history = [botTurn(1), childTurn(1, "ryo"), childTurn(1, "kei"), childTurn(2, "ryo")];
    const trioResult = shouldBotTakeTurn(
      { ...dyadState(history), mode: "trio" },
      DEFAULT_TRIO_RUNTIME_CONFIG,
    );
    expect(trioResult.shouldBotSpeak).toBe(false); // 0.25 > 0.20

    const dyadResult = shouldBotTakeTurn(dyadState(history), DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(dyadResult.shouldBotSpeak).toBe(false); // 0.25 ≥ 0.25 → bloqueado (estrita)
  });

  it("bot na história vazia → fala (Round 0 abertura)", () => {
    const { shouldBotSpeak } = shouldBotTakeTurn(trioState([]), DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(shouldBotSpeak).toBe(true);
  });

  it("max_consecutive_bot_turns (§10.2) bloqueia 2+ seguidos", () => {
    const history = [
      childTurn(1, "ryo"),
      botTurn(2),
      botTurn(3), // 2 bot seguidos — atinge max
    ];
    const { shouldBotSpeak, warnings } = shouldBotTakeTurn(
      trioState(history),
      DEFAULT_TRIO_RUNTIME_CONFIG,
    );
    expect(shouldBotSpeak).toBe(false);
    expect(warnings.some((w) => w.kind === "consecutive_bot_turns_exceeded")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Dominance detection (§10.4 + §11.2)
// ─────────────────────────────────────────────────────────────────────────

describe("detectDominance — §11.2 trio threshold 0.50", () => {
  it("trio: 60% turns por 1 persona → dominância detectada", () => {
    const history = [
      childTurn(1, "ryo"),
      childTurn(1, "ryo"),
      childTurn(1, "ryo"),
      childTurn(2, "kei"),
      childTurn(2, "saki"),
    ];
    // ryo = 3/5 = 60% > 50% trio threshold
    const warnings = detectDominance(trioState(history), DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(warnings.length).toBe(1);
    expect(warnings[0].personaId).toBe("ryo");
    expect(warnings[0].kind).toBe("dominance_detected");
  });

  it("trio: 40% turns por 1 persona → SEM dominância (abaixo threshold)", () => {
    const history = [
      childTurn(1, "ryo"),
      childTurn(1, "ryo"),
      childTurn(2, "kei"),
      childTurn(2, "kei"),
      childTurn(3, "saki"),
    ];
    // ryo + kei = 2/5 = 40% cada
    const warnings = detectDominance(trioState(history), DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(warnings.length).toBe(0);
  });

  it("dyad: 50% turns NÃO é dominância (threshold 0.60 dyad)", () => {
    const history = [
      childTurn(1, "ryo"),
      childTurn(1, "kei"),
      childTurn(2, "ryo"),
      childTurn(2, "kei"),
    ];
    // ryo = 2/4 = 50% < 60% dyad threshold
    const warnings = detectDominance(dyadState(history), DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(warnings.length).toBe(0);
  });

  it("dyad: 75% turns por 1 persona → dominância", () => {
    const history = [
      childTurn(1, "ryo"),
      childTurn(1, "ryo"),
      childTurn(1, "ryo"),
      childTurn(2, "kei"),
    ];
    // ryo = 3/4 = 75% > 60%
    const warnings = detectDominance(dyadState(history), DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(warnings.length).toBe(1);
    expect(warnings[0].personaId).toBe("ryo");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Absence detection per-persona (§11.3)
// ─────────────────────────────────────────────────────────────────────────

describe("detectAbsence — per-persona threshold", () => {
  it("Saki silenciosa 4 rounds → SEM warning (threshold 5)", () => {
    const history = [
      childTurn(1, "saki"),
      childTurn(2, "ryo"),
      childTurn(3, "kei"),
      childTurn(4, "ryo"),
      childTurn(5, "kei"),
    ];
    // current round = 5, saki last spoke round 1, silent = 4
    const warnings = detectAbsence(trioState(history), DEFAULT_TRIO_RUNTIME_CONFIG);
    const sakiWarning = warnings.find((w) => w.personaId === "saki");
    expect(sakiWarning).toBeUndefined();
  });

  it("Saki silenciosa 5 rounds → warning fires (threshold atingido)", () => {
    const history = [
      childTurn(1, "saki"),
      childTurn(2, "ryo"),
      childTurn(3, "kei"),
      childTurn(4, "ryo"),
      childTurn(5, "kei"),
      childTurn(6, "ryo"),
    ];
    // current = 6, saki last = 1, silent = 5
    const warnings = detectAbsence(trioState(history), DEFAULT_TRIO_RUNTIME_CONFIG);
    const sakiWarning = warnings.find((w) => w.personaId === "saki");
    expect(sakiWarning).toBeDefined();
    expect(sakiWarning?.value).toBe(5);
  });

  it("Ryo silencioso 3 rounds (default threshold) → warning fires", () => {
    const history = [
      childTurn(1, "ryo"),
      childTurn(2, "kei"),
      childTurn(3, "saki"),
      childTurn(4, "kei"),
    ];
    // current = 4, ryo last = 1, silent = 3
    const warnings = detectAbsence(trioState(history), DEFAULT_TRIO_RUNTIME_CONFIG);
    const ryoWarning = warnings.find((w) => w.personaId === "ryo");
    expect(ryoWarning).toBeDefined();
    expect(ryoWarning?.value).toBe(3);
  });

  it("Ryo silencioso 2 rounds → SEM warning (abaixo threshold)", () => {
    const history = [
      childTurn(1, "ryo"),
      childTurn(2, "kei"),
      childTurn(3, "saki"),
    ];
    const warnings = detectAbsence(trioState(history), DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(warnings.find((w) => w.personaId === "ryo")).toBeUndefined();
  });

  it("absenceThresholdFor: participant override > config override > default", () => {
    const config: TrioRuntimeConfig = {
      ...DEFAULT_TRIO_RUNTIME_CONFIG,
      absence_threshold_rounds_overrides: { ryo: 7 },
    };
    // Saki tem override no profile (silence_tolerance_rounds=5)
    expect(absenceThresholdFor(saki(), config)).toBe(5);
    // Ryo tem override no config (7)
    expect(absenceThresholdFor(ryo(), config)).toBe(7);
    // Kei usa default (3)
    expect(absenceThresholdFor(kei(), config)).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Brejo pause policy (§11.4)
// ─────────────────────────────────────────────────────────────────────────

describe("decideBrejoPause — §11.4 trio split", () => {
  it("trio: sensory Saki brejo → partial pause (exclui Saki só)", () => {
    const state = trioState(
      [childTurn(1, "ryo")],
      [{ personaId: "saki", type: "sensory" }],
    );
    const decision = decideBrejoPause(state, DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(decision.pause).toBe("partial");
    expect(decision.excludedParticipants).toEqual(["saki"]);
  });

  it("trio: emocional any → full pause", () => {
    const state = trioState(
      [childTurn(1, "ryo")],
      [{ personaId: "kei", type: "emotional" }],
    );
    const decision = decideBrejoPause(state, DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(decision.pause).toBe("full");
    expect(decision.excludedParticipants).toEqual([]);
  });

  it("trio: sensory Ryo (sem regulation_strategy=sensory) → full (precaução)", () => {
    const state = trioState(
      [childTurn(1, "kei")],
      [{ personaId: "ryo", type: "sensory" }],
    );
    const decision = decideBrejoPause(state, DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(decision.pause).toBe("full");
  });

  it("dyad: any brejo (sensory ou emotional) → full (§10.6 inalterada)", () => {
    const state = dyadState(
      [childTurn(1, "ryo")],
      [{ personaId: "kei", type: "sensory" }],
    );
    const decision = decideBrejoPause(state, DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(decision.pause).toBe("full");
  });

  it("sem brejo signals → none", () => {
    const state = trioState([childTurn(1, "ryo")], []);
    const decision = decideBrejoPause(state, DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(decision.pause).toBe("none");
  });

  it("emocional vence sensory quando ambos presentes (gate ordering)", () => {
    const state = trioState(
      [childTurn(1, "ryo")],
      [
        { personaId: "saki", type: "sensory" },
        { personaId: "kei", type: "emotional" },
      ],
    );
    const decision = decideBrejoPause(state, DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(decision.pause).toBe("full");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// pickNextChild — weighted round-robin
// ─────────────────────────────────────────────────────────────────────────

describe("pickNextChild — weighted round-robin", () => {
  it("escolhe quem falou menos", () => {
    const state = trioState([
      childTurn(1, "ryo"),
      childTurn(1, "ryo"),
      childTurn(1, "kei"),
    ]);
    // saki=0, kei=1, ryo=2 → saki primeiro
    const next = pickNextChild(state, DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(next).toBe("saki");
  });

  it("tie-break: tolerance menor ganha priority (Ryo > Saki)", () => {
    const state = trioState([]);
    // Todos 0 turns; Saki tem tolerance 5, Ryo/Kei = 3 → Ryo (alphabetical)
    const next = pickNextChild(state, DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(["kei", "ryo"]).toContain(next);
    expect(next).not.toBe("saki"); // Saki tolerance > → menor priority
  });

  it("respeita excluded list (Saki em sensory pause)", () => {
    const state = trioState([]);
    const next = pickNextChild(state, DEFAULT_TRIO_RUNTIME_CONFIG, ["saki"]);
    expect(next).not.toBe("saki");
  });

  it("absence flag eleva priority dentro do bucket", () => {
    const state = trioState([
      childTurn(1, "ryo"),
      childTurn(2, "kei"),
      childTurn(3, "kei"),
      childTurn(4, "kei"),
    ]);
    // current=4, ryo last=1, silent=3 → absence warning Ryo
    // kei=3, ryo=1, saki=0 → saki seria default, mas ryo flagged
    const next = pickNextChild(state, DEFAULT_TRIO_RUNTIME_CONFIG);
    expect(next).toBe("ryo");
  });

  it("retorna undefined se todos excluídos", () => {
    const state = trioState([]);
    const next = pickNextChild(state, DEFAULT_TRIO_RUNTIME_CONFIG, [
      "ryo",
      "kei",
      "saki",
    ]);
    expect(next).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// decideNextSpeaker — pipeline composto
// ─────────────────────────────────────────────────────────────────────────

describe("decideNextSpeaker — full pipeline", () => {
  it("história vazia → bot abre (Round 0)", () => {
    const decision = decideNextSpeaker(trioState([]));
    expect(decision.target).toBe("bot");
  });

  it("emocional brejo → pause_full terminal", () => {
    const decision = decideNextSpeaker(
      trioState([childTurn(1, "ryo")], [{ personaId: "kei", type: "emotional" }]),
    );
    expect(decision.target).toBe("pause_full");
  });

  it("sensory Saki brejo → partial (continua com Ryo/Kei)", () => {
    const decision = decideNextSpeaker(
      trioState(
        [
          childTurn(1, "ryo"),
          childTurn(1, "kei"),
          childTurn(2, "ryo"),
          childTurn(2, "kei"),
        ],
        [{ personaId: "saki", type: "sensory" }],
      ),
    );
    // Bot ratio 0%, mas Saki em sensory pause → target child, exclude saki
    expect(decision.excludedParticipants).toContain("saki");
    expect(decision.nextSpeakerHint).not.toBe("saki");
  });

  it("turn distribution exposed pra observability", () => {
    const decision = decideNextSpeaker(
      trioState([
        childTurn(1, "ryo"),
        childTurn(1, "ryo"),
        childTurn(2, "kei"),
      ]),
    );
    expect(decision.turnDistribution).toEqual({ ryo: 2, kei: 1 });
    expect(decision.botTurnRatio).toBe(0);
  });

  it("dominância warning sem bloquear flow", () => {
    const decision = decideNextSpeaker(
      trioState([
        childTurn(1, "ryo"),
        childTurn(1, "ryo"),
        childTurn(2, "ryo"),
        childTurn(2, "kei"),
        childTurn(3, "saki"),
      ]),
    );
    // ryo = 60% — dominância warning, mas pipeline continua
    const domWarning = decision.warnings.find((w) => w.kind === "dominance_detected");
    expect(domWarning).toBeDefined();
    expect(decision.target).toMatch(/^(bot|child)$/);
  });

  it("bot ratio cap atingido → próximo turn é child", () => {
    const history = [
      botTurn(1),
      childTurn(1, "ryo"),
      childTurn(1, "kei"),
      childTurn(1, "saki"),
      childTurn(2, "ryo"),
    ];
    const decision = decideNextSpeaker(trioState(history));
    // ratio = 1/5 = 0.20, cap < 0.20 → bot bloqueado → child
    expect(decision.target).toBe("child");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Config loader — kids.group.playbook.yaml integration
// ─────────────────────────────────────────────────────────────────────────

describe("buildTrioConfigFromPlaybook", () => {
  it("extrai todos campos canon do playbook YAML", () => {
    const playbookYaml = {
      base_mixins: [
        {
          name: "withCrossing",
          config: {
            max_group_size: 3,
            moderation_rules: {
              max_consecutive_bot_turns: 2,
              bot_turn_ratio_dyad: 0.25,
              bot_turn_ratio_trio: 0.2,
              dominance_threshold_dyad: 0.6,
              dominance_threshold_trio: 0.5,
              absence_threshold_rounds_default: 3,
              absence_threshold_rounds_saki: 5,
              brejo_pause_policy_trio: {
                sensory_saki: "partial" as const,
                emotional_any: "full" as const,
              },
            },
          },
        },
      ],
    };
    const config = buildTrioConfigFromPlaybook(playbookYaml);
    expect(config.max_group_size).toBe(3);
    expect(config.bot_turn_ratio_trio).toBe(0.2);
    expect(config.dominance_threshold_trio).toBe(0.5);
    expect(config.absence_threshold_rounds_overrides.saki).toBe(5);
    expect(config.brejo_pause_policy_trio.sensory_saki).toBe("partial");
  });

  it("campos ausentes caem em DEFAULT_TRIO_RUNTIME_CONFIG", () => {
    const config = buildTrioConfigFromPlaybook({});
    expect(config.bot_turn_ratio_trio).toBe(
      DEFAULT_TRIO_RUNTIME_CONFIG.bot_turn_ratio_trio,
    );
    expect(config.absence_threshold_rounds_default).toBe(
      DEFAULT_TRIO_RUNTIME_CONFIG.absence_threshold_rounds_default,
    );
  });

  it("personaIdAliases mapeia 'saki' → custom id (e.g. saki-ochiai)", () => {
    const playbookYaml = {
      base_mixins: [
        {
          name: "withCrossing",
          config: {
            moderation_rules: { absence_threshold_rounds_saki: 5 },
          },
        },
      ],
    };
    const config = buildTrioConfigFromPlaybook(playbookYaml, {
      saki: "saki-ochiai",
    });
    expect(config.absence_threshold_rounds_overrides["saki-ochiai"]).toBe(5);
    expect(config.absence_threshold_rounds_overrides.saki).toBeUndefined();
  });

  it("integra com kids.group.playbook.yaml canônico (se presente)", () => {
    // Procura o playbook canon em vários locais — tolerant pra dev local.
    const candidates = [
      "/home/alexa/ascendimacy-ops/docs/playbooks/kids.group.playbook.yaml",
    ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) {
      // Skip se ops repo não acessível neste ambiente.
      return;
    }
    const raw = readFileSync(found, "utf-8");
    const parsed = yaml.load(raw);
    const config = buildTrioConfigFromPlaybook(parsed);
    expect(config.max_group_size).toBe(3);
    expect(config.bot_turn_ratio_trio).toBe(0.2);
    expect(config.dominance_threshold_trio).toBe(0.5);
    expect(config.brejo_pause_policy_trio.sensory_saki).toBe("partial");
  });
});

describe("modeFromParticipantCount", () => {
  it("2 → dyad, 3 → trio, 4+ → trio (precaução)", () => {
    expect(modeFromParticipantCount(2)).toBe("dyad");
    expect(modeFromParticipantCount(3)).toBe("trio");
    expect(modeFromParticipantCount(4)).toBe("trio");
    expect(modeFromParticipantCount(1)).toBe("dyad");
  });
});

describe("DEFAULT_ROLLING_WINDOW", () => {
  it("default = 10 (CC default Jun ratify pending)", () => {
    expect(DEFAULT_ROLLING_WINDOW).toBe(10);
  });
});
