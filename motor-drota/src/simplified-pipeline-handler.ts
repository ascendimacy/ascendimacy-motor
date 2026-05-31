/**
 * Simplified Pipeline Handler — Sprint 5 #8 (feature flag side-by-side).
 *
 * Wire dos 3 componentes novos (Unified Assessor + Pragmatic Selector +
 * Constrained Materializer) + Inaugural Template Resolver. Acionado via
 * env USE_SIMPLIFIED_PIPELINE=true em server.ts.
 *
 * Spec: ascendimacy-ops/docs/handoffs/2026-04-28-motor-simplificacao-step5-handoff.md
 *
 * Estratégia B: side-by-side, fluxo antigo PRESERVADO em server.ts.
 * Rollback = remover env var.
 *
 * Re-implementação clean de feat/motor-simplificacao-v1 commit 8a92b2a.
 * Extraído pra arquivo separado (vs inline em server.ts) pra reduzir
 * diff no server.ts e manter handler isolado/testável.
 */

import type {
  ContentItem,
  EngineStateSnapshot,
  EngineTraceV2,
  EvaluateAndSelectInput,
  EvaluateAndSelectOutput,
  ScoredContentItem,
  SubjectKnowledgeEntry,
  SubjectKnowledgeWriteTrace,
  SubjectKnowledgeWriter,
} from "@ascendimacy/shared";
import {
  computeStateDiff,
  createLlmTraceCollector,
  extractDiscoveries,
  extractBoundaryEvents,
  extractPresentedConcepts,
  resolveSessionState,
  composeStrategyPlan,
  type JourneyStage,
  type SessionPhase,
  type StrategyPlan,
  type SubjectKnowledgeEntry as SkEntry,
} from "@ascendimacy/shared";

// ─────────────────────────────────────────────────────────────────────────
// TV2-4 helpers — state snapshot + SK write annotation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Mapeia o `type` da SubjectKnowledgeEntry para o `writer` que a emitiu.
 * Inferência heurística — fonte da verdade são os writers, mas como
 * extract*() funções não anotam writer, derivamos do tipo.
 */
function inferWriter(type: string): SubjectKnowledgeWriter {
  if (type === "presented_concept") return "concept_ledger";
  if (type === "boundary_event") return "boundary";
  if (type === "recall_check_attempt") return "recall_check";
  if (type === "axis_attempt_outcome") return "axis_attempt_outcome";
  if (type === "vertical_affinity_signal") return "vertical_affinity";
  if (type === "interest" || type === "value" || type === "need" || type === "discovery") {
    return "discovery";
  }
  return "other";
}

/**
 * Constrói EngineStateSnapshot a partir do input.state + contextHints.
 * Apenas campos disponíveis no contexto motor-drota; STS forwarder
 * (TV2-5) pode enriquecer com dados extras (parental_profile etc).
 */
function buildStateSnapshot(
  input: EvaluateAndSelectInput,
  budgetRemaining: number,
  journeyStage: JourneyStage,
  phase?: SessionPhase,
): EngineStateSnapshot {
  const snapshot: EngineStateSnapshot = {
    trust_level: input.state.trustLevel ?? 0.5,
    budget_remaining: budgetRemaining,
    journey_state: {
      stage: journeyStage,
      discoveries_count: 0,
      families_covered: [],
    },
  };
  if (phase) snapshot.current_session_phase = phase;
  const helix = input.state.kidsHelixState;
  if (helix) {
    // KidsHelixState não tem activeLevel explícito — derivamos como 1
    // (Dreyfus level 1 = novice). cycle_progress aproximamos via current_day
    // / 17 (ciclo 0-17 dias). active_pair[0] como dim primária.
    const activeDimension = helix.active_pair?.[0] ?? "SA";
    const cycleDay = helix.current_day ?? 0;
    snapshot.helix_state = {
      activeDimension,
      activeLevel: 1,
      cycleDay,
      progress: Math.min(Math.max(cycleDay / 17, 0), 1),
    };
  }
  const proposedHint = input.contextHints?.["subject_proposed"] as
    | { axes_active: number[] }
    | undefined;
  if (proposedHint) {
    snapshot.subject_proposed = {
      version: 1,
      axes_active: proposedHint.axes_active ?? [],
      ratified_at: null,
    };
  }
  return snapshot;
}

