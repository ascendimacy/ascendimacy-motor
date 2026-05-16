/**
 * Trio runtime engine — pure state-machine (ops#1086).
 *
 * Funções puras: dado `TrioState` + `TrioRuntimeConfig`, decide
 * quem fala próximo, quem flagrar por dominância, quem pingar por
 * absence, e se a dinâmica deve pausar (full/partial) por brejo.
 *
 * Sem IO, sem LLM, sem persistência — caller monta state a partir
 * do session event_log + persona profiles + statusMatrix, chama
 * `decideNextSpeaker(state, config)`, e roteia conforme decision.
 *
 * Doctrine: ascendimacy-ops/docs/fundamentos/ebrota-kids-dinamicas-grupo.md
 *   §10 (dyad invariantes) + §11 (trio overrides Saki entry).
 * Config schema: ascendimacy-ops/docs/playbooks/kids.group.playbook.yaml
 *
 * CC defaults aplicados (ratify Jun ops#1086):
 *   - Rolling window: últimos 10 turns (cobre ~2 cycles em trio)
 *   - Bot child-target hint: weighted round-robin entre não-dominantes
 *     (rank por inverso de turn count; tie-break alfabético por id)
 *   - Brejo signal source: caller compõe BrejoSignal[] a partir de
 *     statusMatrix.emotional + persona.profile.regulation_strategy
 *
 * Cross-ref: motor#122 (Saki fixture), ops#1090 (docs + playbook canon).
 */

import {
  DEFAULT_TRIO_RUNTIME_CONFIG,
  type BrejoSignal,
  type GroupMode,
  type TrioDecision,
  type TrioParticipant,
  type TrioRuntimeConfig,
  type TrioState,
  type TrioWarning,
  type TurnHistoryEntry,
} from "@ascendimacy/shared";

/**
 * Rolling window size for dominance + bot ratio computation.
 * CC default ratify Jun pending: 10 turns ≈ 2 cycles trio
 * (5 turns/cycle com bot_turn_ratio=0.20).
 *
 * Justificativa: window <6 reagiria errático a flutuação normal.
 * Window >20 demora demais pra refletir mudança comportamental
 * (criança que muda de envolvido pra dominador em 1 rodada).
 */
export const DEFAULT_ROLLING_WINDOW = 10;

/**
 * Computa distribuição de turns por persona dentro da window.
 * Bot turns são agregados separadamente.
 *
 * Retorna `{ perPersona, botCount, total }`.
 */
export function computeTurnDistribution(
  turnHistory: TurnHistoryEntry[],
  windowSize: number = DEFAULT_ROLLING_WINDOW,
): {
  perPersona: Record<string, number>;
  botCount: number;
  total: number;
} {
  const window = turnHistory.slice(-windowSize);
  const perPersona: Record<string, number> = {};
  let botCount = 0;
  for (const entry of window) {
    if (entry.speakerType === "bot") {
      botCount += 1;
    } else if (entry.personaId) {
      perPersona[entry.personaId] = (perPersona[entry.personaId] ?? 0) + 1;
    }
  }
  return { perPersona, botCount, total: window.length };
}

/**
 * Detecta dominância: persona cujo ratio > threshold (mode-dependent).
 *
 * Saki caveat (§11.2): regulation_strategy=="sensory" não dispara
 * dominância — Saki silenciosa é autorregulação, mas Saki **falando
 * demais** ainda flagra (raro mas válido).
 *
 * Retorna lista de warnings — vazia se ninguém dominando.
 */
export function detectDominance(
  state: TrioState,
  config: TrioRuntimeConfig,
  windowSize: number = DEFAULT_ROLLING_WINDOW,
): TrioWarning[] {
  const { perPersona, total } = computeTurnDistribution(state.turnHistory, windowSize);
  if (total === 0) return [];
  const threshold =
    state.mode === "trio"
      ? config.dominance_threshold_trio
      : config.dominance_threshold_dyad;
  const warnings: TrioWarning[] = [];
  for (const [personaId, count] of Object.entries(perPersona)) {
    const ratio = count / total;
    if (ratio > threshold) {
      warnings.push({
        kind: "dominance_detected",
        personaId,
        reason: `persona ${personaId} ${(ratio * 100).toFixed(1)}% > threshold ${(threshold * 100).toFixed(0)}% (${state.mode})`,
        value: ratio,
      });
    }
  }
  return warnings;
}

