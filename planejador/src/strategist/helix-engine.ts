/**
 * Helix Engine — Double Helix cycle state machine (G-05, ops#1091).
 *
 * Funções puras (sem side-effects, sem db). Caller (motor-execucao
 * state-manager) é responsável por persistência.
 *
 * Sub-decisões ratified Jun 2026-05-16 (ops#1091 comment 4468127426):
 *  1. Schema KidsHelixState — em `shared/src/contracts/kids-helix-state.ts`.
 *  2. 50% overlap rotation algorithm + initial pair fallback SA+SOC.
 *  3. State transitions canônicas (active→deferred via brejo/vacation/parental).
 *  4. Modo férias trigger compound (parental + brejo>5d + sacrifice 3+ + family).
 *
 * **Quem chama o quê**:
 *  - `cycleStart` — orchestrator on persona new OR on completeCycle when not vacation.
 *  - `dayAdvance` — orchestrator at end of session (1x por dia ativo).
 *  - `completeCycle` — orchestrator quando current_day chega ao TOTAL_DAYS-1.
 *  - `deferDimension` — orchestrator quando detecta brejo>3d/vacation/parental.
 *  - `resumeDimension` — orchestrator quando recovery confirmed.
 *  - `enterVacation` / `exitVacation` — orchestrator on modo-férias triggers.
 *  - `checkVacationTrigger` — orchestrator pre-cycle-start (sub-decisão 4).
 *  - `computeNextPair` — interno; usado por `completeCycle`.
 *
 * Refs: ops#1091 spec, ops#1020 G-07 (downstream blocker — consome
 * cycle_progress), ops#1033 G-22 (sacrifice exhaustion signal source).
 */

import type {
  CaselDimension,
  DreyfusLevel,
} from "@ascendimacy/shared";
import {
  DREYFUS_LEVELS,
  KIDS_HELIX_ACTIVE_DAYS,
  KIDS_HELIX_BOSS_FIGHT_TRIGGER_DAY,
  KIDS_HELIX_BREJO_DEFER_DAYS,
  KIDS_HELIX_BREJO_VACATION_DAYS,
  KIDS_HELIX_DEFAULT_FALLBACK_PAIR,
  KIDS_HELIX_EXTENSION_EVOLUTION_THRESHOLD,
  KIDS_HELIX_MIDCYCLE_ASSESSMENT_DAY,
  KIDS_HELIX_RETRIEVAL_TRIGGER_DAY,
  KIDS_HELIX_SACRIFICE_EXHAUSTION_SESSIONS,
  KIDS_HELIX_TOTAL_DAYS,
  defaultKidsHelixState,
  type CaselDimensionPair,
  type KidsHelixCadenceTrigger,
  type KidsHelixDeferReason,
  type KidsHelixExtensionRecommendation,
  type KidsHelixResumeReason,
  type KidsHelixState,
  type KidsHelixVacationTrigger,
} from "@ascendimacy/shared";

/** Todas as 5 dims CASEL canônicas. */
const ALL_CASEL_DIMS: CaselDimension[] = ["SA", "SM", "SOC", "REL", "DM"];

/**
 * Computa par inicial pra persona nova.
 *
 * Sub-decisão 2 ratified:
 *  - Highest-need (lowest statusMatrix value) + complementary-engagement
 *    (highest signal dim from G-02 baseline).
 *  - Fallback SA+SOC se nenhum baseline disponível (Brota Mestre foundational).
 *
 * Caller passa `statusMatrix` (lowest = highest-need) + opcional `engagementSignals`
 * (G-02 baseline). G-02 ainda não ratified em prod; fallback é caminho dominante hoje.
 *
 * @returns par de 2 dims distintas. Garantido never throw.
 */
