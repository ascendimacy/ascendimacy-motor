import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { McpClients } from "./mcp-clients.js";
import { initTrace, appendTurn, saveTrace } from "./trace-writer.js";
import type {
  PersonaDef,
  AdquirenteDef,
  PlaybookIndex,
  DrillItem,
  DrillState,
} from "@ascendimacy/shared";
import { logDebugEvent, matchDrillAnswer } from "@ascendimacy/shared";
import {
  proposeDrillItem,
  serializeDrillProposal,
} from "./drill-orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../../fixtures");

function loadPersona(personaId: string): PersonaDef {
  const path = join(fixturesDir, `${personaId}.yaml`);
  const raw = yaml.load(readFileSync(path, "utf-8")) as Record<string, unknown>;
  return {
    id: String(raw["id"] ?? personaId),
    name: String(raw["name"] ?? personaId),
    age: Number(raw["age"] ?? 30),
    profile: (raw["profile"] as Record<string, unknown>) ?? {},
  };
}

function loadAdquirente(): AdquirenteDef {
  const path = join(fixturesDir, "adquirente-jun.md");
  const raw = readFileSync(path, "utf-8");
  return {
    id: "jun",
    name: "Jun Ochiai",
    defaults: { style: "direto", language: "pt-br", rawRef: raw.slice(0, 200) },
  };
}

function loadInventory(): PlaybookIndex[] {
  const path = join(fixturesDir, "ebrota-inventario-v1.yaml");
  const raw = yaml.load(readFileSync(path, "utf-8")) as Record<string, unknown>;
  const entries = Array.isArray(raw["playbooks"]) ? raw["playbooks"] : [];
  return entries.slice(0, 10).map((p: Record<string, unknown>, i: number) => ({
    id: String(p["id"] ?? p["name"] ?? `playbook-${i}`),
    title: String(p["title"] ?? p["name"] ?? "untitled"),
    category: String(p["category"] ?? "general"),
    estimatedSacrifice: Number(p["estimated_sacrifice"] ?? 2),
    estimatedConfidenceGain: Number(p["estimated_confidence_gain"] ?? 3),
  }));
}

function parseToolText<T>(result: unknown): T {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  const text = content.find(c => c.type === "text")?.text ?? "{}";
  return JSON.parse(text) as T;
}

/**
 * B2 — extrai bank ids declarados em persona.profile.
 * v0: opt-in via `persona.profile.drill_bank_ids: string[]`. Sem field
 * = persona não participa do drilling (zero footprint pro pipeline).
 */
function extractDrillBankIds(persona: PersonaDef): string[] {
  const profile = (persona.profile ?? {}) as Record<string, unknown>;
  const raw = profile["drill_bank_ids"];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (typeof raw === "string") return [raw];
  return [];
}

interface PendingDrill {
  drillItemId: string;
  bankId: string;
  emittedAt: string;
  turnEmitted: number;
}

/**
 * Procura no eventLog o último `drill_emitted` que ainda não foi resolvido
 * por um `drill_attempt_recorded` subsequente. Quando presente, o `message`
 * deste turno é a tentativa do sujeito.
 */
function findPendingDrill(
  eventLog: ReadonlyArray<import("@ascendimacy/shared").EventEntry>,
): PendingDrill | null {
  for (let i = eventLog.length - 1; i >= 0; i--) {
    const ev = eventLog[i]!;
    if (ev.type === "drill_attempt_recorded") return null;
    if (ev.type === "drill_emitted") {
      const data = ev.data as {
        drill_item_id?: string;
        bank_id?: string;
        turn_number?: number;
      };
      if (typeof data.drill_item_id === "string" && typeof data.bank_id === "string") {
        return {
          drillItemId: data.drill_item_id,
          bankId: data.bank_id,
          emittedAt: ev.timestamp,
          turnEmitted: typeof data.turn_number === "number" ? data.turn_number : 0,
        };
      }
    }
  }
  return null;
}

/**
 * JointContext — Bloco 6 (#17): injeta parceiro quando rodando dyad.
 * Orchestrator busca o statusMatrix do parceiro via get_state(partnerSessionId)
 * e injeta em state.partnerStatusMatrix antes de chamar planejador.
 */