/**
 * Detecta absence: persona silenciosa por ≥ threshold rounds (per-persona).
 *
 * Rounds são distintos de turns: 1 round = bot prompt + child responses.
 * Aqui aproximamos round-count via `max(round)` no histórico recente,
 * comparando contra last_round_in_which_persona_spoke.
 *
 * Retorna lista de warnings (vazia se ninguém ausente).
 */
export function detectAbsence(
  state: TrioState,
  config: TrioRuntimeConfig,
): TrioWarning[] {
  if (state.turnHistory.length === 0) return [];
  const currentRound = Math.max(...state.turnHistory.map((e) => e.round));
  const warnings: TrioWarning[] = [];
  for (const participant of state.participants) {
    const threshold = absenceThresholdFor(participant, config);
    const lastTurn = [...state.turnHistory]
      .reverse()
      .find((e) => e.speakerType === "child" && e.personaId === participant.personaId);
    const lastSpokenRound = lastTurn?.round ?? 0;
    const silentRounds = currentRound - lastSpokenRound;
    if (silentRounds >= threshold) {
      warnings.push({
        kind: "absence_detected",
        personaId: participant.personaId,
        reason: `persona ${participant.personaId} silenciosa há ${silentRounds} rounds (threshold ${threshold})`,
        value: silentRounds,
      });
    }
  }
  return warnings;
}

/**
 * Resolve threshold de absence pra um participant.
 *
 * Ordem de precedência:
 *  1. Override no `participant.silence_tolerance_rounds`
 *  2. Override per-persona em `config.absence_threshold_rounds_overrides`
 *  3. Default `config.absence_threshold_rounds_default`
 */
export function absenceThresholdFor(
  participant: TrioParticipant,
  config: TrioRuntimeConfig,
): number {
  if (typeof participant.silence_tolerance_rounds === "number") {
    return participant.silence_tolerance_rounds;
  }
  const override = config.absence_threshold_rounds_overrides[participant.personaId];
  if (typeof override === "number") return override;
  return config.absence_threshold_rounds_default;
}

/**
 * Decide brejo pause policy (§11.4).
 *
 * Em trio:
 *  - Qualquer brejo emocional → full pause (override §10.6)
 *  - Brejo sensorial em participant com regulation_strategy=="sensory"
 *    → partial pause (skip esse participant; outros continuam)
 *  - Brejo sensorial em participant SEM regulation_strategy=="sensory"
 *    → tratado como full (precaução; doctrine não cobre case)
 *
 * Em dyad:
 *  - Qualquer brejo (emocional ou sensorial) → full pause (§10.6)
 *
 * Retorna `{ pause: "none" | "partial" | "full", excludedParticipants: string[] }`.
 */
export function decideBrejoPause(
  state: TrioState,
  config: TrioRuntimeConfig,
): {
  pause: "none" | "partial" | "full";
  excludedParticipants: string[];
} {
  if (state.brejoSignals.length === 0) {
    return { pause: "none", excludedParticipants: [] };
  }

  // Emocional brejo → full pause (qualquer modo).
  const emotionalBrejo = state.brejoSignals.find((s) => s.type === "emotional");
  if (emotionalBrejo) {
    return { pause: "full", excludedParticipants: [] };
  }

  // Dyad: any-brejo → full (§10.6 doctrine inalterada).
  if (state.mode === "dyad") {
    return { pause: "full", excludedParticipants: [] };
  }

  // Trio: brejo sensorial split per participant regulation_strategy.
  const partialExcluded: string[] = [];
  for (const signal of state.brejoSignals) {
    const participant = state.participants.find(
      (p) => p.personaId === signal.personaId,
    );
    if (!participant) continue;
    if (
      signal.type === "sensory" &&
      participant.regulation_strategy === "sensory" &&
      config.brejo_pause_policy_trio.sensory_saki === "partial"
    ) {
      partialExcluded.push(participant.personaId);
    } else {
      // Sensory sem regulation_strategy match → precaução = full.
      return { pause: "full", excludedParticipants: [] };
    }
  }

  if (partialExcluded.length === 0) {
    return { pause: "none", excludedParticipants: [] };
  }
  // Se TODOS os participants estão excluded, vira full pra evitar bot-monólogo.
  if (partialExcluded.length >= state.participants.length) {
    return { pause: "full", excludedParticipants: [] };
  }
  return { pause: "partial", excludedParticipants: partialExcluded };
}