export function computeInitialPair(args: {
  statusMatrix?: Record<string, string>;
  engagementSignals?: Partial<Record<CaselDimension, number>>;
}): CaselDimensionPair {
  // Highest-need: dim com pior status (brejo > baia > pasto).
  // Pontuação inversa: brejo=3, baia=2, pasto=1, ausente=2 (default).
  const statusScore = (val: string | undefined): number => {
    if (val === "brejo") return 3;
    if (val === "baia") return 2;
    if (val === "pasto") return 1;
    return 2;
  };
  const matrix = args.statusMatrix ?? {};
  const needRanked = [...ALL_CASEL_DIMS].sort((a, b) => {
    const diff = statusScore(matrix[b]) - statusScore(matrix[a]);
    if (diff !== 0) return diff;
    // Tie-break determinístico: ordem canônica SA, SM, SOC, REL, DM.
    return ALL_CASEL_DIMS.indexOf(a) - ALL_CASEL_DIMS.indexOf(b);
  });
  const highestNeed = needRanked[0]!;

  // Complementary: highest engagement (G-02). Fallback SOC se ausente / mesma dim.
  const signals = args.engagementSignals ?? {};
  const candidates = ALL_CASEL_DIMS.filter((d) => d !== highestNeed);
  const hasSignals = candidates.some((d) => typeof signals[d] === "number");
  if (!hasSignals) {
    // G-02 baseline ausente — usa fallback SA+SOC se highest-need é SA, caso
    // contrário pareia com SOC. Se highest-need já é SOC, pareia com SA.
    const fallbackPartner: CaselDimension = highestNeed === "SOC" ? "SA" : "SOC";
    if (highestNeed === fallbackPartner) {
      // Edge: não pode acontecer (sempre distintos por construção).
      return KIDS_HELIX_DEFAULT_FALLBACK_PAIR;
    }
    return [highestNeed, fallbackPartner];
  }
  const engagementRanked = [...candidates].sort((a, b) => {
    const diff = (signals[b] ?? 0) - (signals[a] ?? 0);
    if (diff !== 0) return diff;
    return ALL_CASEL_DIMS.indexOf(a) - ALL_CASEL_DIMS.indexOf(b);
  });
  return [highestNeed, engagementRanked[0]!];
}

/**
 * Cria estado inicial pra persona nova. Wrapper de `defaultKidsHelixState`
 * que resolve par via `computeInitialPair`.
 *
 * Idempotente em sentido funcional — sempre retorna mesmo state pra mesmo input.
 */
export function bootstrapKidsHelixState(args: {
  personaId: string;
  nowIso: string;
  statusMatrix?: Record<string, string>;
  engagementSignals?: Partial<Record<CaselDimension, number>>;
}): KidsHelixState {
  const firstPair = computeInitialPair({
    statusMatrix: args.statusMatrix,
    engagementSignals: args.engagementSignals,
  });
  return defaultKidsHelixState({
    personaId: args.personaId,
    nowIso: args.nowIso,
    firstPair,
  });
}

/**
 * Computa próximo par com 50% overlap (sub-decisão 2).
 *
 * Cycle N pair = [X, Y] → Cycle N+1 pair = [Y, Z] onde Z é primeiro da queue.
 * Reshuffle quando `completed.length === 5`: todos voltam pra queue, novo
 * par anchored em highest-engagement (caller passa signals via `engagementSignals`).
 *
 * @returns `{ pair, queue, completed }` — novo par + queues atualizadas.
 *          Edge: queue vazia E completed < 5 → mantém Y, repete (caller deve
 *          tratar como anomalia — só ocorre se defer drenar tudo).
 */