export interface JointContext {
  partnerSessionId: string;
  partnerChildId: string;
  partnerName: string;
}

/**
 * CardContext — C-MX-07 PR3 (S-OD-05). Quando turn é disparado por uma
 * carta-acionada (motor-channels detector `^card:<id>$`), pkgRaw vem do
 * pacote pedagógico (cards-loader) e é prefixado ao instruction_addition
 * antes do motor-drota evaluate_and_select. Permite o materializador
 * compor a primeira resposta sobre o conteúdo da carta sem mudar
 * planejador/drota interfaces.
 */
export interface CardContext {
  cardId: string;
  pkgRaw: string;
}

/**
 * TurnStateEvent — C-MX-07 PR4 (S-OD-06). Discriminated union dos 4
 * eventos emitidos por runTurn quando `onTurnEvent` callback é fornecido.
 * eBrota Console BFF subscreve via MCP tool `subscribe_turn_state` pra
 * renderir progressão pedagógica turn-a-turn em real-time.
 *
 * Ordem garantida: planning_started → selection_made →
 * materialization_ready → playbook_executed.
 *
 * Schema deliberadamente "achatado" (sem deep nesting) pra UI parsear
 * fácil + serialização JSON estável via MCP.
 */
/**
 * OptionsGate — C-MX-07 PR5 (S-OD-07 + S-OD-08). Hook chamado entre
 * plan_turn (contentPool emitido) e evaluate_and_select (motor-drota
 * seleciona + materializa). Permite intervenção do Jun via eBrota
 * Console:
 *  - Inspeção via `daemon.listOptions(sessionId)` — retorna pool corrente
 *  - Override via `daemon.overrideSelection(sessionId, contentItemId)` —
 *    força motor-drota a "selecionar" uma carta específica (achieved
 *    via pruning do pool pra single-item antes do evaluate_and_select)
 *
 * Em auto mode (default), optionsGate é undefined → behavior PR3 puro.
 * Em semi-auto, daemon cria gate com timeout; se timeout expira sem
 * override, runTurn segue com pool original.
 */
export interface OptionsGateInput {
  sessionId: string;
  turn: number;
  contentPool: import("@ascendimacy/shared").ScoredContentItem[];
}

export interface OptionsGateDecision {
  /** Se definido, runTurn força motor-drota a usar esse contentItemId
   *  (pool é prunado pra single-item antes de evaluate_and_select).
   *  Se undefined, segue com pool original. */
  overrideContentItemId?: string;
}

export type OptionsGate = (
  input: OptionsGateInput,
) => Promise<OptionsGateDecision>;

export type TurnStateEvent =
  | {
      type: "planning_started";
      sessionId: string;
      turn: number;
      timestamp: string;
      payload: {
        strategicRationale: string;
        contentPoolSize: number;
        contentPoolIds: string[];
        contextHints: Record<string, unknown>;
        transitionEvaluationsCount: number;
      };
    }
  | {
      type: "selection_made";
      sessionId: string;
      turn: number;
      timestamp: string;
      payload: {
        selectedContentId: string;
        selectedContentScore: number;
        selectionRationale: string;
      };
    }
  | {
      type: "materialization_ready";
      sessionId: string;
      turn: number;
      timestamp: string;
      payload: {
        proposedText: string;
        instructionAdditionApplied: boolean;
      };
    }
  | {
      type: "playbook_executed";
      sessionId: string;
      turn: number;
      timestamp: string;
      payload: {
        playbookId: string;
        success: boolean;
        newTurnNumber: number;
      };
    };

const CARD_INSTRUCTION_PREFIX = "## Conteúdo da carta-acionada\n\n";

const buildCardInstructionAddition = (
  plan: { instruction_addition?: string },
  cardContext: CardContext,
): string => {
  const cardBlock = `${CARD_INSTRUCTION_PREFIX}cardId: ${cardContext.cardId}\n\n${cardContext.pkgRaw}\n\n---\n\n`;
  const existing = plan.instruction_addition ?? "";
  return cardBlock + existing;
};

