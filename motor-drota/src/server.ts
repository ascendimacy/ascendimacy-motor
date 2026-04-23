import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { EvaluateAndSelectInput, EvaluateAndSelectOutput } from "@ascendimacy/shared";
import { scoreActions } from "./evaluate.js";
import { selectBest, sanitizeMaterialization } from "./select.js";
import { callLlm, callLlmMock } from "./llm-client.js";

const server = new McpServer({
  name: "motor-drota",
  version: "0.1.0",
});

const candidateSchema = z.object({
  playbookId: z.string(),
  priority: z.number(),
  rationale: z.string(),
  estimatedSacrifice: z.number(),
  estimatedConfidenceGain: z.number(),
});

/* eslint-disable @typescript-eslint/no-explicit-any */
server.registerTool("evaluate_and_select", {
  description: "Avalia candidateActions, seleciona o melhor e materializa linguisticamente",
  inputSchema: {
    sessionId: z.string(),
    candidateActions: z.array(candidateSchema),
    state: z.object({
      sessionId: z.string(),
      trustLevel: z.number(),
      budgetRemaining: z.number(),
      turn: z.number(),
      eventLog: z.array(z.unknown()),
    }),
    persona: z.object({
      id: z.string(),
      name: z.string(),
      age: z.number(),
      profile: z.record(z.string(), z.unknown()),
    }),
  } as any,
}, async (input: EvaluateAndSelectInput) => {
  const { candidateActions, state, persona } = input;
  const scored = scoreActions(candidateActions, state);
  const selected = selectBest(scored);

  const useMock = process.env["USE_MOCK_LLM"] === "true" || !process.env["INFOMANIAK_API_KEY"];
  const systemPrompt = `Você é o Motor Drota. Materialize linguisticamente a ação para ${persona.name}. Responda em pt-br natural. JSON: {"selectionRationale": "...", "linguisticMaterialization": "..."}`;
  const userMessage = `Ação: ${selected.playbookId}\nRationale: ${selected.rationale}`;
  const raw = useMock ? await callLlmMock(systemPrompt, userMessage) : await callLlm(systemPrompt, userMessage);

  let parsed: { selectionRationale?: string; linguisticMaterialization?: string } = {};
  try { parsed = JSON.parse(raw); } catch { parsed = { linguisticMaterialization: raw }; }

  const materialization = sanitizeMaterialization(parsed.linguisticMaterialization ?? "");

  const output: EvaluateAndSelectOutput = {
    selectedAction: selected,
    selectionRationale: parsed.selectionRationale ?? selected.rationale,
    actualSacrifice: selected.estimatedSacrifice,
    actualConfidenceGain: selected.estimatedConfidenceGain,
    linguisticMaterialization: materialization,
  };

  return { content: [{ type: "text" as const, text: JSON.stringify(output) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