export function computeNextPair(args: {
  currentPair: CaselDimensionPair;
  queue: CaselDimension[];
  completed: CaselDimension[];
  engagementSignals?: Partial<Record<CaselDimension, number>>;
}): { pair: CaselDimensionPair; queue: CaselDimension[]; completed: CaselDimension[] } {
  const [, carry] = args.currentPair; // Y carry-over
  const previousCompletedPlusCurrent = uniqueAppend(args.completed, args.currentPair[0]);

  // Reshuffle: quando todas 5 dims foram "visitadas" (passaram pelo par ativo
  // pelo menos uma vez). Como Y carrega pra próximo ciclo só após X ir pra
  // completed, contamos: completed + X + Y. Se = 5 (todas), reshuffle.
  //
  // Spec lit "completed.length === 5": completed tracks X transitions only.
  // Após cycle 4 ([REL,DM]), completed=[SA,SOC,SM]+REL = 4; DM ainda em pair[1].
  // Cycle 5: X=DM → completed=[SA,SOC,SM,REL,DM]=5 → reshuffle.
  // Ou seja: reshuffle quando queue vazia E todos cooperaram pelo menos 1x.
  const wouldVisit = uniqueAppend(previousCompletedPlusCurrent, carry);
  const allVisited = wouldVisit.length >= ALL_CASEL_DIMS.length;

  if (allVisited && args.queue.length === 0) {
    // Re-shuffle: nova rotação a partir de zero, anchored em engagement.
    const signals = args.engagementSignals ?? {};
    const ranked = [...ALL_CASEL_DIMS].sort((a, b) => {
      const diff = (signals[b] ?? 0) - (signals[a] ?? 0);
      if (diff !== 0) return diff;
      return ALL_CASEL_DIMS.indexOf(a) - ALL_CASEL_DIMS.indexOf(b);
    });
    const newPair: CaselDimensionPair = [ranked[0]!, ranked[1]!];
    const newQueue = ranked.slice(2);
    return { pair: newPair, queue: newQueue, completed: [] };
  }

  // Normal 50% overlap. Z = primeiro elemento da queue não-presente em current_pair.
  const candidates = args.queue.filter(
    (d) => d !== args.currentPair[0] && d !== args.currentPair[1],
  );
  if (candidates.length === 0) {
    // Queue drenada (defer extremo OU pré-reshuffle inválido). Mantém Y +
    // procura qualquer dim restante non-carry, non-completed, non-queue.
    // Se nada disponível, expande pra qualquer non-carry (fallback brando).
    const strictFallback = ALL_CASEL_DIMS.find(
      (d) =>
        d !== carry &&
        !previousCompletedPlusCurrent.includes(d) &&
        !args.queue.includes(d),
    );
    const softFallback = strictFallback ?? ALL_CASEL_DIMS.find((d) => d !== carry);
    const next: CaselDimensionPair = softFallback
      ? [carry, softFallback]
      : [carry, carry];
    return {
      pair: next,
      queue: args.queue,
      completed: previousCompletedPlusCurrent,
    };
  }
  const next = candidates[0]!;
  const remainingQueue = args.queue.filter((d) => d !== next);
  return {
    pair: [carry, next],
    queue: remainingQueue,
    completed: previousCompletedPlusCurrent,
  };
}

/**
 * Inicia novo ciclo. Para persona nova (state ausente), use
 * `bootstrapKidsHelixState`. Para próximo ciclo após completar, use `completeCycle`.
 *
 * Sub-decisão 3: queue → active transition.
 */
export function cycleStart(args: {
  state: KidsHelixState;
  nowIso: string;
}): KidsHelixState {
  // No-op se já em modo active e current_day=0 (cycleStart idempotente).
  if (args.state.mode === "active" && args.state.current_day === 0) {
    return args.state;
  }
  return {
    ...args.state,
    cycle_started_at: args.nowIso,
    current_day: 0,
    mode: "active",
    // G-07: novo ciclo limpa triggers do anterior (idempotência cross-cycle).
    triggers_fired_this_cycle: [],
    updated_at: args.nowIso,
  };
}

/**
 * Avança 1 dia no ciclo. Caller chama 1x por sessão completada.
 *
 * Mode transitions:
 *  - active (0..13) → active (next day) | buffer (day 14)
 *  - buffer (14..16) → buffer (next day) | ready-to-complete (day 17)
 *  - vacation → no-op (sub-decisão 4: cycle paused)
 *
 * @returns novo state. Caller deve verificar `current_day >= TOTAL_DAYS-1`
 *          pra disparar `completeCycle` no próximo turn.
 */
export function dayAdvance(args: {
  state: KidsHelixState;
  nowIso: string;
}): KidsHelixState {
  if (args.state.mode === "vacation") return args.state;
  const nextDay = args.state.current_day + 1;
  if (nextDay >= KIDS_HELIX_TOTAL_DAYS) {
    // Cap at TOTAL_DAYS-1 (17). Caller decide se chama completeCycle.
    return {
      ...args.state,
      current_day: KIDS_HELIX_TOTAL_DAYS - 1,
      mode: "buffer",
      updated_at: args.nowIso,
    };
  }
  const newMode = nextDay >= KIDS_HELIX_ACTIVE_DAYS ? "buffer" : "active";
  return {
    ...args.state,
    current_day: nextDay,
    mode: newMode,
    updated_at: args.nowIso,
  };
}

