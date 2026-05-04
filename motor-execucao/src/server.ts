import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadInventory } from "./loader.js";
import { getState, logEvent, getDbInstance } from "./state-manager.js";
import { executePlaybook } from "./executor.js";
import {
  startProgram,
  advanceProgram,
  pauseProgram,
  resumeProgram,
} from "./gardner-program.js";
import {
  setParentDecision,
  listParentDecisions,
  PARENT_DECISION_STATUSES,
} from "./parent-decisions.js";
import type { ParentDecisionStatus } from "./parent-decisions.js";
import {
  saveEmittedCard,
  getEmittedCardsByChild,
  getEmittedCardsBySession,
  getEmittedCardsInRange,
  getNextSequence,
} from "./cards-repo.js";
import { loadHelixState as helixLoad, saveHelixState as helixSave } from "./helix-repo.js";
import type { HelixState as HelixStateT, CaselDim } from "@ascendimacy/shared";
import {
  initHelix,
  advanceProgress as helixAdvanceProgress,
  checkBossFight as helixCheckBossFight,
  completeCycle as helixCompleteCycle,
  emitHelixCycleStarted,
  emitRetrievalTriggered,
  emitBossCompleted,
  emitCycleCompleted,
} from "@ascendimacy/shared";
import type {
  EmittedCard,
  CardArchetype,
  GardnerChannel,
  CaselDimension,
  StatusValue,
  ScoredContentItem,
} from "@ascendimacy/shared";
import { MockCardImageProvider } from "@ascendimacy/shared";
import { getNow } from "./clock.js";
import {
  detectAchievement,
  selectArchetypeForSignal,
  proposeCardSpec,
  triageCardSpec,
  generateCardImage,
  emitCard,
  type AchievementSignal,
} from "./card-generation.js";
import { loadArchetypes } from "./archetype-loader.js";
import type { ParentalProfile } from "@ascendimacy/shared";

const inventory = loadInventory();

const server = new McpServer({
  name: "motor-execucao",
  version: "0.1.0",
});

/* eslint-disable @typescript-eslint/no-explicit-any */
server.registerTool("get_state", {
  description: "Retorna estado atual da sessao (trust_level, budget, turn, event_log)",
  inputSchema: { sessionId: z.string() } as any,
}, async ({ sessionId }: { sessionId: string }) => {
  const state = getState(sessionId);
  return { content: [{ type: "text" as const, text: JSON.stringify(state) }] };
});

server.registerTool("execute_playbook", {
  description: "Executa um playbook escolhido, persiste state e loga evento",
  inputSchema: {
    sessionId: z.string(),
    playbookId: z.string(),
    selectedContentId: z.string().optional(),
    output: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  } as any,
}, async ({ sessionId, playbookId, selectedContentId, output, metadata }: { sessionId: string; playbookId: string; selectedContentId?: string; output: string; metadata?: Record<string, unknown> }) => {
  const result = executePlaybook({ sessionId, playbookId, selectedContentId, output, metadata: metadata ?? {} }, inventory);
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
});

server.registerTool("gardner_program_start", {
  description: "Inicia programa Gardner 5 semanas (week=1, phase=exploration). Caller deve ter verificado assessment pronto (min 3 sessões).",
  inputSchema: { sessionId: z.string() } as any,
}, async ({ sessionId }: { sessionId: string }) => {
  const state = startProgram(getDbInstance(), sessionId);
  return { content: [{ type: "text" as const, text: JSON.stringify(state) }] };
});

server.registerTool("gardner_program_advance", {
  description: "Avança programa Gardner pela próxima fase (1→2→3→week+1 phase1). Throws se pausado.",
  inputSchema: { sessionId: z.string() } as any,
}, async ({ sessionId }: { sessionId: string }) => {
  const state = advanceProgram(getDbInstance(), sessionId);
  return { content: [{ type: "text" as const, text: JSON.stringify(state) }] };
});

server.registerTool("gardner_program_pause", {
  description: "Pausa programa Gardner com motivo (ex: emotional_brejo, child_request, missed_milestones).",
  inputSchema: { sessionId: z.string(), reason: z.string() } as any,
}, async ({ sessionId, reason }: { sessionId: string; reason: string }) => {
  const state = pauseProgram(getDbInstance(), sessionId, reason);
  return { content: [{ type: "text" as const, text: JSON.stringify(state) }] };
});

server.registerTool("gardner_program_resume", {
  description: "Retoma programa Gardner pausado.",
  inputSchema: { sessionId: z.string() } as any,
}, async ({ sessionId }: { sessionId: string }) => {
  const state = resumeProgram(getDbInstance(), sessionId);
  return { content: [{ type: "text" as const, text: JSON.stringify(state) }] };
});

