/**
 * Planejador — deixa de nomear playbook-ação-unitária.
 * Agora: scora o pool (via scoreItem de @ascendimacy/shared) e devolve top 1-5.
 *
 * LLM é consultada APENAS para strategicRationale e contextHints
 * (detecção de língua + ajuste tonal). O scoring é determinístico.
 *
 * Bloco 2b adiciona: composição de `instruction_addition` via
 * `withGardnerProgram` se programa ativo e assessment pronto.
 *
 * Spec: docs/handoffs/2026-04-24-cc-bloco2-plan.md §2.A v2 + Bloco 2b.
 */

import type {
  PlanTurnInput,
  PlanTurnOutput,
  ScoredContentItem,
  GardnerAssessment,
  GardnerProgramState,
  ParentalProfile,
  ContentItem,
  EventEntry,
} from "@ascendimacy/shared";
import {
  scorePool,
  allGates,
  pickFocusDimension,
  caselTargetsFor,
  defaultMatrix,
  composeInstructionAddition,
  isAssessmentReady,
  pairForWeek,
  shouldPauseProgram,
  isParentalProfileMinimal,
  triageForParents,
  logDebugEvent,
  getProviderForStep,
  computeChallengeCost,
  computeTrustRatio,
  isItemAllowedUnderBudgetExhaustion,
  extractPersonaSensitivity,
  isExhausted,
} from "@ascendimacy/shared";
import { callLlm, callLlmMock, callHaiku, type LlmCallResult } from "./llm-client.js";
import { loadSeedPool, buildPool, slicePoolForDrota } from "./pool-builder.js";
import { evaluateAllTransitions, collectRecentSignals } from "./trigger-evaluator.js";
import { personaToChildProfile } from "./child-profile.js";
import { lookupActionMenu } from "./strategist/menu-lookup.js";
import { cycleProgress } from "./strategist/helix-engine.js";
import {
  countInquiriesInSession,
  extractProfileConfig,
  extractRepetitionCounts,
  shouldAskRepetitionInquiry,
  turnsSinceLastInquiry,
} from "./strategist/repetition-inquiry.js";

/** Quantos items do pool passamos ao drota (top-K). */
export const TOP_K_POOL = 5;

/** Caminho do seed pode ser sobrescrito via env para testes. */
function seedPath(): string | undefined {
  return process.env["CONTENT_SEED_PATH"];
}

/**
 * Exported pra consumo por PoC scripts (ops#1069 follow-up) que precisam
 * reproduzir prompt do planejador sem passar pelo MCP handler completo.
 * Sem mudança de comportamento — só visibility.
 */
export function buildSystemPrompt(input: PlanTurnInput): string {
  const { persona, state, incomingMessage } = input;
  return `Você é o Planejador do motor Ascendimacy. Seu papel é AUXILIAR de compositor:
o scoring de content items é determinístico (feito no código). Você só emite:

1. strategicRationale (≤80 chars) — 1 frase sobre o momento da sessão.
2. contextHints — dicas de composição (language, tom, avoid, etc).

SUJEITO: ${persona.name}, ${persona.age} anos.
Perfil: ${JSON.stringify(persona.profile, null, 2)}
Estado: trust=${state.trustLevel.toFixed(2)}, turn=${state.turn}, budget=${state.budgetRemaining}
Mensagem: "${incomingMessage}"

Detecte a língua do sujeito (ex: 'pt-br', 'pt-br limitado', 'pt-br basico', 'ja', 'en'). Se o perfil indica falante não-nativo (ex: japonês aprendendo pt-br), use 'pt-br limitado'.

Responda APENAS JSON COMPACTO:
{"strategicRationale":"string ≤80 chars","contextHints":{"language":"pt-br","mood":"receptive","urgency":"low"}}`;
}

interface LlmRationale {
  strategicRationale: string;
  contextHints: Record<string, unknown>;
}