/**
 * Decide se o bot deve falar este turn baseado em bot_turn_ratio cap
 * (§10.1 dyad < 0.25, §11.1 trio < 0.20) + max_consecutive_bot_turns
 * (§10.2 default 2).
 *
 * Retorna `{ shouldBotSpeak, warnings }`.
 *
 * Bot speaks quando:
 *  - Histórico vazio (round 0 inicial), OU
 *  - bot ratio observado < threshold E não excedeu max_consecutive
 *
 * Caller usa esse hint pra alternar entre bot prompt vs pick child target.
 */
export function shouldBotTakeTurn(
  state: TrioState,
  config: TrioRuntimeConfig,
  windowSize: number = DEFAULT_ROLLING_WINDOW,
): {
  shouldBotSpeak: boolean;
  warnings: TrioWarning[];
} {
  const warnings: TrioWarning[] = [];
  const cap =
    state.mode === "trio"
      ? config.bot_turn_ratio_trio
      : config.bot_turn_ratio_dyad;

  if (state.turnHistory.length === 0) {
    // Round 0 inicial: bot abre dinâmica (Round 0 doctrine §4.3).
    return { shouldBotSpeak: true, warnings };
  }

  const { botCount, total } = computeTurnDistribution(state.turnHistory, windowSize);
  const observedRatio = total === 0 ? 0 : botCount / total;

  // Consecutive bot turns check (§10.2)
  let trailingBotConsecutive = 0;
  for (let i = state.turnHistory.length - 1; i >= 0; i--) {
    if (state.turnHistory[i].speakerType === "bot") trailingBotConsecutive += 1;
    else break;
  }
  if (trailingBotConsecutive >= config.max_consecutive_bot_turns) {
    warnings.push({
      kind: "consecutive_bot_turns_exceeded",
      reason: `bot falou ${trailingBotConsecutive} turns seguidos (max ${config.max_consecutive_bot_turns})`,
      value: trailingBotConsecutive,
    });
    return { shouldBotSpeak: false, warnings };
  }

  if (observedRatio >= cap) {
    warnings.push({
      kind: "bot_ratio_exceeded",
      reason: `bot ratio ${(observedRatio * 100).toFixed(1)}% ≥ cap ${(cap * 100).toFixed(0)}% (${state.mode})`,
      value: observedRatio,
    });
    return { shouldBotSpeak: false, warnings };
  }
  return { shouldBotSpeak: true, warnings };
}

/**
 * Escolhe próximo speaker entre participants — weighted round-robin
 * inverso (quem falou menos tem prioridade).
 *
 * Tie-break: persona com `silence_tolerance_rounds > default` (Saki)
 * **NÃO** ganha priority — evita over-pinging quem tolera mais silêncio
 * (CC default ratify Jun §11.3). Tie restante por ordem alfabética
 * do persona_id (determinístico, sem RNG).
 *
 * Exclui personas em `excluded` (ex: Saki em sensory partial-pause).
 *
 * Retorna persona_id ou undefined se todos excluídos.
 */
export function pickNextChild(
  state: TrioState,
  config: TrioRuntimeConfig,
  excluded: string[] = [],
  windowSize: number = DEFAULT_ROLLING_WINDOW,
): string | undefined {
  const eligible = state.participants.filter(
    (p) => !excluded.includes(p.personaId),
  );
  if (eligible.length === 0) return undefined;
  if (eligible.length === 1) return eligible[0].personaId;

  const { perPersona } = computeTurnDistribution(state.turnHistory, windowSize);
  const defaultThreshold = config.absence_threshold_rounds_default;

  const ranked = [...eligible].sort((a, b) => {
    const aCount = perPersona[a.personaId] ?? 0;
    const bCount = perPersona[b.personaId] ?? 0;
    // Menos falado primeiro
    if (aCount !== bCount) return aCount - bCount;
    // Tie-break: persona que tolera MENOS silêncio ganha priority
    // (evita over-pinging Saki que tolera mais silêncio).
    const aTol = absenceThresholdFor(a, config);
    const bTol = absenceThresholdFor(b, config);
    if (aTol !== bTol) return aTol - bTol;
    // Tie-break final: alfabético por id (determinístico).
    return a.personaId.localeCompare(b.personaId);
  });

  // Se há absence flag, prefer flagged-absent over não-flagged
  // (dentro do mesmo bucket de turn-count).
  const absenceWarnings = detectAbsence(state, config);
  const absentIds = new Set(
    absenceWarnings.map((w) => w.personaId).filter((id): id is string => !!id),
  );
  const absentInRank = ranked.find(
    (p) => absentIds.has(p.personaId) && !excluded.includes(p.personaId),
  );
  if (absentInRank) return absentInRank.personaId;

  // Avoid picking same speaker as last turn (consecutive child turns OK,
  // mas tentar rotacionar quando possível).
  const lastEntry = state.turnHistory[state.turnHistory.length - 1];
  if (lastEntry?.speakerType === "child" && ranked.length >= 2) {
    const nonRepeat = ranked.find((p) => p.personaId !== lastEntry.personaId);
    if (nonRepeat) {
      // Só pula o último speaker se mantém priority (turn count) compatível.
      const topCount = perPersona[ranked[0].personaId] ?? 0;
      const candidateCount = perPersona[nonRepeat.personaId] ?? 0;
      if (candidateCount === topCount) return nonRepeat.personaId;
    }
  }

  return ranked[0].personaId;
}

