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

server.registerTool("log_event", {
  description: "Loga evento avulso na sessao sem executar playbook",
  inputSchema: {
    sessionId: z.string(),
    type: z.string(),
    data: z.record(z.string(), z.unknown()).optional().default({}),
  } as any,
}, async ({ sessionId, type, data }: { sessionId: string; type: string; data?: Record<string, unknown> }) => {
  const event = { timestamp: new Date().toISOString(), type, data: data ?? {} };
  logEvent(sessionId, event);
  return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, event }) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