function parseRationale(raw: string): LlmRationale {
  const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as {
      strategicRationale?: string;
      contextHints?: Record<string, unknown>;
    };
    return {
      strategicRationale: parsed.strategicRationale ?? "",
      contextHints: parsed.contextHints ?? {},
    };
  } catch {
    return { strategicRationale: "", contextHints: { language: "pt-br" } };
  }
}

/**
 * Se há programa ativo + assessment pronto + matrix não-pausável,
 * compõe a string instruction_addition que vai pro drota.
 * Retorna string vazia caso contrário.
 */
function buildGardnerInstruction(input: PlanTurnInput): {
  text: string;
  pauseReason?: string;
  active: boolean;
} {
  const program = input.state.gardnerProgram;
  if (!program || program.current_week === null || program.current_phase === null) {
    return { text: "", active: false };
  }
  if (program.paused) {
    return { text: "", active: false, pauseReason: program.paused_reason ?? "paused" };
  }

  // Assessment vem via persona.profile.gardner_assessment em v1 (fixture pattern).
  const profile = (input.persona.profile ?? {}) as Record<string, unknown>;
  const rawAssessment = profile["gardner_assessment"] as GardnerAssessment | undefined;
  if (!isAssessmentReady(rawAssessment)) {
    return { text: "", active: false, pauseReason: "assessment_not_ready" };
  }

  // Pausa automática se matrix sinaliza brejo afetivo.
  const matrix = input.state.statusMatrix ?? defaultMatrix();
  const pause = shouldPauseProgram(matrix);
  if (pause.paused) {
    return { text: "", active: false, pauseReason: pause.reason };
  }

  // Bloco 6: se joint, brejo UNILATERAL (parceiro) também pausa.
  if (input.state.sessionMode === "joint" && input.state.partnerStatusMatrix) {
    const partnerPause = shouldPauseProgram(input.state.partnerStatusMatrix);
    if (partnerPause.paused) {
      return { text: "", active: false, pauseReason: `partner_${partnerPause.reason}` };
    }
  }

  const pair = pairForWeek(program.current_week, rawAssessment!);
  if (!pair) return { text: "", active: false, pauseReason: "no_pair" };

  const text = composeInstructionAddition({
    week_number: program.current_week,
    day_in_week: program.current_day,
    strength_channel: pair.strength,
    weakness_channel: pair.weakness,
    phase: program.current_phase,
    multi_channel: pair.multi_channel,
  });
  return { text, active: true };
}

/**
 * Aplica parent_pinned dinâmico — se persona.profile.parent_pinned_ids incluir
 * o id do item, marca parent_pinned=true antes de scorar. Assim o scorer (Bloco 1)
 * já respeita (PARENT_PINNED_SCORE=1000 vence tudo). Plan Bloco 4 requisito (c).
 */
function applyPinnedDecisions(pool: ContentItem[], persona: PlanTurnInput["persona"]): ContentItem[] {
  const profile = (persona.profile ?? {}) as Record<string, unknown>;
  const pinnedIds = Array.isArray(profile["parent_pinned_ids"])
    ? new Set(profile["parent_pinned_ids"] as string[])
    : null;
  const rejectedIds = Array.isArray(profile["parent_rejected_ids"])
    ? new Set(profile["parent_rejected_ids"] as string[])
    : null;
  if (!pinnedIds && !rejectedIds) return pool;
  return pool
    .filter((item) => !(rejectedIds?.has(item.id)))
    .map((item) => {
      if (pinnedIds?.has(item.id)) {
        return { ...item, parent_pinned: true, pinned_until: item.pinned_until ?? null };
      }
      return item;
    });
}

