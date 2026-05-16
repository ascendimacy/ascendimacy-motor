/**
 * Trio orchestrator wire-up — integração runtime engine → session loop
 * (ops#1092, follow-up motor#129).
 *
 * Responsabilidades:
 *   - Carregar TrioRuntimeConfig de `kids.group.playbook.yaml` (ou outro path).
 *   - Inicializar TrioState a partir de participants.
 *   - Per-turn hook que chama `decideNextSpeaker` e devolve target.
 *   - Append de TurnHistoryEntry pós-turn.
 *   - Emit de warnings via callback (caller plugga sink — tipicamente
 *     `motor-execucao.log_event`).
 *
 * Design choices (CC defaults ratify Jun ops#1092):
 *   - **Pure module**: sem IO direto pra MCP; recebe state mutável + warnings
 *     callback. Caller (cli ou group-session.ts) wireia tudo.
 *   - **No-modify runTurn**: integração é wrapper, não invade `orchestrator.ts`.
 *     Dyad solo paths (existing) ficam intactos.
 *   - **In-memory state**: TrioState passado por referência; caller persiste
 *     se quiser (v1 não persiste cross-session).
 *
 * Doctrine cross-ref:
 *   ascendimacy-ops/docs/fundamentos/ebrota-kids-dinamicas-grupo.md §10 + §11
 *   ascendimacy-ops/docs/playbooks/kids.group.playbook.yaml
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
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
  type TurnSpeakerType,
} from "@ascendimacy/shared";
import {
  buildTrioConfigFromPlaybook,
  decideNextSpeaker,
  modeFromParticipantCount,
} from "./trio-runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve path canônico do playbook YAML de grupo.
 *
 * Order de resolução:
 *   1. `overridePath` se fornecido.
 *   2. `<motor>/playbooks/kids.group.playbook.yaml` (canon local).
 *   3. Undefined → caller cai em DEFAULT_TRIO_RUNTIME_CONFIG.
 *
 * Spec note: a fonte canônica vive em ascendimacy-ops/docs/playbooks/
 * mas o motor monorepo recebe uma cópia em `playbooks/` (sync manual ou via
 * symlink — fora do scope desta story).
 */
export function resolveGroupPlaybookPath(overridePath?: string): string | undefined {
  if (overridePath) {
    return existsSync(overridePath) ? overridePath : undefined;
  }
  const canonLocal = join(__dirname, "../../playbooks/kids.group.playbook.yaml");
  return existsSync(canonLocal) ? canonLocal : undefined;
}

/**
 * Carrega TrioRuntimeConfig a partir de um YAML file.
 *
 * Falha-soft: file inexistente → DEFAULT_TRIO_RUNTIME_CONFIG.
 * Parse error → propaga (yaml.load throws YAMLException).
 *
 * `personaIdAliases.saki` mapeia o id canonical da fixture pra `saki`
 * (chave usada pelo schema YAML `absence_threshold_rounds_saki`).
 */
export function loadTrioConfigFromPlaybook(
  playbookPath?: string,
  personaIdAliases: { saki?: string } = {},
): TrioRuntimeConfig {
  const resolved = resolveGroupPlaybookPath(playbookPath);
  if (!resolved) return { ...DEFAULT_TRIO_RUNTIME_CONFIG };
  const raw = yaml.load(readFileSync(resolved, "utf-8"));
  return buildTrioConfigFromPlaybook(raw, personaIdAliases);
}

/**
 * Inicializa TrioState pra uma nova sessão.
 *
 * - Determina `mode` automaticamente do count (dyad=2, trio=3+) se não
 *   passado explicitamente.
 * - turnHistory inicia vazio.
 * - brejoSignals inicia vazio (caller injeta per-turn via prepareTurn).
 *
 * Errors quando participants vazio (session sem participants é caso patológico).
 */
export function initTrioState(
  participants: TrioParticipant[],
  mode?: GroupMode,
): TrioState {
  if (participants.length === 0) {
    throw new Error("initTrioState: participants vazio");
  }
  return {
    mode: mode ?? modeFromParticipantCount(participants.length),
    participants: [...participants],
    turnHistory: [],
    brejoSignals: [],
  };
}

/**
 * Próximo round number a usar em TurnHistoryEntry.
 *
 * Round 1 = primeiro round (bot prompt + child responses). Round 0 reservado
 * pra inaugural turn (motor#127) se relevante.
 *
 * Strategy: 1 + max(round) no histórico; vazio → 1.
 */
export function nextRoundNumber(state: TrioState): number {
  if (state.turnHistory.length === 0) return 1;
  return 1 + Math.max(...state.turnHistory.map((e) => e.round));
}

