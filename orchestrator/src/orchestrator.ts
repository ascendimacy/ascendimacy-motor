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

export async function runTurn(
  clients: McpClients,
  sessionId: string,
  personaId: string,
  message: string,
  tracesDir: string
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
      instruction_addition: "",
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

  appendTurn(trace, {
    turnNumber: state.turn,
    sessionId,
    incomingMessage: message,
    entries: turnEntries,
    finalResponse: drota.linguisticMaterialization,
  });

  const tracePath = saveTrace(trace, tracesDir);
  return { finalResponse: drota.linguisticMaterialization, tracePath };
}