/**
 * Decisão composta: orquestra todas as primitivas.
 *
 * Pipeline:
 *  1. Detecta brejo pause (gate inicial — terminal se full)
 *  2. Detecta dominance + absence (warnings agregados)
 *  3. Decide se bot fala (ratio cap + consecutive)
 *  4. Se não-bot: pick next child target (excluding pause-excluded)
 *
 * Returns full `TrioDecision` pronto pra caller logar/rotear.
 */
export function decideNextSpeaker(
  state: TrioState,
  config: TrioRuntimeConfig = DEFAULT_TRIO_RUNTIME_CONFIG,
  windowSize: number = DEFAULT_ROLLING_WINDOW,
): TrioDecision {
  const { perPersona, botCount, total } = computeTurnDistribution(
    state.turnHistory,
    windowSize,
  );
  const botTurnRatio = total === 0 ? 0 : botCount / total;

  // 1. Brejo pause gate.
  const brejoDecision = decideBrejoPause(state, config);
  if (brejoDecision.pause === "full") {
    return {
      target: "pause_full",
      excludedParticipants: [],
      warnings: [],
      turnDistribution: perPersona,
      botTurnRatio,
    };
  }

  // 2. Detect warnings (dominance + absence — sempre roda, não-blocking).
  const dominanceWarnings = detectDominance(state, config, windowSize);
  const absenceWarnings = detectAbsence(state, config);
  const allWarnings = [...dominanceWarnings, ...absenceWarnings];

  // 3. Decide bot vs child.
  const botDecision = shouldBotTakeTurn(state, config, windowSize);
  allWarnings.push(...botDecision.warnings);

  if (brejoDecision.pause === "partial") {
    // Partial pause: continua dinâmica mas exclui targets.
    // Se bot ia falar mesmo: bot speaks (mas evita endereçar excluded).
    if (botDecision.shouldBotSpeak) {
      return {
        target: "bot",
        excludedParticipants: brejoDecision.excludedParticipants,
        warnings: allWarnings,
        turnDistribution: perPersona,
        botTurnRatio,
      };
    }
    const nextChild = pickNextChild(
      state,
      config,
      brejoDecision.excludedParticipants,
      windowSize,
    );
    if (nextChild === undefined) {
      // Nenhum child elegível pós-exclusion: bot toma turn (ou caller decide).
      return {
        target: "pause_partial",
        excludedParticipants: brejoDecision.excludedParticipants,
        warnings: allWarnings,
        turnDistribution: perPersona,
        botTurnRatio,
      };
    }
    return {
      target: "child",
      nextSpeakerHint: nextChild,
      excludedParticipants: brejoDecision.excludedParticipants,
      warnings: allWarnings,
      turnDistribution: perPersona,
      botTurnRatio,
    };
  }

  // 4. Caminho normal (no pause).
  if (botDecision.shouldBotSpeak) {
    return {
      target: "bot",
      excludedParticipants: [],
      warnings: allWarnings,
      turnDistribution: perPersona,
      botTurnRatio,
    };
  }
  const nextChild = pickNextChild(state, config, [], windowSize);
  if (nextChild === undefined) {
    // Caso degenerado: nenhum participant — caller checa.
    return {
      target: "bot",
      excludedParticipants: [],
      warnings: allWarnings,
      turnDistribution: perPersona,
      botTurnRatio,
    };
  }
  return {
    target: "child",
    nextSpeakerHint: nextChild,
    excludedParticipants: [],
    warnings: allWarnings,
    turnDistribution: perPersona,
    botTurnRatio,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Config loader — extrai TrioRuntimeConfig de kids.group.playbook.yaml
// ─────────────────────────────────────────────────────────────────────────

/**
 * Shape esperado do YAML moderation_rules (subset relevante).
 * Tolerant: campos ausentes caem em `DEFAULT_TRIO_RUNTIME_CONFIG`.
 */
interface PlaybookYamlShape {
  base_mixins?: Array<{
    name?: string;
    config?: {
      max_group_size?: number;
      moderation_rules?: {
        max_consecutive_bot_turns?: number;
        bot_turn_ratio_dyad?: number;
        bot_turn_ratio_trio?: number;
        dominance_threshold_dyad?: number;
        dominance_threshold_trio?: number;
        absence_threshold_rounds_default?: number;
        absence_threshold_rounds_saki?: number;
        brejo_pause_policy_trio?: {
          sensory_saki?: "partial" | "full";
          emotional_any?: "partial" | "full";
        };
      };
    };
  }>;
}

/**
 * Constrói `TrioRuntimeConfig` a partir do parsed YAML.
 *
 * Per-persona absence overrides: hardcoded canon → `saki` mapping
 * pra `absence_threshold_rounds_saki` campo do YAML. Caller pode
 * estender o overrides map pós-load (mutação direta).
 *
 * Spec note: schema YAML usa `absence_threshold_rounds_saki` como
 * Saki-specific override; runtime mapeia pra
 * `absence_threshold_rounds_overrides["saki"]`. Persona id "saki"
 * canonical (fixture: saki-ochiai → mas runtime lookup é por p.personaId).
 */
export function buildTrioConfigFromPlaybook(
  yamlData: unknown,
  personaIdAliases: { saki?: string } = {},
): TrioRuntimeConfig {
  const data = yamlData as PlaybookYamlShape;
  const withCrossing = data.base_mixins?.find((m) => m?.name === "withCrossing");
  const cfg = withCrossing?.config;
  const rules = cfg?.moderation_rules ?? {};

  const overrides: Record<string, number> = {};
  if (typeof rules.absence_threshold_rounds_saki === "number") {
    const sakiKey = personaIdAliases.saki ?? "saki";
    overrides[sakiKey] = rules.absence_threshold_rounds_saki;
  }

  return {
    max_group_size:
      cfg?.max_group_size ?? DEFAULT_TRIO_RUNTIME_CONFIG.max_group_size,
    bot_turn_ratio_dyad:
      rules.bot_turn_ratio_dyad ?? DEFAULT_TRIO_RUNTIME_CONFIG.bot_turn_ratio_dyad,
    bot_turn_ratio_trio:
      rules.bot_turn_ratio_trio ?? DEFAULT_TRIO_RUNTIME_CONFIG.bot_turn_ratio_trio,
    dominance_threshold_dyad:
      rules.dominance_threshold_dyad ??
      DEFAULT_TRIO_RUNTIME_CONFIG.dominance_threshold_dyad,
    dominance_threshold_trio:
      rules.dominance_threshold_trio ??
      DEFAULT_TRIO_RUNTIME_CONFIG.dominance_threshold_trio,
    absence_threshold_rounds_default:
      rules.absence_threshold_rounds_default ??
      DEFAULT_TRIO_RUNTIME_CONFIG.absence_threshold_rounds_default,
    absence_threshold_rounds_overrides: overrides,
    brejo_pause_policy_trio: {
      sensory_saki:
        rules.brejo_pause_policy_trio?.sensory_saki ??
        DEFAULT_TRIO_RUNTIME_CONFIG.brejo_pause_policy_trio.sensory_saki,
      emotional_any:
        rules.brejo_pause_policy_trio?.emotional_any ??
        DEFAULT_TRIO_RUNTIME_CONFIG.brejo_pause_policy_trio.emotional_any,
    },
    max_consecutive_bot_turns:
      rules.max_consecutive_bot_turns ??
      DEFAULT_TRIO_RUNTIME_CONFIG.max_consecutive_bot_turns,
  };
}

/**
 * Helper: resolve `GroupMode` a partir do número de participants.
 * 2 → dyad; 3 → trio; outros → trio (precaução, doctrine não cobre).
 */
export function modeFromParticipantCount(n: number): GroupMode {
  return n <= 2 ? "dyad" : "trio";
}