/**
 * Completa ciclo: move X (active_pair[0]) pra completed, Y (active_pair[1])
 * carrega pra próximo ciclo, Z (próximo da queue) entra como nova segunda dim.
 * Reset day/mode. Sub-decisões 2 + 3.
 *
 * Caller chama quando `current_day === TOTAL_DAYS - 1` (day 17).
 *
 * Edge: se em vacation, no-op (cycle não progride durante férias).
 *
 * Spec: "Cycle N pair = [X, Y] → Cycle N+1 pair = [Y, Z]" — Y carries over
 * como retrieval source. X vira completed.
 *
 * Reshuffle (completed.length === 5 post-X): retorna tudo pra queue,
 * novo par anchored em highest-engagement signals.
 */
export function completeCycle(args: {
  state: KidsHelixState;
  nowIso: string;
  engagementSignals?: Partial<Record<CaselDimension, number>>;
}): KidsHelixState {
  if (args.state.mode === "vacation") return args.state;

  const result = computeNextPair({
    currentPair: args.state.active_pair,
    queue: args.state.queue,
    completed: args.state.completed,
    engagementSignals: args.engagementSignals,
  });

  return {
    ...args.state,
    previous_pair: args.state.active_pair,
    active_pair: result.pair,
    queue: result.queue,
    completed: result.completed,
    cycle_started_at: args.nowIso,
    current_day: 0,
    mode: "active",
    cycles_completed: args.state.cycles_completed + 1,
    // G-07: completeCycle reseta trigger log — próximo ciclo começa limpo.
    triggers_fired_this_cycle: [],
    updated_at: args.nowIso,
  };
}

/**
 * Defere uma dimensão: move de active_pair pra deferred. Sub-decisão 3.
 *
 * Casos:
 *  - active → deferred: extended_brejo / vacation_triggered / parental_pause.
 *
 * Quando uma dim do par é deferida, a outra continua no ciclo (par fica
 * incompleto). Caller decide se quer também deferir a outra ou substituir
 * por dim da queue. Por simplicidade, esta função só move 1 dim; caller
 * orquestra substituição se necessário.
 *
 * Edge: dim já em deferred → no-op idempotente.
 *
 * @param substitute opcional — dim da queue pra substituir a deferida no par.
 *                    Se ausente, par fica com a deferida marcada (caller deve
 *                    tratar como "single-dim cycle" interim).
 */
export function deferDimension(args: {
  state: KidsHelixState;
  dim: CaselDimension;
  reason: KidsHelixDeferReason;
  nowIso: string;
  substitute?: CaselDimension;
}): KidsHelixState {
  if (args.state.deferred.includes(args.dim)) return args.state;
  // Só pode deferir dim que está no active_pair.
  if (
    args.state.active_pair[0] !== args.dim &&
    args.state.active_pair[1] !== args.dim
  ) {
    return args.state;
  }

  const newDeferred = [...args.state.deferred, args.dim];
  let newPair: CaselDimensionPair = args.state.active_pair;
  let newQueue = args.state.queue;

  if (args.substitute && args.state.queue.includes(args.substitute)) {
    // Substitui dim deferida pelo substitute.
    newPair =
      args.state.active_pair[0] === args.dim
        ? [args.substitute, args.state.active_pair[1]]
        : [args.state.active_pair[0], args.substitute];
    newQueue = args.state.queue.filter((d) => d !== args.substitute);
  }

  void args.reason; // razão é semântica (telemetria); state não armazena
  // (caller deve emitir evento `helix.dim.deferred` com reason).
  return {
    ...args.state,
    active_pair: newPair,
    queue: newQueue,
    deferred: newDeferred,
    updated_at: args.nowIso,
  };
}

/**
 * Resume uma dimensão deferida → volta pra queue. Sub-decisão 3.
 *
 * Casos: recovery_confirmed / parental_resume / vacation_end.
 *
 * Edge: dim não em deferred → no-op.
 */
