import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadInventory } from "./loader.js";
import { getState, getStateByChild, logEvent, getDbInstance } from "./state-manager.js";
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
  description: "Retorna estado atual da sessao (trust_level, budget, turn, event_log). Se child_id fornecido, vincula sessão à criança e agrega event_log cross-session.",
  inputSchema: { sessionId: z.string(), childId: z.string().optional() } as any,
}, async ({ sessionId, childId }: { sessionId: string; childId?: string }) => {
  const state = childId
    ? getState(sessionId, childId)
    : getState(sessionId);
  return { content: [{ type: "text" as const, text: JSON.stringify(state) }] };
});

server.registerTool("get_state_by_child", {
  description: "Retorna estado agregado cross-session de uma criança pelo child_id (últimas 50 entradas globais, trust_level da sessão mais recente).",
  inputSchema: { childId: z.string(), maxEntries: z.number().optional() } as any,
}, async ({ childId, maxEntries }: { childId: string; maxEntries?: number }) => {
  const state = getStateByChild(childId, maxEntries ?? 50);
  return { content: [{ type: "text" as const, text: JSON.stringify(state) }] };
});

server.registerTool("execute_playbook", {
  description: "Executa um playbook escolhido, persiste state e loga evento",
  inputSchema: {
    sessionId: z.string(),
    childId: z.string().optional(),
    playbookId: z.string(),
    selectedContentId: z.string().optional(),
    output: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  } as any,
}, async ({ sessionId, childId, playbookId, selectedContentId, output, metadata }: { sessionId: string; childId?: string; playbookId: string; selectedContentId?: string; output: string; metadata?: Record<string, unknown> }) => {
  if (childId) {
    getState(sessionId, childId);
  }
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

const transport = new StdioServerTransport();
await server.connect(transport);
