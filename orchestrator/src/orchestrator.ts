import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { McpClients } from "./mcp-clients.js";
import { initTrace, appendTurn, saveTrace } from "./trace-writer.js";
import type { PersonaDef, AdquirenteDef, PlaybookIndex } from "@ascendimacy/shared";

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
 * JointContext — Bloco 6 (#17): injeta parceiro quando rodando dyad.
 * Orchestrator busca o statusMatrix do parceiro via get_state(partnerSessionId)
 * e injeta em state.partnerStatusMatrix antes de chamar planejador.
 */
export interface JointContext {
  partnerSessionId: string;
  partnerChildId: string;
  partnerName: string;
}

export async function runTurn(
  clients: McpClients,
  sessionId: string,
  personaId: string,
  message: string,
  tracesDir: string,
  jointContext?: JointContext,
): Promise<{ finalResponse: string; tracePath: string }> {
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

  const t1 = Date.now();
  const planResult = await clients.planejador.callTool({
    name: "plan_turn",
    arguments: { sessionId, persona, adquirente, inventory, state, incomingMessage: message },
  });
  const plan = parseToolText<import("@ascendimacy/shared").PlanTurnOutput>(planResult);
  turnEntries.push({
    service: "planejador",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - t1,
    input: { incomingMessage: message, poolSize: plan.contentPool.length },
    output: plan as unknown as Record<string, unknown>,
  });

  const t2 = Date.now();
  const drotaResult = await clients.motorDrota.callTool({
    name: "evaluate_and_select",
    arguments: {
      sessionId,
      contentPool: plan.contentPool,
      state,
      persona,
      strategicRationale: plan.strategicRationale,
      contextHints: plan.contextHints,
      instruction_addition: plan.instruction_addition ?? "",
    },
  });
  const drota = parseToolText<import("@ascendimacy/shared").EvaluateAndSelectOutput>(drotaResult);
  turnEntries.push({
    service: "motor-drota",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - t2,
    input: { poolSize: plan.contentPool.length },
    output: drota as unknown as Record<string, unknown>,
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
      metadata: {},
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
    }
  } catch (err) {
    cardEmissionSkipReason = `auto_hook_error:${String(err).slice(0, 100)}`;
  }
  const cardHookMs = Date.now() - t4;

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
  });
  void cardHookMs; // expose latency hint via flags se quiser; v1 só registra


  const tracePath = saveTrace(trace, tracesDir);
  return { finalResponse: drota.linguisticMaterialization, tracePath };
}