export function resumeDimension(args: {
  state: KidsHelixState;
  dim: CaselDimension;
  reason: KidsHelixResumeReason;
  nowIso: string;
}): KidsHelixState {
  if (!args.state.deferred.includes(args.dim)) return args.state;
  void args.reason; // razão é semântica (telemetria).
  return {
    ...args.state,
    deferred: args.state.deferred.filter((d) => d !== args.dim),
    queue: uniqueAppend(args.state.queue, args.dim),
    updated_at: args.nowIso,
  };
}

/**
 * Entra em modo férias. Sub-decisão 4.
 *
 * Pausa cycle progression (dayAdvance no-op em vacation). Cycle continua
 * existindo (active_pair preservado) — só "congela" current_day.
 */
export function enterVacation(args: {
  state: KidsHelixState;
  trigger: KidsHelixVacationTrigger;
  nowIso: string;
}): KidsHelixState {
  if (args.state.mode === "vacation") return args.state;
  return {
    ...args.state,
    mode: "vacation",
    vacation_trigger: args.trigger,
    vacation_started_at: args.nowIso,
    updated_at: args.nowIso,
  };
}

/**
 * Sai de modo férias. Sub-decisão 4 resume conditions.
 *
 * Restaura mode baseado em current_day (active se <14, buffer se ≥14).
 */
export function exitVacation(args: {
  state: KidsHelixState;
  nowIso: string;
}): KidsHelixState {
  if (args.state.mode !== "vacation") return args.state;
  const restoredMode =
    args.state.current_day >= KIDS_HELIX_ACTIVE_DAYS ? "buffer" : "active";
  return {
    ...args.state,
    mode: restoredMode,
    vacation_trigger: null,
    vacation_started_at: null,
    updated_at: args.nowIso,
  };
}

/**
 * Avalia se condições pra entrar em vacation estão satisfeitas. Sub-decisão 4.
 *
 * Trigger conditions (any single sufficient):
 *  - parental_request — explicit `parent_decisions.vacation_start`
 *  - brejo_emotional_persistent — statusMatrix.emotional === "brejo" por > BREJO_VACATION_DAYS
 *  - sacrifice_exhaustion — N sessões consecutivas com `budget_exhausted`
 *  - family_vacation_signal — event_log `family_vacation_start` recente
 *
 * NOTA SOBRE FONTES DE SINAL (honest gap):
 *  Em F0 atual, alguns sinais não estão wired-up:
 *   - `parent_decisions.vacation_start` — schema parent-decisions só tem
 *     status approved/rejected/pinned (motor-execucao). Estende em followup.
 *   - `family_vacation_start` event — não existe no event_log canônico hoje.
 *   - sacrifice_exhaustion conta — caller passa via `consecutiveExhaustedSessions`.
 *
 *  Por enquanto, função aceita TODOS sinais via args (caller decide quais já
 *  observa). Wire-up real fica pra G-05 follow-up + G-22 integration.
 */
export function checkVacationTrigger(args: {
  state: KidsHelixState;
  parentalVacationStart?: boolean;
  consecutiveBrejoDaysEmotional?: number;
  consecutiveExhaustedSessions?: number;
  familyVacationSignal?: boolean;
}): {
  shouldEnterVacation: boolean;
  trigger: KidsHelixVacationTrigger | null;
  reasons: KidsHelixVacationTrigger[];
} {
  // No-op se já em vacation.
  if (args.state.mode === "vacation") {
    return { shouldEnterVacation: false, trigger: null, reasons: [] };
  }
  const reasons: KidsHelixVacationTrigger[] = [];
  if (args.parentalVacationStart) reasons.push("parental_request");
  if (
    (args.consecutiveBrejoDaysEmotional ?? 0) > KIDS_HELIX_BREJO_VACATION_DAYS
  ) {
    reasons.push("brejo_emotional_persistent");
  }
  if (
    (args.consecutiveExhaustedSessions ?? 0) >=
    KIDS_HELIX_SACRIFICE_EXHAUSTION_SESSIONS
  ) {
    reasons.push("sacrifice_exhaustion");
  }
  if (args.familyVacationSignal) reasons.push("family_vacation_signal");

  if (reasons.length === 0) {
    return { shouldEnterVacation: false, trigger: null, reasons: [] };
  }
  // Trigger priority: parental > family > brejo > sacrifice (mais explícitos primeiro).
  const priority: KidsHelixVacationTrigger[] = [
    "parental_request",
    "family_vacation_signal",
    "brejo_emotional_persistent",
    "sacrifice_exhaustion",
  ];
  const trigger = priority.find((p) => reasons.includes(p)) ?? reasons[0]!;
  return { shouldEnterVacation: true, trigger, reasons };
}

