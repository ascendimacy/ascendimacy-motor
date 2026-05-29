import { getNow } from "./clock.js";
import type {
  EventEntry,
  ExecutePlaybookInput,
  ExecutePlaybookOutput,
  InquiryChoice,
  MilestoneEvent,
} from "@ascendimacy/shared";
import { parseRepetitionAnswer } from "@ascendimacy/shared";
import { getState, updateState, logEvent, getDbInstance } from "./state-manager.js";
import { getPlaybookById } from "./loader.js";
import type { PlaybookInventory } from "./types.js";
import {
  triggerActionMenuGeneration,
  type OnboardingTriggerDeps,
} from "./onboarding-trigger.js";
import { recordContentUsage } from "./content-usage-repo.js";

/**
 * ops#1068 — escaneia eventLog procurando inquiry pendente. Retorna o
 * último `repetition_inquiry_asked` AINDA NÃO RESOLVIDO (sem `_answered`
 * ou `_skipped` posterior). null quando não há pendência.
 *
 * NOTA: state.eventLog vem em ordem DESC (newest first) do state-manager,
 * então iteramos de 0 → length pra inspecionar do mais novo pro mais antigo.
 *
 * Usado pra decidir se userMessage do turn corrente deve ser parseado
 * como resposta à pergunta de repetição feita no turn anterior.
 */
function findPendingInquiry(
  eventLog: ReadonlyArray<EventEntry>,
): { defaultOnSkip: InquiryChoice } | null {
  for (const e of eventLog) {
    if (e.type === "repetition_inquiry_answered" || e.type === "repetition_inquiry_skipped") {
      return null; // mais recente é resolução → asked anterior já fechado
    }
    if (e.type === "repetition_inquiry_asked") {
      const raw = (e.data as Record<string, unknown>)["default_on_skip"];
      const defaultOnSkip: InquiryChoice =
        raw === "a" || raw === "b" || raw === "c" ? raw : "b";
      return { defaultOnSkip };
    }
  }
  return null;
}

/**
 * S-T-09-03 (ops#994): hook opcional pra trigger de generateActionMenu
 * pós conclusão de onboarding. Injetado por server.ts em prod; ausente
 * em unit tests do executor (testes do trigger em isolated suite).
 */
export interface ExecutorOptions {
  /** Deps pra trigger ActionMenu generation. Quando ausente, hook é no-op. */
  actionMenuTriggerDeps?: OnboardingTriggerDeps;
}