/** PR 2 tracer — confidence threshold por fase pro DiscoveryWriter. */
const DISCOVERY_MIN_CONFIDENCE_BY_PHASE: Record<SessionPhase, number> = {
  ice_breaker: 0.4,        // agressivo — captura sinais frágeis
  challenge_explain: 0.5,
  challenge_execute: 0.6,  // normal
  follow_up: 0.7,          // conservador — só sinais fortes
};

import { assess } from "./unified-assessor.js";
import { selectAction } from "./pragmatic-selector.js";
import { materialize } from "./constrained-materializer.js";
import { resolveInauguralTemplate } from "./inaugural-template.js";
import { tactician } from "./tactician.js";
import { speak } from "./speaker.js";
import { selectDiscoveryOption } from "./discovery-option-selector.js";
import { selectExplainOption } from "./explain-option-selector.js";
import { generateExplainOptions } from "./explain-agent.js";
import type { TacticDecision } from "@ascendimacy/shared";

export interface SimplifiedPipelineOpts {
  /** TV2-4 (spec ops#1136): captura engine trace v2 no output. Default true. */
  captureTrace?: boolean;
}

export async function handleSimplifiedPipeline(
  input: EvaluateAndSelectInput,
  ranked: ScoredContentItem[],
  opts: SimplifiedPipelineOpts = {},
): Promise<EvaluateAndSelectOutput> {
  const captureTrace = opts.captureTrace ?? true;
  const turnStartedAt = new Date().toISOString();
  const collector = captureTrace ? createLlmTraceCollector() : undefined;
  const warnings: EngineTraceV2["warnings"] = [];

  // Mensagem do sujeito vem em contextHints.last_user_message; fallback
  // pra instruction_addition se ausente; se ambos vazios, assess opera com
  // string vazia (mood=5 conservador via rule-based).
  const lastUserMessage =
    (input.contextHints?.["last_user_message"] as string | undefined) ??
    (input.instruction_addition ?? "");

  const recentTurns =
    (input.contextHints?.["recent_turns"] as
      | Array<{ role: "user" | "assistant"; content: string }>
      | undefined) ?? [];

  // 1. Unified Assessor — extrai mood + signals + engagement em 1 chamada.
  const assessment = await assess(
    {
      message: lastUserMessage,
      recentTurns,
      personaName: input.persona.name,
      personaAge: input.persona.age,
      trustLevel: input.state.trustLevel,
      run_id: input.sessionId,
    },
    collector ? { collector } : undefined,
  );

  // Assessment snapshot pro EvaluateAndSelectOutput (compat opt-in).
  const assessmentForOutput = {
    mood: assessment.mood,
    mood_method: assessment.mood_method,
    mood_confidence: assessment.mood_confidence,
    signals: assessment.signals,
    engagement: assessment.engagement,
  };

  // ── PR 2 tracer: resolveSessionState pra phase-aware behavior ──
  // Journey stage vem por contextHints (planejador hidrata via BFF).
  // Default discovery_only quando ausente (backcompat — primeiras sessões
  // sem fase aplicada).
  const journeyStage =
    (input.contextHints?.["journey_stage"] as JourneyStage | undefined) ??
    "discovery_only";
  const sessionState = resolveSessionState({
    turn: input.state.turn,
    journeyStage,
  });

  // ── PR 3 tracer: Strategist.compose no início (turn 1) ──
  // Só ativo em applied_double_helix; outras stages = null.
  // v1: heurística template-based (sem LLM call).
  let strategyPlan: StrategyPlan | undefined;
  if (
    journeyStage === "applied_double_helix" &&
    input.state.turn <= 1
  ) {
    const prior = (input.contextHints?.["subject_knowledge_entries"] as
      | SkEntry[]
      | undefined) ?? [];
    const latentNeeds = input.contextHints?.["latent_needs"] as
      | string[]
      | undefined;
    const subjectProposed = input.contextHints?.["subject_proposed"] as
      | { axes_active: number[]; complements_per_axis: Record<number, string[]> }
      | undefined;
    const composed = composeStrategyPlan({
      sessionId: input.sessionId,
      subjectId: input.persona.id,
      journeyStage,
      knowledgeEntries: prior,
      latentNeeds,
      subjectProposed,
    });
    if (composed) strategyPlan = composed;
  }

  // ── Subject Knowledge Fase 2: writers extraem eventos do turn ──
  const turnRef = `${input.sessionId}__turn_${input.state.turn}`;
  const subjectKnowledgeEvents: SubjectKnowledgeEntry[] = [];
  // 1. Descobertas (interest/value/need) — só da fala do sujeito.
  //    PR 2: threshold de confidence ajustado por fase
  //    (ice_breaker agressivo, follow_up conservador).
  subjectKnowledgeEvents.push(
    ...extractDiscoveries({
      subjectId: input.persona.id,
      sessionId: input.sessionId,
      turnRef,
      lastUserMessage,
      signals: assessment.signals,
      mood: assessment.mood,
      minConfidence: DISCOVERY_MIN_CONFIDENCE_BY_PHASE[sessionState.phase],
    }),
  );
  // 2. Boundary events — registra recuo quando signals indicam.
  // topicCategory v1: extraído do avoid[] do plan ou marcado como
  // indefinido. Abstração mais sofisticada vem em fase futura.
  const avoid = input.contextHints?.["avoid"];
  const topicCategory =
    Array.isArray(avoid) && avoid.length > 0
      ? String(avoid[0])
      : typeof avoid === "string"
      ? avoid
      : "indefinido";
  subjectKnowledgeEvents.push(
    ...extractBoundaryEvents({
      subjectId: input.persona.id,
      sessionId: input.sessionId,
      turnRef,
      signals: assessment.signals,
      topicCategory,
    }),
  );

  // 2. Pragmatic Selector — determinístico, zero LLM.
  // CP8 / Item 12 — propaga helix_active_pair e move_type pra tie-break helix.
  const helixActivePair = Array.isArray(input.contextHints?.["helix_active_pair"])
    ? (input.contextHints["helix_active_pair"] as readonly string[])
    : undefined;
  const tutorialMoveType = (
    input.contextHints?.["tutorial"] as { move_type?: string } | undefined
  )?.move_type as
    | "explain"
    | "check"
    | "correct"
    | "apply"
    | "recall"
    | "close"
    | "compose_playbook"
    | undefined;
  const selectionResult = selectAction(
    {
      candidates: ranked,
      assessment,
      state: input.state,
      helixActivePair,
      tutorialMoveType,
    },
    captureTrace ? { captureTrace: true } : undefined,
  );

  // Escalação: pool sem viáveis ou budget exausto → fallback conversacional.
  if (!selectionResult.selected || selectionResult.escalate_to !== null) {
    const fallbackItem: ScoredContentItem = selectionResult.selected ?? (ranked[0] ?? {
      item: {
        id: "__empty_pool__",
        type: "curiosity_hook",
        domain: "generic",
        casel_target: [],
        age_range: [0, 99],
        surprise: 7,
        verified: false,
        base_score: 0,
        fact: "",
        bridge: "",
        quest: "",
        sacrifice_type: "reflect",
      } as ContentItem,
      score: 0,
      reasons: ["simplified_pipeline_escalation"],
    });
    return {
      selectedContent: fallbackItem,
      selectionRationale: selectionResult.decision_path,
      linguisticMaterialization: "Me conta o que está passando na sua cabeça.",
      assessment: assessmentForOutput,
      subjectKnowledgeEvents,
      sessionState,
      ...(strategyPlan ? { strategyPlan } : {}),
      ...(selectionResult.escalate_reason
        ? { skipReason: selectionResult.escalate_reason }
        : {}),
    };
  }

  // 3a. Apresentação inaugural — turn 0 + flag explícita em contextHints.
  //     Cascade resolver não chama LLM; texto retorna direto pro Bridge.
  const isInauguralTurn =
    input.state.turn === 0 &&
    input.contextHints?.["is_inaugural_turn"] === true;

  if (isInauguralTurn) {
    const inauguralResult = resolveInauguralTemplate({
      voiceProfile:
        (input.contextHints?.["client_voice_profile"] as Record<
          string,
          unknown
        > | undefined) ?? null,
      culturalDefault:
        (input.contextHints?.["cultural_default"] as Record<
          string,
          unknown
        > | undefined) ?? null,
      child: {
        name: input.persona.name,
        age: input.persona.age,
      },
      sessionNumber: 1,
    });
    return {
      selectedContent: selectionResult.selected,
      selectionRationale: selectionResult.decision_path,
      linguisticMaterialization: inauguralResult.text,
      assessment: assessmentForOutput,
      subjectKnowledgeEvents,
      sessionState,
      ...(strategyPlan ? { strategyPlan } : {}),
    };
  }

  // Fase 8 PR — recall check candidate (spec §4.5). Caller hidrata
  // via contextHints quando RecallCheckEvaluator (BFF/orchestrator)
  // decide testar concept anterior. Materializer anexa framing ao Fact.
  // Integração full com evaluator in-process vem em PR futuro.
  // Note: recall_check only applies to the legacy materializer path.
  const recallCheckCandidate = input.contextHints?.["recall_check_candidate"] as
    | { concept_id: string; suggested_framing: string }
    | undefined;

  // 3b. Geração de fala — dois caminhos:
  //   USE_SPLIT_DROTA=true  → S4: Tactician (decide jogada) + Speaker (gera texto)
  //   USE_SPLIT_DROTA=false → legado: Constrained Materializer direto
  // Feature flag backward-compatible (default false).
  const USE_SPLIT_DROTA = process.env.USE_SPLIT_DROTA === "true";

  let tacticDecision: TacticDecision | undefined;
  let tacticianTrace: import("@ascendimacy/shared").TacticianTrace | undefined;
  let speakerTrace: import("@ascendimacy/shared").SpeakerTrace | undefined;

  let finalText: string;
  let fallbackTriggered: boolean;
  let recallCheckEmitted:
    | { concept_id: string; framing_used: string }
    | undefined;
  let materializerTrace:
    | import("@ascendimacy/shared").MaterializerTrace
    | undefined;

  // v0.2.8 — Discovery-Specific Pool short-circuit.
  // Quando planejador emitiu contextHints.discovery_options (porque move_type=
  // discover), bypassamos o materializer LLM. O finalText vem da opção
  // escolhida por selectDiscoveryOption (v0.3-A: heurística por signal + turn).
  //
  // Motivação: STS realista mostrou LLM ignorando MOVIMENTO: descobrir e
  // empurrando content do pool estático. Dar pool DIFERENTE (questões de
  // descoberta) + curto-circuitar materializer = honra contrato sem depender
  // do LLM seguir instrução negativa.
  //
  // fallbackTriggered=true por design — não apresentamos conteúdo educacional,
  // então concept ledger não acumula presented_concept (gate pedagogicamente
  // correto pra fase de discovery).
  const discoveryOptions = input.contextHints?.["discovery_options"] as
    | Array<{ kind: string; text: string; anchor: string }>
    | undefined;
  const discoveryShortCircuit =
    Array.isArray(discoveryOptions) && discoveryOptions.length > 0;

  if (discoveryShortCircuit) {
    const extractedSignals =
      (input.contextHints?.["extracted_signals"] as string[] | undefined) ?? [];
    const combinedSignals = Array.from(
      new Set([...extractedSignals, ...assessment.signals]),
    );
    const selection = selectDiscoveryOption({
      options: discoveryOptions!,
      signals: combinedSignals,
      turn: input.state.turn,
    });
    finalText = selection.chosen.text;
    warnings.push({
      component: "discovery_option_selector",
      message: `kind=${selection.chosen.kind} reason=${selection.reason}`,
      recoverable: true,
    });
    fallbackTriggered = true;
    recallCheckEmitted = undefined;
  } else if (tutorialMoveType === "explain" && selectionResult.selected) {
    // v0.3-B — Explain Dynamic Pool short-circuit.
    // Quando tutorial.move_type=explain, geramos 4 framings (concrete_example,
    // metaphor, contrast, lineage_anchor) ancorados no item já selecionado,
    // selector escolhe por signals, materializer é curto-circuitado.
    //
    // fallbackTriggered=false por design — explain APRESENTA conceito, então
    // o ledger DEVE contabilizar presented_concept (gate pedagógico correto).
    const item = selectionResult.selected.item;
    // ContentItem é union discriminada; fact/bridge/quest existem em curiosity_hook
    // e cultural_diamond (não em card_catalog). Acesso narrowing-safe via cast.
    const itemAny = item as {
      id: string;
      fact?: string;
      bridge?: string;
      quest?: string;
      extracted_keywords?: readonly string[];
      lineage_anchor?: string;
    };
    const explainOptions = await generateExplainOptions({
      item: {
        id: itemAny.id,
        ...(itemAny.fact ? { fact: itemAny.fact } : {}),
        ...(itemAny.bridge ? { bridge: itemAny.bridge } : {}),
        ...(itemAny.quest ? { quest: itemAny.quest } : {}),
        ...(itemAny.extracted_keywords ? { keywords: itemAny.extracted_keywords } : {}),
        ...(itemAny.lineage_anchor ? { lineage_anchor: itemAny.lineage_anchor } : {}),
      },
      recentTurns,
      subjectName: input.persona.name,
      signals: assessment.signals,
      runId: input.sessionId,
    });
    const extractedSignals =
      (input.contextHints?.["extracted_signals"] as string[] | undefined) ?? [];
    const combinedSignals = Array.from(
      new Set([...extractedSignals, ...assessment.signals]),
    );
    const selection = selectExplainOption({
      options: explainOptions,
      signals: combinedSignals,
    });
    finalText = selection.chosen.text;
    warnings.push({
      component: "explain_option_selector",
      message: `kind=${selection.chosen.kind} reason=${selection.reason}`,
      recoverable: true,
    });
    fallbackTriggered = false;
    recallCheckEmitted = undefined;
  } else if (USE_SPLIT_DROTA) {
    // ── S4 path ──────────────────────────────────────────────────────────
    // Step 1: Tactician decides jogada from content pool + assessor signals.
    const tacResult = await tactician(
      {
        contentPool: ranked.slice(0, 8),
        contextHints: input.contextHints ?? {},
        strategicRationale: selectionResult.decision_path,
        signals: assessment.signals,
        mood: assessment.mood,
        engagement: assessment.engagement,
        run_id: input.sessionId,
      },
      collector ? { collector } : undefined,
    );
    tacticDecision = tacResult.decision;
    if (tacResult._trace) tacticianTrace = tacResult._trace;

    // Step 2: Speaker executes TacticDecision in speech.
    // Resolve the selected item from the ranked pool (Tactician may have
    // overridden the selector's choice).
    const speakerAction =
      ranked.find((c) => c.item.id === tacticDecision!.selected_item_id) ??
      selectionResult.selected;
    const spkResult = await speak(
      {
        decision: tacticDecision,
        action: speakerAction,
        subjectNameForm: input.persona.name,
        mood: assessment.mood,
        engagement: assessment.engagement,
        turnCount: input.state.turn,
        budgetRemaining: input.state.budgetRemaining,
        jurisdictionActive:
          ((input.contextHints?.["jurisdiction_active"] as string | undefined) ??
            "br") as "br" | "jp" | "ch",
        incomingMessage: lastUserMessage,
        recentTurns,
        run_id: input.sessionId,
      },
      collector ? { collector } : undefined,
    );
    finalText = spkResult.text;
    fallbackTriggered = spkResult.fallback_triggered;
    if (spkResult._trace) speakerTrace = spkResult._trace;
    recallCheckEmitted = undefined; // not supported in split path (yet)
  } else {
    // ── Legacy path: Constrained Materializer ────────────────────────────
    const matResult = await materialize(
      {
        action: selectionResult.selected,
        subjectNameForm: input.persona.name,
        mood: assessment.mood,
        engagement: assessment.engagement,
        turnCount: input.state.turn,
        budgetRemaining: input.state.budgetRemaining,
        jurisdictionActive:
          ((input.contextHints?.["jurisdiction_active"] as string | undefined) ??
            "br") as "br" | "jp" | "ch",
        run_id: input.sessionId,
        incomingMessage: lastUserMessage,
        recentTurns,
        ...(recallCheckCandidate ? { recallCheckCandidate } : {}),
      },
      collector ? { collector } : undefined,
    );
    finalText = matResult.text;
    fallbackTriggered = matResult.fallback_triggered;
    recallCheckEmitted = matResult.recall_check_emitted;
    if (matResult._trace) materializerTrace = matResult._trace;
  }

  // ── Fase 3: ConceptLedgerWriter — após materializar o Fact, emite
  // presented_concept (+1pt) se item está taggeado com axis_id/family/
  // lineage_anchor/extracted_keywords. Items legados sem tags simplesmente
  // não geram entry. Fallback (rawText vazio) também não conta.
  // PR 2: sessionPhase gate — ice_breaker NÃO acumula ledger.
  if (!fallbackTriggered) {
    subjectKnowledgeEvents.push(
      ...extractPresentedConcepts({
        subjectId: input.persona.id,
        sessionId: input.sessionId,
        turnRef,
        item: selectionResult.selected.item,
        sessionPhase: sessionState.phase,
      }),
    );
  }

  // Fase 8 PR — Quando recall_check foi emitido, grava attempt no ledger.
  // Resposta é classificada no turn seguinte via classifyRecallResponse
  // (não in-process aqui — caller resolve). points_awarded=0 inicialmente;
  // BFF/orchestrator atualiza pra 5 quando resposta=positive.
  if (recallCheckEmitted) {
    subjectKnowledgeEvents.push({
      id: `sk-rc-${input.persona.id}-${turnRef}-${recallCheckEmitted.concept_id}`,
      subject_id: input.persona.id,
      type: "recall_check_attempt",
      source: "motor_inferred",
      confidence: 1.0,
      confirmed_at: turnRef,
      alignment: "unknown",
      payload: {
        kind: "recall_check_attempt",
        concept_id_referenced: recallCheckEmitted.concept_id,
        framing_used: recallCheckEmitted.framing_used,
        result: "ambiguous", // pending — classify no turn seguinte
        points_awarded: 0,
      },
      turn_ref: turnRef,
      session_id: input.sessionId,
      created_at: new Date().toISOString(),
    });
  }

  let engineTrace: EngineTraceV2 | undefined;
  if (captureTrace) {
    const preState = buildStateSnapshot(
      input,
      input.state.budgetRemaining,
      journeyStage,
      sessionState.phase,
    );
    const postState = buildStateSnapshot(
      input,
      selectionResult.newState.budgetRemaining,
      journeyStage,
      sessionState.phase,
    );
    const skWrites: SubjectKnowledgeWriteTrace[] = subjectKnowledgeEvents.map(
      (e) => ({
        type: e.type,
        payload: e.payload as unknown as Record<string, unknown>,
        writer: inferWriter(e.type),
        triggered_by: e.confirmed_at ?? "motor_inferred",
      }),
    );
    engineTrace = {
      schema_version: 2,
      turn_started_at: turnStartedAt,
      turn_completed_at: new Date().toISOString(),
      pre_state: preState,
      post_state: postState,
      state_diff: computeStateDiff(preState, postState, skWrites.length),
      components: {
        ...(assessment._trace ? { unified_assessor: assessment._trace } : {}),
        ...(selectionResult._trace
          ? { pragmatic_selector: selectionResult._trace }
          : {}),
        ...(materializerTrace
          ? { constrained_materializer: materializerTrace }
          : {}),
        ...(tacticianTrace ? { tactician: tacticianTrace } : {}),
        ...(speakerTrace ? { speaker: speakerTrace } : {}),
      },
      llm_calls: collector?.drain() ?? [],
      subject_knowledge_writes: skWrites,
      warnings,
      ...(tacticDecision ? { tactic_decision: tacticDecision } : {}),
    };
  }

  return {
    selectedContent: selectionResult.selected,
    selectionRationale: selectionResult.decision_path,
    linguisticMaterialization: finalText,
    assessment: assessmentForOutput,
    subjectKnowledgeEvents,
    sessionState,
    ...(strategyPlan ? { strategyPlan } : {}),
    ...(fallbackTriggered ? { skipReason: "materializer_fallback" } : {}),
    ...(engineTrace ? { engineTrace } : {}),
    ...(tacticDecision ? { tactic_decision: tacticDecision } : {}),
  };
}