/**
 * Avalia se uma dim do par ativo deveria ser deferida por brejo prolongado.
 * Sub-decisão 3 (active→deferred via extended_brejo).
 *
 * Caller passa contagem de dias consecutivos da dim em brejo. Threshold = 3.
 */
export function checkDeferTrigger(args: {
  state: KidsHelixState;
  dim: CaselDimension;
  consecutiveBrejoDays: number;
}): boolean {
  if (
    args.state.active_pair[0] !== args.dim &&
    args.state.active_pair[1] !== args.dim
  ) {
    return false;
  }
  return args.consecutiveBrejoDays > KIDS_HELIX_BREJO_DEFER_DAYS;
}

/**
 * Cycle progress 0.0..1.0 — usado por ops#1020 G-07 cadência 18d
 * (50%/100% triggers).
 *
 * **Atenção (G-07 GO C)**: este é progress sobre TOTAL_DAYS (18). Quando
 * spec CLAUDE_6 §5.2 diz "50% → retrieval", refere-se a 50% da fase ATIVA
 * (= dia 7), não 50% do total (= dia 9). Use `activeCycleProgress` para
 * computar fronteiras pedagógicas; use `cycleProgress` para audit/UI.
 */
export function cycleProgress(state: KidsHelixState): number {
  if (state.mode === "vacation") {
    // Vacation = freeze. Progress reportado é current_day/TOTAL_DAYS.
    return state.current_day / KIDS_HELIX_TOTAL_DAYS;
  }
  return Math.min(1, state.current_day / KIDS_HELIX_TOTAL_DAYS);
}

/**
 * G-07: Progress relativo à fase ATIVA (0..1 sobre KIDS_HELIX_ACTIVE_DAYS=14).
 *
 * Buffer (days 14-17) reporta 1.0 (active phase já fechou). Vacation reporta
 * progress congelado em current_day/ACTIVE (preserva intent pedagógico do
 * "onde paramos quando entrou férias").
 *
 * Exemplo: dia 0 → 0.0 ; dia 7 → 0.5 (retrieval fronteira) ; dia 14 → 1.0
 * (boss fight fronteira) ; dia 17 (buffer) → 1.0 (active phase fechada).
 */
export function activeCycleProgress(state: KidsHelixState): number {
  return Math.min(1, state.current_day / KIDS_HELIX_ACTIVE_DAYS);
}

/**
 * G-07: Detecta triggers cadenciais pendentes pra disparar neste turn.
 *
 * Idempotência: trigger só fires se NÃO está em `triggers_fired_this_cycle`.
 * Caller deve persistir via `markTriggerFired` após observar.
 *
 * **Regras** (sub-decisão GO C — conservative, fire-once-per-cycle):
 *  - `retrieval_50` fires quando `current_day >= 7` E não fireado neste ciclo.
 *  - `midcycle_assessment_7` fires quando `current_day >= 7` E não fireado.
 *  - `boss_fight_100` fires quando `current_day >= 14` E não fireado.
 *  - Vacation mode: zero triggers (cycle paused).
 *  - Mode buffer: triggers anteriores ainda válidos (não re-fire), mas
 *    boss_fight_100 pode ainda fire se chegou ao buffer sem fire-anterior.
 *
 * Retorna array porque dia 7 dispara DOIS triggers simultâneos
 * (retrieval + midcycle_assessment compartilham fronteira mas têm payload
 * distinto). Caller decide qual contextHints injetar.
 *
 * @returns lista de triggers que devem fire no turn (vazia = nenhum pendente).
 */
