import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

export interface McpClients {
  planejador: Client;
  motorDrota: Client;
  motorExecucao: Client;
}

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const keys = ["ANTHROPIC_API_KEY", "INFOMANIAK_API_KEY", "INFOMANIAK_BASE_URL", "PLANEJADOR_MODEL", "MOTOR_DROTA_MODEL", "USE_MOCK_LLM"];
  for (const k of keys) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  return env;
}

async function createClient(name: string, command: string, args: string[]): Promise<Client> {
  const client = new Client({ name: `orchestrator->${name}`, version: "0.1.0" });
  const transport = new StdioClientTransport({ command, args, env: buildEnv() });
  await client.connect(transport);
  return client;
}

export async function connectAll(): Promise<McpClients> {
  const nodeCmd = process.execPath;
  const useMock = process.env["USE_MOCK_LLM"] === "true";

  if (useMock) {
    return createMockClients();
  }

  const [planejador, motorDrota, motorExecucao] = await Promise.all([
    createClient("planejador", nodeCmd, [join(root, "planejador/dist/server.js")]),
    createClient("motor-drota", nodeCmd, [join(root, "motor-drota/dist/server.js")]),
    createClient("motor-execucao", nodeCmd, [join(root, "motor-execucao/dist/server.js")]),
  ]);

  return { planejador, motorDrota, motorExecucao };
}

export async function disconnectAll(clients: McpClients): Promise<void> {
  await Promise.all([
    clients.planejador.close(),
    clients.motorDrota.close(),
    clients.motorExecucao.close(),
  ]);
}

function createMockClients(): McpClients {
  const makeMock = (name: string) => {
    return {
      callTool: async (params: { name: string; arguments?: Record<string, unknown> }) => {
        return { content: [{ type: "text", text: getMockResponse(name, params.name, params.arguments) }] };
      },
      close: async () => {},
    } as unknown as Client;
  };

  return {
    planejador: makeMock("planejador"),
    motorDrota: makeMock("motor-drota"),
    motorExecucao: makeMock("motor-execucao"),
  };
}

function getMockResponse(service: string, tool: string, args?: Record<string, unknown>): string {
  if (service === "planejador" && tool === "plan_turn") {
    return JSON.stringify({
      strategicRationale: "Mock: contexto inicial.",
      candidateActions: [
        { playbookId: "icebreaker.primeiro-contato", priority: 1, rationale: "Primeiro contato", estimatedSacrifice: 1, estimatedConfidenceGain: 4 },
        { playbookId: "onboarding.apresentacao-produto", priority: 2, rationale: "Apresentar produto", estimatedSacrifice: 2, estimatedConfidenceGain: 3 },
      ],
      contextHints: { language: "pt-br" },
    });
  }
  if (service === "motor-drota" && tool === "evaluate_and_select") {
    // Accept strategicRationale and contextHints from args (ignored in mock, but validated here)
    const _strategicRationale = (args?.["strategicRationale"] as string | undefined) ?? "";
    const _contextHints = (args?.["contextHints"] as Record<string, unknown> | undefined) ?? {};
    void _strategicRationale; void _contextHints;
    return JSON.stringify({
      selectedAction: { playbookId: "icebreaker.primeiro-contato", priority: 1, rationale: "Melhor score", estimatedSacrifice: 1, estimatedConfidenceGain: 4, score: 6 },
      selectionRationale: "Mock: icebreaker tem maior score.",
      actualSacrifice: 1,
      actualConfidenceGain: 4,
      linguisticMaterialization: "Olá! Que bom ter você aqui. Como posso ajudar hoje?",
    });
  }
  if (service === "motor-execucao" && tool === "get_state") {
    const sessionId = (args?.["sessionId"] as string) ?? "mock-session";
    return JSON.stringify({ sessionId, trustLevel: 0.3, budgetRemaining: 100, turn: 0, eventLog: [] });
  }
  if (service === "motor-execucao" && tool === "execute_playbook") {
    const sessionId = (args?.["sessionId"] as string) ?? "mock-session";
    return JSON.stringify({
      success: true,
      newState: { sessionId, trustLevel: 0.34, budgetRemaining: 99, turn: 1, eventLog: [] },
      eventLogged: { timestamp: new Date().toISOString(), type: "playbook_executed", playbookId: "icebreaker.primeiro-contato", data: {} },
    });
  }
  return JSON.stringify({ ok: true });
}