export async function planTurn(input: PlanTurnInput): Promise<PlanTurnOutput> {
  const sessionMode = input.state.sessionMode ?? "solo";
  // 1. Scoring determinístico do pool.
  const rawPool = loadSeedPool(seedPath());
  const withPinnedMarks = applyPinnedDecisions(rawPool, input.persona);
  const eligible = buildPool(withPinnedMarks, {
    age: input.persona.age,
    // Bloco 6: joint filtra por group_compatible (campo já existe desde 2a A.1.1)
    sessionMode: sessionMode === "joint" ? "joint" : "1v1",
  });
  const child = personaToChildProfile(input.persona, input.state);
  const statusMatrix = input.state.statusMatrix ?? defaultMatrix();
  const focusDim = pickFocusDimension(statusMatrix);
  const caselTargets = focusDim ? caselTargetsFor(focusDim) : [];
  // motor#23: extrai items já consumidos nesta sessão do event_log pra
  // penalizar reuso e forçar rotação (descoberta no smoke-3d-bumped onde
  // 12 calls drota selecionaram o mesmo item).
  const usedInSession: string[] = (input.state.eventLog ?? [])
    .filter((e) => e.type === "playbook_executed")
    .map((e) => {
      const data = e.data as { selectedContentId?: string | null } | undefined;
      return data?.selectedContentId;
    })
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  // C-T-10-01 (ops#999): se ASC_USE_ACTION_MENU=true, tenta lookup
  // determinístico no menu persistido ANTES de scoring. Fallback to
  // scoring se menu ausente/stale/sem items elegíveis.
  // Decay multiplicativo aplicado em items expirados (Jun 2026-05-14).
  const useActionMenu = process.env["ASC_USE_ACTION_MENU"] === "true";
  let topK: ScoredContentItem[] | null = null;
  // S-T-10-08 (ops#1069): captura source.strategic_rationale + context_hints
  // do menu pra possível skip do LLM rationale call (sub §3 abaixo).
  let menuSource: { trust_level: number; strategic_rationale?: string | null; context_hints?: Record<string, unknown> | null } | null = null;
  if (useActionMenu) {
    const menuBaseDir =
      process.env["ASC_ACTION_MENU_BASE_DIR"] ?? "fixtures/profiles";
    const menuResult = await lookupActionMenu(input.persona.id, menuBaseDir, {
      usedInSession,
      topK: TOP_K_POOL,
    });
    try {
      logDebugEvent({
        side: "motor",
        step: "plan_turn_menu_lookup",
        user_id: input.persona.id,
        motor_target: "planejador-strategist",
        session_id: input.sessionId,
        outcome: menuResult.outcome === "ok" ? "ok" : "skip",
      });
    } catch {
      // Telemetry não bloqueia.
    }
    if (menuResult.outcome === "ok" && menuResult.items.length > 0) {
      topK = menuResult.items;
      menuSource = menuResult.source ?? null;
    }
    // Fallback to scoring se menuResult.outcome !== "ok"
  }

  if (topK === null) {
    const scored = scorePool(eligible, child, {
      now: new Date().toISOString(),
      casel_focus: caselTargets[0] as ScoredContentItem["item"]["casel_target"][number] | undefined,
      used_in_session: usedInSession,
    });
    topK = scored.slice(0, TOP_K_POOL);
  }

  // 2. Triagem parental (Bloco 4 #17, paper §6 camada 2).
  //    Se persona.profile.parental_profile existir E estiver mínimo,
  //    passa topK pelo triageForParents (rule-based ou Haiku).
  // motor#22: provider-aware mock detection — antes era hardcoded
  // !ANTHROPIC_API_KEY (legacy pré-router motor#21). Agora checa a key
  // do provider efetivamente configurado pra este step.
  const planejadorProvider = getProviderForStep("planejador");
  const planejadorKeyMissing = planejadorProvider === "anthropic"
    ? !process.env["ANTHROPIC_API_KEY"]
    : !process.env["INFOMANIAK_API_KEY"];
  const useMockLlm =
    process.env["USE_MOCK_LLM"] === "true" || planejadorKeyMissing;
  const parentalProfile = extractParentalProfile(input.persona);
  let triageMode: "rule_based" | "haiku" | "skipped" = "skipped";
  let triageRejectedIds: string[] = [];
  if (isParentalProfileMinimal(parentalProfile)) {
    // motor#19: callHaiku retorna LlmCallResult; HaikuCaller espera string.
    // Wrap pra extrair só content (reasoning não é logado em Haiku hoje).
    const haikuCaller = useMockLlm
      ? undefined
      : async (sys: string, user: string) => (await callHaiku(sys, user)).content;
    const triageResult = await triageForParents(
      { pool: topK, profile: parentalProfile!, max_approved: TOP_K_POOL },
      haikuCaller,
    );
    topK = triageResult.approved;
    triageMode = triageResult.triage_mode;
    triageRejectedIds = triageResult.rejected.map((r) => r.item.id);
  }

  // 3. LLM consulta para rationale + contextHints.
  //
  // S-T-10-08 (ops#1069): se menu_hit + rationale pré-bakeado presente E
  // NÃO há brejo afetivo, SKIP do LLM call. Brejo é override absoluto —
  // context bakeado pode estar errado sobre estado emocional CORRENTE.
  //
  // Defaults Jun 2026-05-16:
  //  - Schema: source.strategic_rationale + source.context_hints opcionais
  //  - Staleness: reusa menu valid_until (sem TTL próprio)
  //  - Fallback: degrada pra LLM call original se rationale ausente
  //  - Override: brejo afetivo (shouldPauseProgram.paused) → SEMPRE LLM fresh
  const brejoActive = shouldPauseProgram(statusMatrix).paused;
  const canSkipLlmRationale =
    topK !== null &&
    menuSource?.strategic_rationale != null &&
    menuSource.strategic_rationale.length > 0 &&
    !brejoActive;

  const systemPrompt = buildSystemPrompt(input);
  const userMessage = `Emita o JSON com rationale + hints.`;
  const t0 = Date.now();
  let llmResult: LlmCallResult | null = null;
  let llmLatency = 0;
  let rationale: { strategicRationale: string; contextHints: Record<string, unknown> };
  if (canSkipLlmRationale) {
    rationale = {
      strategicRationale: menuSource!.strategic_rationale!,
      contextHints: (menuSource!.context_hints ?? { language: "pt-br" }) as Record<string, unknown>,
    };
    try {
      logDebugEvent({
        side: "motor",
        step: "planejador_rationale_skipped",
        user_id: input.persona.id,
        session_id: input.sessionId,
        motor_target: "planejador-strategist",
        outcome: "ok",
      });
    } catch {
      // Telemetry não bloqueia.
    }
  } else {
    llmResult = useMockLlm
      ? await callLlmMock(systemPrompt, userMessage)
      : await callLlm(systemPrompt, userMessage);
    llmLatency = Date.now() - t0;
    rationale = parseRationale(llmResult.content);
    if (topK !== null && menuSource?.strategic_rationale == null) {
      // Menu hit mas rationale ausente → fallback to LLM. Log pra observability.
      try {
        logDebugEvent({
          side: "motor",
          step: "planejador_rationale_fallback",
          user_id: input.persona.id,
          session_id: input.sessionId,
          motor_target: "planejador-strategist",
          outcome: "skip",
        });
      } catch {
        // Telemetry não bloqueia.
      }
    }
  }

  // motor#19: debug log (no-op se ASC_DEBUG_MODE off)
  logDebugEvent({
    side: "motor",
    step: "planejador",
    user_id: input.persona.id,
    session_id: input.sessionId,
    turn_number: input.state.turn,
    model: process.env["PLANEJADOR_MODEL"] ?? "claude-sonnet-4-6",
    provider: "anthropic",
    tokens: llmResult?.tokens,
    latency_ms: llmLatency,
    prompt: systemPrompt + "\n\n[USER]\n" + userMessage,
    response: llmResult?.content ?? "[skipped_via_menu]",
    reasoning: llmResult?.reasoning,
    snapshots_pre: {
      planejador: {
        persona_age: input.persona.age,
        pool_pre_filter_size: rawPool.length,
        pool_post_eligibility_size: eligible.length,
        triage_mode: triageMode,
        triage_rejected_ids: triageRejectedIds,
        gardner_active: !!input.state.gardnerProgram?.current_week,
      },
    },
    snapshots_post: {
      planejador: {
        rationale: rationale.strategicRationale,
        context_hints_keys: Object.keys(rationale.contextHints),
        top_k_pool_ids: topK.slice(0, 5).map((s) => s.item.id),
      },
    },
    outcome: "ok",
  });

  // 4. Composição do mixin withGardnerProgram se ativo.
  const gardnerInstruction = buildGardnerInstruction(input);

  // 5. Injeta status_gates + casel_focus + gardner meta + triage meta em contextHints.
  const contextHints: Record<string, unknown> = {
    ...rationale.contextHints,
    status_gates: allGates(statusMatrix),
  };
  if (focusDim) {
    contextHints["casel_focus_dimension"] = focusDim;
    contextHints["casel_focus_targets"] = caselTargets;
  }
  if (input.state.gardnerProgram?.current_week) {
    contextHints["gardner_program_active"] = gardnerInstruction.active;
    contextHints["gardner_current_week"] = input.state.gardnerProgram.current_week;
    if (gardnerInstruction.pauseReason) {
      contextHints["gardner_pause_reason"] = gardnerInstruction.pauseReason;
    }
  }

  // G-05 (ops#1091) — Double Helix cycle context.
  // Injeta active_pair + cycle_progress + previous_pair pro drota
  // entender em qual par de dims CASEL ancorar. Também serve ops#1020 G-07
  // downstream (50%/100% triggers consomem cycle_progress).
  //
  // Hidratação é responsabilidade de motor-execucao (kids_helix_state repo).
  // Se persona não tem state ainda (bootstrap pendente), helix block ausente
  // — drota usa fallback CASEL via casel_focus_dimension (gate antigo).
  const helixState = input.state.kidsHelixState;
  if (helixState) {
    contextHints["helix_active_pair"] = [...helixState.active_pair];
    contextHints["helix_cycle_progress"] = cycleProgress(helixState);
    contextHints["helix_cycle_day"] = helixState.current_day;
    contextHints["helix_mode"] = helixState.mode;
    contextHints["helix_cycles_completed"] = helixState.cycles_completed;
    if (helixState.previous_pair) {
      contextHints["helix_previous_pair"] = [...helixState.previous_pair];
    }
    if (helixState.mode === "vacation" && helixState.vacation_trigger) {
      contextHints["helix_vacation_trigger"] = helixState.vacation_trigger;
    }
    if (helixState.deferred.length > 0) {
      contextHints["helix_deferred_dims"] = [...helixState.deferred];
    }
  }

  if (triageMode !== "skipped") {
    contextHints["parental_triage_mode"] = triageMode;
    if (triageRejectedIds.length > 0) {
      contextHints["parental_triage_rejected_ids"] = triageRejectedIds;
    }
  }

  // Bloco 6: joint-mode hints + brejo unilateral pause signal.
  if (sessionMode === "joint") {
    contextHints["session_mode"] = "joint";
    if (input.state.jointPartnerName) {
      contextHints["joint_partner_name"] = input.state.jointPartnerName;
    }
    if (input.state.jointPartnerChildId) {
      contextHints["joint_partner_child_id"] = input.state.jointPartnerChildId;
    }
    if (input.state.partnerStatusMatrix) {
      const partnerPause = shouldPauseProgram(input.state.partnerStatusMatrix);
      if (partnerPause.paused) {
        contextHints["joint_unilateral_brejo"] = true;
        contextHints["joint_pause_reason"] = `partner_${partnerPause.reason}`;
      }
      contextHints["partner_status_gates"] = allGates(input.state.partnerStatusMatrix);
    }
  }

  // G-22 (ops#1033, Jun ratify B 2026-05-16) — sacrifice fórmula PARCIAL.
  // Gaps cobertos: 1+2+3+4+8+9. Deferred: 5 (outcome), 6/7 (onda), 10 (boss).
  //
  // - Gap 8 budget exhaustion: se isExhausted(state), flag contextHints +
  //   compute soft-degrade allowed_item_ids para drota saber quais filtrar.
  // - Gap 9 trust ratio: computeTrustRatio(state.trustLevel) → drota interpreta.
  // - Gaps 1+2+3+4 breakdown: top-K items × cost (observability/debug).
  //
  // recentUsageCount não disponível aqui (content_usage_repo é motor-execucao;
  // planejador roda sem db handle direto). Default 0 → consumption_mult=1.0;
  // future hydration via pool-builder com db handle resolverá.
  const personaSensitivity = extractPersonaSensitivity(
    input.persona.profile as Record<string, unknown> | undefined,
  );
  const trustRatio = computeTrustRatio(input.state.trustLevel);
  contextHints["prazer_sacrifice_ratio"] = {
    prazer_quota: Number(trustRatio.prazerQuota.toFixed(4)),
    sacrifice_quota: Number(trustRatio.sacrificeQuota.toFixed(4)),
  };

  const budgetExhausted = isExhausted(input.state);
  if (budgetExhausted) {
    const allowedIds = topK
      .filter((s) => isItemAllowedUnderBudgetExhaustion(s.item))
      .map((s) => s.item.id);
    contextHints["budget_state"] = "exhausted_soft_degrade";
    contextHints["budget_exhausted_allowed_ids"] = allowedIds;
    try {
      logDebugEvent({
        side: "motor",
        step: "budget_exhausted_soft_degrade",
        user_id: input.persona.id,
        session_id: input.sessionId,
        motor_target: "planejador-strategist",
        outcome: "ok",
        snapshots_post: {
          budget: {
            budget_remaining: input.state.budgetRemaining,
            allowed_ids_count: allowedIds.length,
            top_k_count: topK.length,
          },
        },
      });
    } catch {
      // Telemetry não bloqueia.
    }
  } else {
    contextHints["budget_state"] = "ok";
  }

  // G-22 breakdown — top-K cost preview (observability; não modifica scoring).
  const sacrificeBreakdown = topK.slice(0, 5).map((s) => {
    const cost = computeChallengeCost({
      item: s.item,
      personaSensitivity,
      intensity: s.isaLabels?.intensity,
    });
    return {
      id: s.item.id,
      base_effort: cost.baseEffort,
      consumption_mult: Number(cost.consumptionMult.toFixed(4)),
      sensitivity_mult: cost.sensitivityMult,
      challenge_mult: cost.challengeMult,
      total: Number(cost.total.toFixed(4)),
    };
  });
  contextHints["sacrifice_breakdown"] = sacrificeBreakdown;
  contextHints["persona_sensitivity"] = personaSensitivity;

  // motor#25 (handoff #24 Tarefa 1): slim pool antes do drota.
  // Filtra used_in_session (score≤0) + char budget 2000.
  const slimPool = slicePoolForDrota(topK, {
    maxItems: 7,
    maxTotalChars: 2000,
    excludeUsedInSession: true,
  });

  // ops#1068 — repetition_inquiry decision (Jun ratificado 2026-05-14).
  // Conjunção (i)-(vii); drota só pergunta quando todas valem.
  // Brejo afetivo é override absoluto (sub-decisão 8 §vi).
  //
  // eligiblePoolIds usa `eligible` (post-age/joint filter, PRÉ-scoring/slim).
  // slimPool exclui items used-in-session via score≤0 — exatamente os items
  // que faria sentido perguntar "quer de novo?". Paradoxo descoberto em smoke
  // E2E (ops#1068 follow-up #4): sem eligible, candidate_ids ficava sempre
  // vazio e contextHints.repetition_inquiry nunca era injetado.
  // Sub-decisão 6 ("expirados fora de (a)") cobre cooldown_expired separadamente.
  const inquiryEventLog = (input.state.eventLog ?? []) as ReadonlyArray<EventEntry>;
  const inquiryProfileConfig = extractProfileConfig(
    input.persona.profile as Record<string, unknown> | undefined,
  );
  const inquiryRepetitionCounts = extractRepetitionCounts(inquiryEventLog);
  const inquiryBrejoActive = shouldPauseProgram(statusMatrix).paused;
  const inquiryDecision = shouldAskRepetitionInquiry({
    profileConfig: inquiryProfileConfig,
    repetitionCounts: inquiryRepetitionCounts,
    turn: input.state.turn ?? 0,
    sessionMode,
    brejoActive: inquiryBrejoActive,
    inquiriesThisSession: countInquiriesInSession(inquiryEventLog),
    turnsSinceLastInquiry: turnsSinceLastInquiry(inquiryEventLog),
    eligiblePoolIds: eligible.map((item) => item.id),
  });
  if (inquiryDecision.ask) {
    contextHints["repetition_inquiry"] = {
      candidate_ids: inquiryDecision.candidateIds,
      threshold_used: inquiryDecision.thresholdUsed,
      default_on_skip: inquiryDecision.defaultOnSkip,
    };
  } else if (inquiryDecision.suppressedReason) {
    contextHints["repetition_inquiry_suppressed"] = inquiryDecision.suppressedReason;
  }

  // motor#25 (handoff #25 B4): Trigger Evaluator — avalia transitions.yaml
  // contra signals capturados nos últimos 5 turns. Read-only — orchestrator
  // loga events transition_evaluated, statusMatrix NÃO move automático.
  const profileId = inferProfileId(input.persona);
  const eventLog = (input.state.eventLog ?? []) as Array<{
    type: string;
    data: Record<string, unknown>;
  }>;
  const recentSignals = collectRecentSignals(eventLog, 5);
  const turnsSinceLastTransition = countTurnsSinceLastTransition(eventLog);
  const transitionEvaluations =
    recentSignals.length > 0
      ? evaluateAllTransitions(profileId, recentSignals, turnsSinceLastTransition)
      : [];

  // motor#25 (handoff #25 B5): Shannon entropy do candidate set antes de retornar.
  const candidateSetEntropy = shannonEntropy(slimPool.map((s) => s.item.id));

  return {
    strategicRationale: rationale.strategicRationale,
    contentPool: slimPool,
    contextHints,
    instruction_addition: gardnerInstruction.text,
    transitionEvaluations: transitionEvaluations.length > 0 ? transitionEvaluations : undefined,
    candidateSetEntropy,
  };
}

