import { getNow } from "./clock.js";
import type { ExecutePlaybookInput, ExecutePlaybookOutput } from "@ascendimacy/shared";
import { getState, updateState, logEvent, getDbInstance } from "./state-manager.js";
import { getPlaybookById } from "./loader.js";
import type { PlaybookInventory } from "./types.js";
import {
  triggerActionMenuGeneration,
  type OnboardingTriggerDeps,
} from "./onboarding-trigger.js";
import { recordContentUsage } from "./content-usage-repo.js";

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
