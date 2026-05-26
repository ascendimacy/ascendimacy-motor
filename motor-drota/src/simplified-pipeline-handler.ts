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
  EvaluateAndSelectInput,
  EvaluateAndSelectOutput,
  ScoredContentItem,
  SubjectKnowledgeEntry,
} from "@ascendimacy/shared";
import {
  extractDiscoveries,
  extractBoundaryEvents,
  extractPresentedConcepts,
  resolveSessionState,
  type JourneyStage,
  type SessionPhase,
} from "@ascendimacy/shared";

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

export async function handleSimplifiedPipeline(
  input: EvaluateAndSelectInput,
  ranked: ScoredContentItem[],
): Promise<EvaluateAndSelectOutput> {
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
  const assessment = await assess({
    message: lastUserMessage,
    recentTurns,
    personaName: input.persona.name,
    personaAge: input.persona.age,
    trustLevel: input.state.trustLevel,
    run_id: input.sessionId,
  });

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
  const selectionResult = selectAction({
    candidates: ranked,
    assessment,
    state: input.state,
  });

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
    };
  }

  // Fase 8 PR — recall check candidate (spec §4.5). Caller hidrata
  // via contextHints quando RecallCheckEvaluator (BFF/orchestrator)
  // decide testar concept anterior. Materializer anexa framing ao Fact.
  // Integração full com evaluator in-process vem em PR futuro.
  const recallCheckCandidate = input.contextHints?.["recall_check_candidate"] as
    | { concept_id: string; suggested_framing: string }
    | undefined;

  // 3b. Constrained Materializer — texto final com FALLBACK handling.
  const matResult = await materialize({
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
  });

  // ── Fase 3: ConceptLedgerWriter — após materializar o Fact, emite
  // presented_concept (+1pt) se item está taggeado com axis_id/family/
  // lineage_anchor/extracted_keywords. Items legados sem tags simplesmente
  // não geram entry. Fallback (rawText vazio) também não conta.
  // PR 2: sessionPhase gate — ice_breaker NÃO acumula ledger.
  if (!matResult.fallback_triggered) {
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
  if (matResult.recall_check_emitted) {
    subjectKnowledgeEvents.push({
      id: `sk-rc-${input.persona.id}-${turnRef}-${matResult.recall_check_emitted.concept_id}`,
      subject_id: input.persona.id,
      type: "recall_check_attempt",
      source: "motor_inferred",
      confidence: 1.0,
      confirmed_at: turnRef,
      alignment: "unknown",
      payload: {
        kind: "recall_check_attempt",
        concept_id_referenced: matResult.recall_check_emitted.concept_id,
        framing_used: matResult.recall_check_emitted.framing_used,
        result: "ambiguous", // pending — classify no turn seguinte
        points_awarded: 0,
      },
      turn_ref: turnRef,
      session_id: input.sessionId,
      created_at: new Date().toISOString(),
    });
  }

  return {
    selectedContent: selectionResult.selected,
    selectionRationale: selectionResult.decision_path,
    linguisticMaterialization: matResult.text,
    assessment: assessmentForOutput,
    subjectKnowledgeEvents,
    sessionState,
    ...(matResult.fallback_triggered
      ? { skipReason: "materializer_fallback" }
      : {}),
  };
}