/**
 * motor#25 — infere profileId pra Trigger Evaluator carregar transitions.yaml.
 * v0: hard-coded "kids" (único perfil com transitions.yaml committed).
 * Pós-piloto: persona.profile pode ter campo `profile_id` explícito.
 */
function inferProfileId(persona: PlanTurnInput["persona"]): string {
  const profile = (persona.profile ?? {}) as Record<string, unknown>;
  const explicit = profile["profile_id"];
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  return "kids";
}

/**
 * motor#25 — conta turns desde último transition_evaluated event tipo "fired".
 * Se nenhum, retorna o total de turns (assume estado inicial).
 */
function countTurnsSinceLastTransition(
  eventLog: Array<{ type: string; data: Record<string, unknown> }>,
): number {
  let count = 0;
  for (let i = eventLog.length - 1; i >= 0; i--) {
    const ev = eventLog[i]!;
    if (ev.type === "transition_evaluated") {
      const data = ev.data as { fired?: boolean };
      if (data.fired) return count;
    }
    if (ev.type === "playbook_executed") count++;
  }
  return count;
}

/**
 * motor#25 (handoff #25 B5) — Shannon entropy de uma lista de strings.
 * H(X) = -Σ p(x) * log2(p(x)). 0 = todos iguais; max = log2(n) com tudo único.
 *
 * Usado pra detectar "carrossel": se entropy baixa nos turns sucessivos =
 * pool repetitivo. Read-only — só registra em event pra MotorOps.
 */
export function shannonEntropy(values: string[]): number {
  if (values.length <= 1) return 0;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const total = values.length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Extrai `parental_profile` da persona (fixture pattern v1). */
function extractParentalProfile(persona: PlanTurnInput["persona"]): ParentalProfile | undefined {
  const profile = (persona.profile ?? {}) as Record<string, unknown>;
  const raw = profile["parental_profile"];
  if (!raw || typeof raw !== "object") return undefined;
  return raw as ParentalProfile;
}

/** Exposto para testes. */
export { buildGardnerInstruction, extractParentalProfile };