export function detectCadenceTriggers(
  state: KidsHelixState,
): KidsHelixCadenceTrigger[] {
  if (state.mode === "vacation") return [];

  const pending: KidsHelixCadenceTrigger[] = [];
  const fired = new Set(state.triggers_fired_this_cycle);

  // Retrieval @ day 7 (50% active phase).
  if (
    state.current_day >= KIDS_HELIX_RETRIEVAL_TRIGGER_DAY &&
    !fired.has("retrieval_50")
  ) {
    pending.push("retrieval_50");
  }

  // Midcycle assessment @ day 7 (mesmo dia, payload diferente — vai pra parent).
  if (
    state.current_day >= KIDS_HELIX_MIDCYCLE_ASSESSMENT_DAY &&
    !fired.has("midcycle_assessment_7")
  ) {
    pending.push("midcycle_assessment_7");
  }

  // Boss fight @ day 14 (100% active phase).
  if (
    state.current_day >= KIDS_HELIX_BOSS_FIGHT_TRIGGER_DAY &&
    !fired.has("boss_fight_100")
  ) {
    pending.push("boss_fight_100");
  }

  return pending;
}

/**
 * G-07: Marca trigger como fireado neste ciclo (idempotência).
 *
 * Caller chama após `detectCadenceTriggers` + ação observada. Função
 * idempotente: trigger já marcado retorna state sem alteração.
 *
 * Notação: trigger fica gravado até próximo `cycleStart` ou `completeCycle`
 * (ambos resetam `triggers_fired_this_cycle = []`).
 */
export function markTriggerFired(args: {
  state: KidsHelixState;
  trigger: KidsHelixCadenceTrigger;
  nowIso: string;
}): KidsHelixState {
  if (args.state.triggers_fired_this_cycle.includes(args.trigger)) {
    return args.state;
  }
  return {
    ...args.state,
    triggers_fired_this_cycle: [
      ...args.state.triggers_fired_this_cycle,
      args.trigger,
    ],
    updated_at: args.nowIso,
  };
}

/**
 * G-07: Avalia se ciclo precisa extensão (2 vs 4 semanas) no midcycle (dia 7).
 *
 * Spec canon CLAUDE_6 §5.2/§5.4: "dia 7 → avalia se ciclo precisa de 2 ou
 * 4 semanas". Esta função NÃO altera o ciclo — apenas emite recomendação
 * pro orchestrator/parent layer.
 *
 * Heurística (sub-decisão GO C — conservative defaults):
 *  - `extended_4_weeks` se:
 *     - `evolutionPercentage < KIDS_HELIX_EXTENSION_EVOLUTION_THRESHOLD` (default 0.3), OU
 *     - alguma dim do `active_pair` está em status "brejo" (statusMatrix), OU
 *     - persona em flag "needs_more_time" explícito do parental layer.
 *  - `standard_2_weeks` caso contrário (default conservative).
 *
 * Caller responsável por consumir o resultado — extend implementation
 * (push current_day back, double ACTIVE_DAYS) fica pra G-06+ downstream.
 *
 * @returns recomendação + razão textual pra audit.
 */
export function assessCycleExtension(args: {
  state: KidsHelixState;
  evolutionPercentage?: number;
  statusMatrix?: Record<string, string>;
  parentalNeedsMoreTime?: boolean;
}): {
  recommendation: KidsHelixExtensionRecommendation;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (args.parentalNeedsMoreTime) {
    reasons.push("parental_needs_more_time");
  }

  const evo = args.evolutionPercentage ?? 0;
  if (evo < KIDS_HELIX_EXTENSION_EVOLUTION_THRESHOLD) {
    reasons.push(`evolution_below_threshold:${evo.toFixed(2)}<${KIDS_HELIX_EXTENSION_EVOLUTION_THRESHOLD}`);
  }

  if (args.statusMatrix) {
    for (const dim of args.state.active_pair) {
      if (args.statusMatrix[dim] === "brejo") {
        reasons.push(`active_dim_brejo:${dim}`);
      }
    }
  }

  if (reasons.length > 0) {
    return { recommendation: "extended_4_weeks", reasons };
  }
  return {
    recommendation: "standard_2_weeks",
    reasons: ["default_no_extension_signal"],
  };
}