export async function runTurn(
  clients: McpClients,
  sessionId: string,
  personaId: string,
  message: string,
  tracesDir: string,
  jointContext?: JointContext,
  cardContext?: CardContext,
  onTurnEvent?: (event: TurnStateEvent) => void,
  optionsGate?: OptionsGate,
): Promise<{ finalResponse: string; tracePath: string }> {
  const emit = (ev: TurnStateEvent): void => {
    try {
      onTurnEvent?.(ev);
    } catch {
      // fail-soft: subscriber error não trava turn
    }
  };
  const persona = loadPersona(personaId);
  const adquirente = loadAdquirente();
  const inventory = loadInventory();

  const trace = initTrace(sessionId, personaId);
  const turnEntries: import("@ascendimacy/shared").TraceEntry[] = [];

  const t0 = Date.now();
  const stateResult = await clients.motorExecucao.callTool({
    name: "get_state",
    arguments: { sessionId },
  });
  const state = parseToolText<import("@ascendimacy/shared").SessionState>(stateResult);
  if (jointContext) {
    state.sessionMode = "joint";
    state.jointPartnerChildId = jointContext.partnerChildId;
    state.jointPartnerName = jointContext.partnerName;
    // Busca statusMatrix do parceiro pra detecção de brejo unilateral.
    try {
      const partnerStateResult = await clients.motorExecucao.callTool({
        name: "get_state",
        arguments: { sessionId: jointContext.partnerSessionId },
      });
      const partnerState = parseToolText<import("@ascendimacy/shared").SessionState>(partnerStateResult);
      if (partnerState.statusMatrix) {
        state.partnerStatusMatrix = partnerState.statusMatrix;
      }
    } catch {
      // Se o motor não conseguir buscar o parceiro, segue sem (degrade graceful).
    }
  }
  turnEntries.push({
    service: "motor-execucao",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - t0,
    input: { sessionId },
    output: state as unknown as Record<string, unknown>,
  });

  // motor#25 (handoff #25 B2): Signal Extractor — antes de plan_turn.
  // Captura signals do user message + history tail. Loga signals_extracted
  // event no event_log pra Trigger Evaluator consumir.
  // Read-only — fail-soft, qualquer erro vira signals=[].
  // BUG-PL-01 Sprint 5: extractedSignals capturado fora do try pra ser
  // injetado em plan_turn contextHints (planejador precisa ver pra propor
  // deflection awareness no rationale).
  const tSig = Date.now();
  let extractedSignals: string[] = [];
  try {
    const signalsResult = await clients.motorDrota.callTool({
      name: "extract_signals",
      arguments: {
        userMessage: message,
        personaName: persona.name,
        personaAge: persona.age,
        trustLevel: state.trustLevel,
        conversationHistoryTail: (state.eventLog ?? [])
          .slice(-3)
          .map((e) => ({
            role: "assistant" as const,
            content: ((e.data as { output?: string } | undefined)?.output ?? "").slice(0, 200),
          })),
      },
    });
    const sig = parseToolText<{
      signals: string[];
      evidence?: Record<string, string>;
      overall_confidence?: number;
    }>(signalsResult);
    if (sig.signals && sig.signals.length > 0) {
      extractedSignals = sig.signals;
      // Loga event no motor-execucao pra Trigger Evaluator ler na próxima call
      await clients.motorExecucao.callTool({
        name: "log_event",
        arguments: {
          sessionId,
          type: "signals_extracted",
          data: {
            signals: sig.signals,
            evidence: sig.evidence ?? {},
            overall_confidence: sig.overall_confidence ?? 0,
          },
        },
      });
      // Re-fetch state pra trigger-evaluator do plan_turn ver o novo event
      const refreshed = await clients.motorExecucao.callTool({
        name: "get_state",
        arguments: { sessionId },
      });
      const refreshedState = parseToolText<import("@ascendimacy/shared").SessionState>(refreshed);
      if (refreshedState.eventLog) state.eventLog = refreshedState.eventLog;
    }
  } catch {
    // Fail-soft: signal extraction quebra não trava o turn
  }
  void (Date.now() - tSig); // keep latency hint local — debug log captura via debug-mode

  // B2 (Drilling) — pre-turn workflow.
  //
  //   (1) Se prior turn emitiu drill_emitted (sem drill_attempt_recorded),
  //       este `message` é a resposta. Match + recordAttempt + log events.
  //   (2) Pra este turn, propose drill (drill_list_due + drill_load_bank +
  //       proposeDrillItem). Se proposal válida → injeta em planContextHints.
  //
  // Spec: ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md
  const bankIds = extractDrillBankIds(persona);
  const drillEnabled = bankIds.length > 0;
  let drillItemsById = new Map<string, DrillItem>();
  if (drillEnabled) {
    // Lazy load banks pra esta turn (cache fica no servidor MCP filesystem,
    // mas no orchestrator não persistimos entre turns — barato pra v0).
    for (const bankId of bankIds) {
      try {
        const bankRes = await clients.motorExecucao.callTool({
          name: "drill_load_bank",
          arguments: { bankId },
        });
        const parsed = parseToolText<{ items?: DrillItem[]; error?: string }>(bankRes);
        if (parsed.items) {
          for (const it of parsed.items) drillItemsById.set(it.id, it);
        }
      } catch {
        // Bank load fail — segue sem drill pra este turn (fail-soft).
      }
    }
  }

  // (1) Resolve drill response do turno anterior se houver pending.
  const pending = drillEnabled
    ? findPendingDrill(state.eventLog ?? [])
    : null;
  if (pending) {
    const item = drillItemsById.get(pending.drillItemId);
    if (item) {
      const emittedMs = new Date(pending.emittedAt).getTime();
      const latencyMs = Math.max(0, Date.now() - emittedMs);
      const match = matchDrillAnswer(item, message, latencyMs);
      try {
        const attemptRes = await clients.motorExecucao.callTool({
          name: "drill_record_attempt",
          arguments: {
            personaId: persona.id,
            itemId: item.id,
            response: match.response_type,
            latencyMs,
          },
        });
        const attempt = parseToolText<{
          state: import("@ascendimacy/shared").DrillState;
          masteryReached: boolean;
        }>(attemptRes);
        await clients.motorExecucao.callTool({
          name: "log_event",
          arguments: {
            sessionId,
            type: "drill_attempt_recorded",
            data: {
              drill_item_id: item.id,
              bank_id: item.bank_id,
              response: match.response_type,
              correct: match.correct,
              latency_ms: latencyMs,
              user_response: message.slice(0, 200),
              next_due_at: attempt.state.next_due_at,
              mastery_reached: attempt.masteryReached,
            },
          },
        });
        if (attempt.masteryReached) {
          await clients.motorExecucao.callTool({
            name: "log_event",
            arguments: {
              sessionId,
              type: "drill_item_mastered",
              data: {
                drill_item_id: item.id,
                bank_id: item.bank_id,
                mastered_at: attempt.state.mastery_reached_at,
              },
            },
          });
        }
        // Re-fetch state pra refletir eventos novos no plan_turn deste turn.
        const refreshedState = parseToolText<import("@ascendimacy/shared").SessionState>(
          await clients.motorExecucao.callTool({
            name: "get_state",
            arguments: { sessionId },
          }),
        );
        if (refreshedState.eventLog) state.eventLog = refreshedState.eventLog;
      } catch {
        // Fail-soft — drill miss não trava turn.
      }
    }
  }

  // (2) Propose drill pra este turn.
  let serializedDrillProposal:
    | ReturnType<typeof serializeDrillProposal>
    | null = null;
  if (drillEnabled && drillItemsById.size > 0) {
    try {
      const dueRes = await clients.motorExecucao.callTool({
        name: "drill_list_due",
        arguments: { personaId: persona.id },
      });
      const due = parseToolText<{ states: DrillState[] }>(dueRes);
      // v0: persona "cold start" — se não há states (presented_count 0
      // pra todos), considera todos items elegíveis like "due now".
      // Isso destrava o primeiro drill turn antes de qualquer attempt.
      let dueStates: DrillState[] = due.states ?? [];
      if (dueStates.length === 0) {
        const nowIso = new Date().toISOString();
        dueStates = Array.from(drillItemsById.keys()).map((itemId) => ({
          persona_id: persona.id,
          item_id: itemId,
          presented_count: 0,
          correct_count: 0,
          last_seen_at: nowIso,
          next_due_at: nowIso,
          current_interval_days: 0,
          current_easiness: 2.5,
          mastery_reached_at: null,
          last_5_attempts: [],
        }));
      }
      const proposal = proposeDrillItem({
        personaId: persona.id,
        dueStates,
        itemsById: drillItemsById,
        budget: state.budgetRemaining,
      });
      if (proposal) {
        serializedDrillProposal = serializeDrillProposal(proposal);
      }
    } catch {
      // Fail-soft
    }
  }

  const t1 = Date.now();
  // BUG-PL-01 Sprint 5: passa extracted_signals em contextHints pro planejador
  // injetar SINAIS DETECTADOS NO TURNO + bloco DEFLECTION ATIVO no system prompt
  // quando deflection_thematic/exit_marker_* presentes. Antes, signals só iam
  // pro event_log e o planejador rodava cego — deflections ignoradas por 3 turns.
  const planContextHints: Record<string, unknown> = {};
  if (extractedSignals.length > 0) {
    planContextHints["extracted_signals"] = extractedSignals;
    planContextHints["last_user_message"] = message;
  }
  if (serializedDrillProposal) {
    planContextHints["drill_proposal"] = serializedDrillProposal;
  }
  const planResult = await clients.planejador.callTool({
    name: "plan_turn",
    arguments: {
      sessionId,
      persona,
      adquirente,
      inventory,
      state,
      incomingMessage: message,
      ...(Object.keys(planContextHints).length > 0
        ? { contextHints: planContextHints }
        : {}),
    },
  });
  const plan = parseToolText<import("@ascendimacy/shared").PlanTurnOutput>(planResult);

  // S3 (ops#1145): crise detectada → pula materializer, despacha protocolo.
  if (plan.is_critical) {
    try {
      await clients.motorExecucao.callTool({
        name: "log_event",
        arguments: {
          sessionId,
          type: "crisis_detected",
          data: { critical_reason: plan.critical_reason ?? "distress", turn: state.turn },
        },
      });
    } catch {
      // fail-soft
    }
    const tracePath = saveTrace(trace, tracesDir);
    return { finalResponse: "", tracePath };
  }

  turnEntries.push({
    service: "planejador",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - t1,
    input: { incomingMessage: message, poolSize: plan.contentPool.length },
    output: plan as unknown as Record<string, unknown>,
  });

  emit({
    type: "planning_started",
    sessionId,
    turn: state.turn,
    timestamp: new Date().toISOString(),
    payload: {
      strategicRationale: plan.strategicRationale,
      contentPoolSize: plan.contentPool.length,
      contentPoolIds: plan.contentPool.map((s) => s.item.id),
      contextHints: plan.contextHints,
      transitionEvaluationsCount: plan.transitionEvaluations?.length ?? 0,
    },
  });

  // motor#25 (handoff #25 B4 + B5): loga transitionEvaluations + entropy events.
  // Read-only — só registra. v0 não move statusMatrix.
  if (plan.transitionEvaluations && plan.transitionEvaluations.length > 0) {
    for (const ev of plan.transitionEvaluations) {
      try {
        await clients.motorExecucao.callTool({
          name: "log_event",
          arguments: {
            sessionId,
            type: "transition_evaluated",
            data: {
              transition_name: ev.transition_name,
              fired: ev.fired,
              required_matched: ev.required_matched,
              confirmatory_matched: ev.confirmatory_matched,
              regression_signals_present: ev.regression_signals_present,
              reason: ev.reason,
            },
          },
        });
      } catch {
        // Fail-soft
      }
    }
  }
  if (typeof plan.candidateSetEntropy === "number") {
    try {
      await clients.motorExecucao.callTool({
        name: "log_event",
        arguments: {
          sessionId,
          type: "candidate_set_emitted",
          data: {
            entropy_score: plan.candidateSetEntropy,
            pool_size: plan.contentPool.length,
            pool_ids: plan.contentPool.map((s) => s.item.id),
          },
        },
      });
    } catch {
      // Fail-soft
    }
  }

  // C-MX-07 PR5 (S-OD-07 + S-OD-08): optionsGate hook entre plan_turn
  // e evaluate_and_select. Permite Jun (via eBrota Console BFF) ver pool
  // + escolher carta diferente antes da materialização. Auto mode =
  // gate undefined = behavior PR3 puro.
  let effectiveContentPool = plan.contentPool;
  let overrideAppliedId: string | undefined;
  if (optionsGate !== undefined) {
    try {
      const decision = await optionsGate({
        sessionId,
        turn: state.turn,
        contentPool: plan.contentPool,
      });
      if (decision.overrideContentItemId !== undefined) {
        const override = plan.contentPool.find(
          (s) => s.item.id === decision.overrideContentItemId,
        );
        if (override !== undefined) {
          effectiveContentPool = [override];
          overrideAppliedId = decision.overrideContentItemId;
        }
        // Se overrideContentItemId não está no pool, segue com pool
        // original (fail-soft; caller é responsável por validar antes).
      }
    } catch {
      // Gate exception → segue com pool original (fail-soft)
    }
  }

  const t2 = Date.now();
  const drotaInstructionAddition = cardContext
    ? buildCardInstructionAddition(plan, cardContext)
    : (plan.instruction_addition ?? "");
  const drotaResult = await clients.motorDrota.callTool({
    name: "evaluate_and_select",
    arguments: {
      sessionId,
      contentPool: effectiveContentPool,
      state,
      persona,
      strategicRationale: plan.strategicRationale,
      // Sprint 5 #10: injeta last_user_message em contextHints pra
      // contextual priority — Constrained Materializer (USE_SIMPLIFIED_PIPELINE)
      // engata tema do sujeito; sem isso, materializer não vê msg incoming.
      contextHints: {
        ...(plan.contextHints ?? {}),
        last_user_message: message,
      },
      instruction_addition: drotaInstructionAddition,
    },
  });
  const drota = parseToolText<import("@ascendimacy/shared").EvaluateAndSelectOutput>(drotaResult);
  turnEntries.push({
    service: "motor-drota",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - t2,
    input: {
      poolSize: effectiveContentPool.length,
      ...(overrideAppliedId !== undefined ? { overrideAppliedId } : {}),
    },
    output: drota as unknown as Record<string, unknown>,
  });

  emit({
    type: "selection_made",
    sessionId,
    turn: state.turn,
    timestamp: new Date().toISOString(),
    payload: {
      selectedContentId: drota.selectedContent?.item?.id ?? "",
      selectedContentScore: Number(drota.selectedContent?.score ?? 0),
      selectionRationale: drota.selectionRationale ?? "",
    },
  });
  emit({
    type: "materialization_ready",
    sessionId,
    turn: state.turn,
    timestamp: new Date().toISOString(),
    payload: {
      proposedText: drota.linguisticMaterialization ?? "",
      instructionAdditionApplied: drotaInstructionAddition.length > 0,
    },
  });

  const t3 = Date.now();
  // v1 usa playbookId = inventory[0] como deploy profile default.
  // Plan §2.A v2: playbookId é session profile, não mais action-id.
  const deployProfileId = inventory[0]?.id ?? "default";
  const execResult = await clients.motorExecucao.callTool({
    name: "execute_playbook",
    arguments: {
      sessionId,
      playbookId: deployProfileId,
      selectedContentId: drota.selectedContent?.item?.id ?? "",
      output: drota.linguisticMaterialization,
      // ops#1068: motor-execucao consome contextHints.repetition_inquiry +
      // userMessage pra logar _asked event no turn corrente AND parsear
      // resposta da criança no próximo turn (cascata literal → default).
      metadata: {
        contextHints: plan.contextHints,
        userMessage: message,
        personaId,
      },
    },
  });
  const exec = parseToolText<import("@ascendimacy/shared").ExecutePlaybookOutput>(execResult);
  turnEntries.push({
    service: "motor-execucao",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - t3,
    input: {
      playbookId: deployProfileId,
      selectedContentId: drota.selectedContent?.item?.id ?? "",
    },
    output: exec as unknown as Record<string, unknown>,
  });

  emit({
    type: "playbook_executed",
    sessionId,
    turn: state.turn,
    timestamp: new Date().toISOString(),
    payload: {
      playbookId: deployProfileId,
      success: exec.success ?? false,
      newTurnNumber: exec.newState?.turn ?? state.turn + 1,
    },
  });

  // B2 — post-turn: se selectedContent é drill_vocab, marca como pending
  // pro próximo turn parsear a resposta. Inclui drill_item_id + bank_id
  // pra resolver lookup sem depender do bank carregado em memória.
  const selectedRaw = drota.selectedContent?.item as
    | {
        type?: string;
        drill_item_id?: string;
        bank_id?: string;
      }
    | undefined;
  if (
    selectedRaw?.type === "drill_vocab" &&
    typeof selectedRaw.drill_item_id === "string" &&
    typeof selectedRaw.bank_id === "string"
  ) {
    try {
      await clients.motorExecucao.callTool({
        name: "log_event",
        arguments: {
          sessionId,
          type: "drill_emitted",
          data: {
            drill_item_id: selectedRaw.drill_item_id,
            bank_id: selectedRaw.bank_id,
            turn_number: state.turn,
          },
        },
      });
    } catch {
      // Fail-soft
    }
  }

  // v0.3: enriquece o turn com snapshots e resumos.
  const selectedItem = drota.selectedContent?.item;
  const selectedSummary = selectedItem
    ? {
        id: String(selectedItem.id),
        type: String(selectedItem.type),
        score: Number(drota.selectedContent.score ?? 0),
        domain: String(selectedItem.domain ?? ""),
        surprise: Number(selectedItem.surprise ?? 0),
        sacrifice_type: (selectedItem as { sacrifice_type?: string }).sacrifice_type,
      }
    : undefined;

  const gardnerChannelsObserved =
    (selectedItem as { gardner_channels?: import("@ascendimacy/shared").GardnerChannel[] } | undefined)?.gardner_channels;
  const caselTargetsTouched = (selectedItem as { casel_target?: import("@ascendimacy/shared").CaselDimension[] } | undefined)?.casel_target;
  // Bloco 7 prep — sacrifice_amount agora vem do item selecionado (antes hardcoded 0).
  const sacrificeSpent = Number(
    (selectedItem as { sacrifice_amount?: number } | undefined)?.sacrifice_amount ?? 0,
  );

  // ─── Bloco 5a auto-hook — detectAchievement + emit (motor#17) ───────
  // Runs APÓS execute_playbook. Se signal não-null, dispara pipeline.
  // Latency budget: < 100ms extra (detect ~5ms; emit_card ~20-50ms via mocks).
  //
  // Bloco 7 prep (motor#18) — re-fetch state após execute_playbook pra capturar
  // matrix atualizada pelo turn. Comparada com snapshot pré-turno (state.statusMatrix
  // tirado lá no topo do runTurn) habilita detecção de transições status_to_pasto +
  // crossing.
  const prevStatusMatrix = state.statusMatrix ? { ...state.statusMatrix } : undefined;
  let currentStatusMatrix = state.statusMatrix;
  try {
    const newStateResult = await clients.motorExecucao.callTool({
      name: "get_state",
      arguments: { sessionId },
    });
    const newState = parseToolText<import("@ascendimacy/shared").SessionState>(newStateResult);
    currentStatusMatrix = newState.statusMatrix ?? currentStatusMatrix;
  } catch {
    // Se re-fetch falhar, mantém prev=curr (comportamento pré-#18).
  }

  let emittedCardId: string | undefined;
  let cardEmissionSkipReason: string | undefined;
  let signalKind: string | undefined;
  const t4 = Date.now();
  try {
    const detectResult = await clients.motorExecucao.callTool({
      name: "detect_achievement",
      arguments: {
        childId: persona.id,
        sessionId,
        currentMatrix: currentStatusMatrix ?? {},
        previousMatrix: prevStatusMatrix ?? {},
        gardnerObserved: gardnerChannelsObserved ?? [],
        caselTouched: caselTargetsTouched ?? [],
        sacrificeSpent,
        selectedContent: drota.selectedContent ?? {},
      },
    });
    const signal = parseToolText<unknown>(detectResult);
    if (signal && typeof signal === "object" && (signal as { kind?: unknown }).kind) {
      signalKind = String((signal as { kind?: unknown }).kind);
      const personaProfile = (persona.profile ?? {}) as Record<string, unknown>;
      const parentalProfile = personaProfile["parental_profile"];
      const emitResult = await clients.motorExecucao.callTool({
        name: "emit_card_for_signal",
        arguments: {
          signal,
          childName: persona.name,
          parentalProfile: parentalProfile && typeof parentalProfile === "object" ? parentalProfile : undefined,
        },
      });
      const emitOutput = parseToolText<{ ok?: boolean; card_id?: string; skipped?: boolean; skip_reason?: string }>(emitResult);
      if (emitOutput.ok && emitOutput.card_id) {
        emittedCardId = emitOutput.card_id;
      } else if (emitOutput.skipped) {
        cardEmissionSkipReason = emitOutput.skip_reason ?? "skipped_unknown";
      }
    } else {
      cardEmissionSkipReason = "no_signal";
    }
  } catch (err) {
    cardEmissionSkipReason = `auto_hook_error:${String(err).slice(0, 100)}`;
  }
  const cardHookMs = Date.now() - t4;

  // motor#19: debug log do auto-hook (no-op se ASC_DEBUG_MODE off)
  logDebugEvent({
    side: "motor",
    step: "auto-hook",
    user_id: persona.id,
    session_id: sessionId,
    turn_number: state.turn,
    provider: null,
    model: null,
    latency_ms: cardHookMs,
    snapshots_pre: {
      ebrota: {
        statusMatrix: prevStatusMatrix ?? {},
        gardner_program: state.gardnerProgram ?? null,
        turn: state.turn,
        trust: state.trustLevel,
        budget: state.budgetRemaining,
        session_mode: state.sessionMode ?? "solo",
        selected_content_id: selectedItem?.id ?? null,
        gardner_channels: gardnerChannelsObserved ?? [],
        casel_target: caselTargetsTouched ?? [],
        sacrifice_amount: sacrificeSpent,
      },
    },
    snapshots_post: {
      ebrota: {
        signal_kind: signalKind ?? null,
        emitted_card_id: emittedCardId ?? null,
        skip_reason: cardEmissionSkipReason ?? null,
        statusMatrix: currentStatusMatrix ?? {},
      },
    },
    outcome: emittedCardId ? "ok" : cardEmissionSkipReason?.startsWith("auto_hook_error") ? "error" : "skip",
    error_class: cardEmissionSkipReason?.startsWith("auto_hook_error") ? cardEmissionSkipReason : null,
  });

  // motor#25: parse failure propagation pra TurnTrace.
  const drotaSkipReason = (drota as { skipReason?: string }).skipReason;
  const parseFailure = drotaSkipReason ? true : undefined;

  appendTurn(trace, {
    turnNumber: state.turn,
    sessionId,
    timestamp: new Date().toISOString(),
    incomingMessage: message,
    entries: turnEntries,
    finalResponse: drota.linguisticMaterialization,
    statusSnapshot: state.statusMatrix,
    gardnerProgramSnapshot: state.gardnerProgram,
    selectedContent: selectedSummary,
    gardnerChannelsObserved,
    caselTargetsTouched,
    instructionAdditionApplied: (plan.instruction_addition ?? "") || undefined,
    flags: { anomalies: [], warnings: [] },
    sessionMode: state.sessionMode,
    jointPartnerChildId: state.jointPartnerChildId,
    jointPartnerName: state.jointPartnerName,
    emittedCardId,
    cardEmissionSkipReason,
    parseFailure,
    parseFailureReason: drotaSkipReason,
  });
  void cardHookMs; // expose latency hint via flags se quiser; v1 só registra


  const tracePath = saveTrace(trace, tracesDir);
  return { finalResponse: drota.linguisticMaterialization, tracePath };
}
