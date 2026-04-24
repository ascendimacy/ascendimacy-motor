import type { ExecutePlaybookInput, ExecutePlaybookOutput } from "@ascendimacy/shared";
import { getState, updateState, logEvent } from "./state-manager.js";
import { getPlaybookById } from "./loader.js";
import type { PlaybookInventory } from "./types.js";

export function executePlaybook(
  input: ExecutePlaybookInput,
  inventory: PlaybookInventory
): ExecutePlaybookOutput {
  const { sessionId, playbookId, selectedContentId, output, metadata } = input;
  const playbook = getPlaybookById(inventory, playbookId);

  const state = getState(sessionId);
  const event = {
    timestamp: new Date().toISOString(),
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

  return { success: true, newState, eventLogged: event };
}