/**
 * G-07: Computa evolution percentage do ciclo atual.
 *
 * Combina 3 sinais (média ponderada, sub-decisão GO C):
 *  - 50% — Dreyfus progression: distância entre `dreyfusBaseline[dim]` e
 *    `dreyfusObserved[dim]` para cada dim do active_pair, normalizada
 *    sobre `DREYFUS_LEVELS.length-1` (4 steps possíveis).
 *  - 30% — Status matrix improvement: dim em "pasto" → 1.0; "baia" → 0.5;
 *    "brejo" → 0.0 (média sobre active_pair).
 *  - 20% — Cycle progress: progress temporal (proxy: já avançou no tempo,
 *    algo está acontecendo).
 *
 * Pondering rationale: Dreyfus é o framework canônico de mastery (G-01);
 * status_matrix é o observable comportamental imediato; cycle_progress é
 * o "tempo investido". Sem Dreyfus baseline (cycle 1, novo persona), peso
 * desloca pra status_matrix (60%) + cycle_progress (40%).
 *
 * **NOTA HONESTA**: implementação inicial é heurística simples sem
 * histórico longo. Refinamento (regressão temporal, peso por gardner_channel)
 * fica pra G-21 sprint review fim de ciclo (ops#1032 downstream).
 *
 * @returns 0..1 — percentage de evolução observada no ciclo.
 */
export function computeEvolutionAssessment(args: {
  state: KidsHelixState;
  dreyfusBaseline?: Partial<Record<CaselDimension, DreyfusLevel>>;
  dreyfusObserved?: Partial<Record<CaselDimension, DreyfusLevel>>;
  statusMatrix?: Record<string, string>;
}): number {
  const pair = args.state.active_pair;

  // --- Dreyfus progression component ---
  let dreyfusScore = 0;
  let dreyfusValidCount = 0;
  if (args.dreyfusBaseline && args.dreyfusObserved) {
    for (const dim of pair) {
      const baseline = args.dreyfusBaseline[dim];
      const observed = args.dreyfusObserved[dim];
      if (baseline && observed) {
        const baselineIdx = DREYFUS_LEVELS.indexOf(baseline);
        const observedIdx = DREYFUS_LEVELS.indexOf(observed);
        if (baselineIdx >= 0 && observedIdx >= 0) {
          const delta = observedIdx - baselineIdx;
          // Normalize: max possible delta = LEVELS.length-1 (e.g., 4 steps).
          // Negative delta = regression (clamped 0).
          const normalized = Math.max(0, delta) / (DREYFUS_LEVELS.length - 1);
          dreyfusScore += normalized;
          dreyfusValidCount += 1;
        }
      }
    }
  }
  const dreyfusComponent =
    dreyfusValidCount > 0 ? dreyfusScore / dreyfusValidCount : 0;

  // --- Status matrix component ---
  let statusScore = 0;
  let statusValidCount = 0;
  if (args.statusMatrix) {
    for (const dim of pair) {
      const status = args.statusMatrix[dim];
      if (status === "pasto") {
        statusScore += 1.0;
        statusValidCount += 1;
      } else if (status === "baia") {
        statusScore += 0.5;
        statusValidCount += 1;
      } else if (status === "brejo") {
        statusScore += 0.0;
        statusValidCount += 1;
      }
    }
  }
  const statusComponent =
    statusValidCount > 0 ? statusScore / statusValidCount : 0;

  // --- Cycle progress component (proxy: time invested) ---
  const progressComponent = activeCycleProgress(args.state);

  // --- Weight resolution ---
  // Default: 50/30/20 (Dreyfus/status/progress).
  // Sem baseline Dreyfus: redistribui pra 0/60/40.
  const hasDreyfus = dreyfusValidCount > 0;
  if (hasDreyfus) {
    return (
      dreyfusComponent * 0.5 +
      statusComponent * 0.3 +
      progressComponent * 0.2
    );
  }
  return statusComponent * 0.6 + progressComponent * 0.4;
}

// -- Internal helpers --

function uniqueAppend<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr : [...arr, item];
}