export function executePlaybook(
  input: ExecutePlaybookInput,
  inventory: PlaybookInventory,
  options: ExecutorOptions = {},
): ExecutePlaybookOutput {
  const { sessionId, playbookId, selectedContentId, output, metadata } = input;
  const playbook = getPlaybookById(inventory, playbookId);

  const state = getState(sessionId);

  // ops#1068 — resolução de inquiry pendente ANTES de novos events.
  // Se eventLog tem `_asked` sem `_answered`/`_skipped` posterior, e
  // userMessage não-vazio chegou, parseia + loga _answered ou _skipped.
  const userMessage =
    typeof metadata?.["userMessage"] === "string" ? metadata["userMessage"] : "";
  const pending = findPendingInquiry(state.eventLog ?? []);
  if (pending && userMessage.length > 0) {
    const result = parseRepetitionAnswer(userMessage, pending.defaultOnSkip);
    logEvent(sessionId, {
      timestamp: getNow(),
      type: result.stage === "default"
        ? "repetition_inquiry_skipped"
        : "repetition_inquiry_answered",
      data: {
        choice: result.choice,
        stage: result.stage,
        confidence: result.confidence,
        ...(result.stage === "default"
          ? { defaulted_to: result.choice, reason: "ambiguous_or_silence" }
          : {}),
      },
    });
  }

  const event = {
    timestamp: getNow(),
    type: "playbook_executed",
    playbookId,
    data: {
      output: output.slice(0, 200),
      metadata,
      playbookFound: !!playbook,
      selectedContentId: selectedContentId ?? null,
    },
  };

  const newState = {
    ...state,
    trustLevel: Math.min(1, state.trustLevel + (playbook?.estimatedConfidenceGain ?? 0) * 0.01),
    budgetRemaining: Math.max(0, state.budgetRemaining - (playbook?.estimatedSacrifice ?? 1)),
    turn: state.turn + 1,
  };

  updateState(sessionId, newState);
  logEvent(sessionId, event);

  // ops#1068 — se TESTE turn ativou inquiry, loga `_asked` AFTER
  // playbook_executed pra próximo turn detectar pendência.
  // Persiste default_on_skip na event.data pra parsing futuro sem
  // precisar re-consultar persona profile.
  const contextHints = metadata?.["contextHints"] as Record<string, unknown> | undefined;
  const inquiry = contextHints?.["repetition_inquiry"] as
    | { candidate_ids?: string[]; threshold_used?: number; default_on_skip?: InquiryChoice }
    | undefined;
  if (inquiry && Array.isArray(inquiry.candidate_ids) && inquiry.candidate_ids.length > 0) {
    logEvent(sessionId, {
      timestamp: getNow(),
      type: "repetition_inquiry_asked",
      data: {
        candidate_ids: inquiry.candidate_ids,
        threshold_used: inquiry.threshold_used ?? null,
        default_on_skip: inquiry.default_on_skip ?? "b",
      },
    });
  }
  // Suppressed inquiry — log só pra auditoria, não bloqueia nada
  const suppressedReason = contextHints?.["repetition_inquiry_suppressed"];
  if (typeof suppressedReason === "string") {
    logEvent(sessionId, {
      timestamp: getNow(),
      type: "repetition_inquiry_suppressed",
      data: { reason: suppressedReason },
    });
  }

  // ops#1152 S1: log milestone_detected event when planejador detected one.
  const milestone = contextHints?.["milestone_detected"] as MilestoneEvent | undefined;
  if (milestone) {
    logEvent(sessionId, {
      timestamp: getNow(),
      type: "milestone_detected",
      data: milestone as unknown as Record<string, unknown>,
    });
  }

  // CP7 / Item 10 — persistir contrato tutorial em eventLog.
  // v0.2: outcome inicial mapeado por move_type (close → deferred; demais
  // → attempted). Classificação real (correct/incorrect/partial) depende de
  // detecção de feedback do sujeito — vem em v0.3 junto com check/apply.
  const tutorial = contextHints?.["tutorial"] as
    | {
        move_type?: string;
        teaching_goal?: string;
        mastery_ref?: { kind?: string; id?: string };
      }
    | undefined;
  if (tutorial && typeof tutorial.move_type === "string") {
    // v0.2.6: outcome semântico por move_type.
    //  - close   → deferred  (fechamento explícito)
    //  - discover → discovered (descoberta em andamento, sem ensino)
    //  - outros  → attempted (entregou movimento, aguarda feedback v0.3)
    const outcome =
      tutorial.move_type === "close"
        ? "deferred"
        : tutorial.move_type === "discover"
          ? "discovered"
          : "attempted";
    logEvent(sessionId, {
      timestamp: getNow(),
      type: "tutorial_outcome",
      data: {
        move_type: tutorial.move_type,
        teaching_goal: tutorial.teaching_goal ?? null,
        mastery_ref: tutorial.mastery_ref ?? null,
        outcome,
        turn: newState.turn,
      },
    });
  }

  // S-T-09-03 (ops#994): trigger fire-and-forget de generateActionMenu
  // se metadata indica conclusão de onboarding. Caller (server.ts) é
  // responsável por injetar deps em prod; ausente = no-op (legacy).
  if (options.actionMenuTriggerDeps && metadata) {
    triggerActionMenuGeneration(metadata, options.actionMenuTriggerDeps);
  }

  // ops#1067: UPSERT content_usage cross-session (per-persona, per-item).
  // Habilita decay temporal real no scorer (shared/scorer.ts) e
  // observability longitudinal (H-AC-08 future).
  //
  // Requer metadata.personaId presente — caller responsabiliza-se. Sem
  // personaId OR sem selectedContentId, skip silently (backward compat).
  const personaId =
    typeof metadata?.["personaId"] === "string" ? metadata["personaId"] : null;
  if (personaId && selectedContentId) {
    try {
      recordContentUsage(getDbInstance(), {
        personaId,
        contentId: selectedContentId,
      });
    } catch (err) {
      // Telemetry-style: não bloqueia execute_playbook se UPSERT falhar.
      // eslint-disable-next-line no-console
      console.error(
        `[executor] content_usage UPSERT falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { success: true, newState, eventLogged: event };
}