server.registerTool("parent_decision_set", {
  description: "Registra decisão parental para um content item (pending/approved/rejected/pinned).",
  inputSchema: {
    sessionId: z.string(),
    contentId: z.string(),
    status: z.enum(PARENT_DECISION_STATUSES),
    reason: z.string().optional(),
    expiresAt: z.string().optional(),
  } as any,
}, async ({ sessionId, contentId, status, reason, expiresAt }: { sessionId: string; contentId: string; status: ParentDecisionStatus; reason?: string; expiresAt?: string }) => {
  const decision = setParentDecision(getDbInstance(), {
    session_id: sessionId,
    content_id: contentId,
    status,
    reason,
    expires_at: expiresAt,
  });
  return { content: [{ type: "text" as const, text: JSON.stringify(decision) }] };
});

server.registerTool("parent_decision_list", {
  description: "Lista todas as decisões parentais de uma sessão.",
  inputSchema: { sessionId: z.string() } as any,
}, async ({ sessionId }: { sessionId: string }) => {
  const decisions = listParentDecisions(getDbInstance(), sessionId);
  return { content: [{ type: "text" as const, text: JSON.stringify(decisions) }] };
});

server.registerTool("card_save", {
  description: "Persiste EmittedCard em kids_emitted_cards (idempotente pelo card_id). Caller monta o card via pipeline shared.",
  inputSchema: {
    card: z.record(z.string(), z.unknown()),
  } as any,
}, async ({ card }: { card: EmittedCard }) => {
  saveEmittedCard(getDbInstance(), card);
  return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, card_id: card.card_id }) }] };
});

server.registerTool("card_list_by_child", {
  description: "Lista todos os cards emitidos de uma criança, ordem emitted_at.",
  inputSchema: { childId: z.string() } as any,
}, async ({ childId }: { childId: string }) => {
  const cards = getEmittedCardsByChild(getDbInstance(), childId);
  return { content: [{ type: "text" as const, text: JSON.stringify(cards) }] };
});

server.registerTool("card_list_by_session", {
  description: "Lista cards emitidos em uma sessão.",
  inputSchema: { sessionId: z.string() } as any,
}, async ({ sessionId }: { sessionId: string }) => {
  const cards = getEmittedCardsBySession(getDbInstance(), sessionId);
  return { content: [{ type: "text" as const, text: JSON.stringify(cards) }] };
});

server.registerTool("card_list_in_range", {
  description: "Lista cards de uma criança emitidos em [fromIso, toIso). Usado pelo weekly-report.",
  inputSchema: {
    childId: z.string(),
    fromIso: z.string(),
    toIso: z.string(),
  } as any,
}, async ({ childId, fromIso, toIso }: { childId: string; fromIso: string; toIso: string }) => {
  const cards = getEmittedCardsInRange(getDbInstance(), childId, fromIso, toIso);
  return { content: [{ type: "text" as const, text: JSON.stringify(cards) }] };
});

server.registerTool("detect_achievement", {
  description: "Detecta sinal de conquista a partir de signals do turno (Bloco 5a auto-hook).",
  inputSchema: {
    childId: z.string(),
    sessionId: z.string(),
    now: z.string().optional(),
    currentMatrix: z.record(z.string(), z.string()).optional(),
    previousMatrix: z.record(z.string(), z.string()).optional(),
    gardnerObserved: z.array(z.string()).optional(),
    caselTouched: z.array(z.string()).optional(),
    sacrificeSpent: z.number().optional(),
    selectedContent: z.record(z.string(), z.unknown()).optional(),
  } as any,
}, async (args: {
  childId: string;
  sessionId: string;
  now?: string;
  currentMatrix?: Record<string, StatusValue>;
  previousMatrix?: Record<string, StatusValue>;
  gardnerObserved?: GardnerChannel[];
  caselTouched?: CaselDimension[];
  sacrificeSpent?: number;
  selectedContent?: ScoredContentItem;
}) => {
  const signal = detectAchievement({
    child_id: args.childId,
    session_id: args.sessionId,
    now: getNow(args.now),
    current_matrix: args.currentMatrix,
    previous_matrix: args.previousMatrix,
    gardner_observed: args.gardnerObserved,
    casel_touched: args.caselTouched,
    sacrifice_spent: args.sacrificeSpent,
    selected_content: args.selectedContent,
  });
  return { content: [{ type: "text" as const, text: JSON.stringify(signal) }] };
});