/**
 * Resultado do per-turn hook. Caller usa `decision.target` pra rotear:
 *   - "bot" → drota gera prompt, endereça participants exceto excludedParticipants
 *   - "child" → drota direciona prompt a `decision.nextSpeakerHint`
 *   - "pause_full" → não chama drota; espera signal externo (timer, parent)
 *   - "pause_partial" → semelhante mas mantém alguns participants engajáveis
 *
 * `roundNumber` é o round que o caller vai usar quando registrar a turn entry.
 */
export interface PrepareTurnResult {
  decision: TrioDecision;
  roundNumber: number;
}

/**
 * Per-turn hook: chama decideNextSpeaker e devolve roundNumber pré-computado.
 *
 * Mutates `state.brejoSignals` pra refletir o snapshot passado (caller-side
 * convention: brejo signals são per-turn, não acumulativos cross-turn).
 *
 * Warnings vêm dentro de `decision.warnings`. Caller decide se emite ao
 * event_log via `emitWarnings` callback abaixo.
 */
export function prepareTurn(
  state: TrioState,
  config: TrioRuntimeConfig,
  brejoSignals: BrejoSignal[] = [],
): PrepareTurnResult {
  state.brejoSignals = [...brejoSignals];
  const decision = decideNextSpeaker(state, config);
  return { decision, roundNumber: nextRoundNumber(state) };
}

/**
 * Append da turn entry no histórico — pos-execução, side-effect controlado.
 *
 * Não muta brejoSignals (caller já gerencia).
 *
 * Retorna o entry appended pra trace/log convenience.
 */
export function appendTurnHistory(
  state: TrioState,
  entry: {
    round: number;
    speakerType: TurnSpeakerType;
    personaId?: string;
    timestamp?: string;
  },
): TurnHistoryEntry {
  const fullEntry: TurnHistoryEntry = {
    round: entry.round,
    speakerType: entry.speakerType,
    personaId: entry.personaId,
    timestamp: entry.timestamp ?? new Date().toISOString(),
  };
  state.turnHistory.push(fullEntry);
  return fullEntry;
}

/**
 * Severity mapping pros TrioWarning kinds — useful pra event_log sink.
 *
 * CC default ratify Jun ops#1092:
 *   - dominance_detected, absence_detected → "info" (observability)
 *   - bot_ratio_exceeded, consecutive_bot_turns_exceeded → "warn"
 *     (action implícita: bot perdeu turn)
 */
export const TRIO_WARNING_SEVERITY = {
  bot_ratio_exceeded: "warn",
  consecutive_bot_turns_exceeded: "warn",
  dominance_detected: "info",
  absence_detected: "info",
} as const;

export type TrioWarningSeverity =
  (typeof TRIO_WARNING_SEVERITY)[keyof typeof TRIO_WARNING_SEVERITY];

export interface EmittableWarning {
  kind: TrioWarning["kind"];
  severity: TrioWarningSeverity;
  personaId?: string;
  reason: string;
  value?: number;
}

/**
 * Converte TrioWarning[] em formato amigável pra event_log sink.
 * Pure function (sem IO).
 */
export function annotateWarnings(warnings: TrioWarning[]): EmittableWarning[] {
  return warnings.map((w) => ({
    kind: w.kind,
    severity: TRIO_WARNING_SEVERITY[w.kind],
    personaId: w.personaId,
    reason: w.reason,
    value: w.value,
  }));
}

/**
 * Sink callback type — caller plugga sua implementação (typically
 * wrap around motor-execucao.log_event com type="trio_warning").
 *
 * Async para suportar IO. NÃO deve throw — sink errors são swallowed
 * pelo caller pra preservar session.
 */
export type WarningSink = (
  warnings: EmittableWarning[],
  context: {
    sessionId: string;
    roundNumber: number;
    decisionTarget: TrioDecision["target"];
  },
) => Promise<void>;

/**
 * Helper: dispatch warnings via sink, fail-soft.
 *
 * Loga sink errors em console.warn (não throw). Mantém session viva mesmo
 * com event_log offline.
 */
export async function emitWarnings(
  decision: TrioDecision,
  context: { sessionId: string; roundNumber: number },
  sink?: WarningSink,
): Promise<void> {
  if (!sink || decision.warnings.length === 0) return;
  const annotated = annotateWarnings(decision.warnings);
  try {
    await sink(annotated, {
      sessionId: context.sessionId,
      roundNumber: context.roundNumber,
      decisionTarget: decision.target,
    });
  } catch (err) {
    // Fail-soft: warnings nunca quebram session.
    // eslint-disable-next-line no-console
    console.warn(
      `[trio-orchestrator] WarningSink falhou (swallowed): ${String(err).slice(0, 120)}`,
    );
  }
}