server.registerTool("emit_card_for_signal", {
  description: "Pipeline completo: archetype → propose → triage → image → sign → emit → save. Respeita scaffold guard em env != 'test'.",
  inputSchema: {
    signal: z.record(z.string(), z.unknown()),
    childName: z.string().optional(),
    parentalProfile: z.record(z.string(), z.unknown()).optional(),
  } as any,
}, async (args: {
  signal: AchievementSignal;
  childName?: string;
  parentalProfile?: ParentalProfile;
}) => {
  const env = process.env["NODE_ENV"] ?? "production";
  const secret = process.env["EBROTA_CARD_SECRET"] ?? "ebrota-default-test-secret-min-8";

  const archetypes: CardArchetype[] = loadArchetypes();
  const archetype = selectArchetypeForSignal(args.signal, archetypes);
  if (!archetype) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ skipped: true, skip_reason: "no_archetype_available" }) }] };
  }

  // Scaffold guard upfront — evita gastar Haiku/imagem se vai bloquear.
  if (archetype.is_scaffold && env !== "test") {
    console.warn(
      `[emit_card_for_signal] skip — archetype '${archetype.id}' is scaffold; blocked in env='${env}'. (Bloco 5b Content Engine pendente)`,
    );
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ skipped: true, skip_reason: "scaffold_in_non_test", env, archetype_id: archetype.id }),
      }],
    };
  }

  const sequence = getNextSequence(getDbInstance(), args.signal.child_id);
  const spec = proposeCardSpec(args.signal, archetype, sequence);

  const triage = await triageCardSpec(spec, args.parentalProfile);
  if (!triage.approved) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ skipped: true, skip_reason: "triage_rejected", reject_reason: triage.reject_reason }),
      }],
    };
  }

  const provider = new MockCardImageProvider();
  const image = await generateCardImage(spec, provider);
  const now = getNow();
  try {
    const card = emitCard({
      spec,
      approved_at: now,
      emitted_at: now,
      image,
      secret,
      env,
      child_name: args.childName ?? spec.child_id,
    });
    saveEmittedCard(getDbInstance(), card);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ ok: true, card_id: card.card_id, archetype_id: archetype.id, scaffold: archetype.is_scaffold }),
      }],
    };
  } catch (err) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ skipped: true, skip_reason: "emit_failed", error: String(err) }),
      }],
    };
  }
});

server.registerTool("log_event", {
  description: "Loga evento avulso na sessao sem executar playbook",
  inputSchema: {
    sessionId: z.string(),
    type: z.string(),
    data: z.record(z.string(), z.unknown()).optional().default({}),
  } as any,
}, async ({ sessionId, type, data }: { sessionId: string; type: string; data?: Record<string, unknown> }) => {
  const event = { timestamp: getNow(), type, data: data ?? {} };
  logEvent(sessionId, event);
  return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, event }) }] };
});

server.registerTool("get_helix_state", {
  description: "Retorna HelixState da crianca ou null se nao inicializado (motor#66)",
  inputSchema: { childId: z.string() } as any,
}, async ({ childId }: { childId: string }) => {
  const state = helixLoad(getDbInstance(), childId);
  return { content: [{ type: "text" as const, text: JSON.stringify({ state }) }] };
});

server.registerTool("save_helix_state", {
  description: "Persiste HelixState (upsert por userId/child_id). Usado pelo orchestrator no fim do turn (motor#66)",
  inputSchema: { state: z.record(z.string(), z.unknown()) } as any,
}, async ({ state }: { state: Record<string, unknown> }) => {
  helixSave(getDbInstance(), state as unknown as HelixStateT);
  return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
});

server.registerTool("init_helix", {
  description: "Inicializa HelixState pra crianca (lazy bootstrap). Idempotente: se state existe, retorna existente; senao cria e emit helix.cycle.started (motor#H5)",
  inputSchema: {
    childId: z.string(),
    firstDim: z.string().optional(),
  } as any,
}, async ({ childId, firstDim }: { childId: string; firstDim?: string }) => {
  const existing = helixLoad(getDbInstance(), childId);
  if (existing) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ state: existing, bootstrapped: false }) }] };
  }
  const newState = initHelix(childId, (firstDim as CaselDim | undefined) ?? "SA");
  helixSave(getDbInstance(), newState);
  emitHelixCycleStarted(newState);
  return { content: [{ type: "text" as const, text: JSON.stringify({ state: newState, bootstrapped: true }) }] };
});

server.registerTool("advance_helix", {
  description: "Avança Helix progress + detecta transitions retrieval/boss + completeCycle. Persistido. Retorna newState + transitions emitidos (motor#H5)",
  inputSchema: {
    childId: z.string(),
    delta: z.number(),
    mood: z.number(),
  } as any,
}, async ({ childId, delta, mood }: { childId: string; delta: number; mood: number }) => {
  const current = helixLoad(getDbInstance(), childId);
  if (!current) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: "no_helix_state", childId }) }] };
  }
  const transitions: string[] = [];
  const before = current.progress;
  const advanced = helixAdvanceProgress(current, delta, mood);

  if (before < 0.5 && advanced.progress >= 0.5 && current.previousDimension) {
    emitRetrievalTriggered(advanced, current.previousDimension);
    transitions.push("retrieval");
  }

  let finalState = advanced;
  if (advanced.progress >= 1.0 && helixCheckBossFight(advanced)) {
    emitBossCompleted(advanced, advanced.activeDimension);
    finalState = helixCompleteCycle(advanced);
    emitCycleCompleted(finalState);
    transitions.push("boss");
    transitions.push("cycle_completed");
  }

  helixSave(getDbInstance(), finalState);
  return { content: [{ type: "text" as const, text: JSON.stringify({ state: finalState, transitions }) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
