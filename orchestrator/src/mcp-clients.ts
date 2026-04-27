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
  const keys = [
    // Provider credentials
    "ANTHROPIC_API_KEY",
    "INFOMANIAK_API_KEY",
    "INFOMANIAK_BASE_URL",
    // Step-specific provider/model overrides (motor#21)
    "LLM_PROVIDER",
    "PLANEJADOR_PROVIDER",
    "PLANEJADOR_MODEL",
    "DROTA_PROVIDER",
    "DROTA_MODEL",
    "MOTOR_DROTA_MODEL", // legacy
    "SIGNAL_EXTRACTOR_PROVIDER",
    "SIGNAL_EXTRACTOR_MODEL",
    "HAIKU_TRIAGE_PROVIDER",
    "HAIKU_TRIAGE_MODEL",
    // Gateway config (motor#28)
    "LLM_GATEWAY_RATE_INFOMANIAK",
    "LLM_GATEWAY_RATE_ANTHROPIC",
    "LLM_GATEWAY_PRIMARY_TIMEOUT_MS",
    "LLM_GATEWAY_BUDGET_MS",
    "LLM_GATEWAY_FALLBACK",
    "LLM_GATEWAY_IPV4_FIRST",
    "LLM_GATEWAY_LOG_SPAWN",
    "MOTOR_LLM_GATEWAY_PATH",
    // Anthropic thinking budget
    "LLM_THINKING_BUDGET_TOKENS",
    // Debug + run_id correlation (motor#19, motor#28 spec refino v1)
    "ASC_DEBUG_MODE",
    "ASC_DEBUG_RUN_ID",
    "ASC_DEBUG_DIR",
    "ASC_LLM_TIMEOUT_SECONDS",
    "ASC_LLM_MAX_RETRIES",
    // Mock toggle
    "USE_MOCK_LLM",
  ];
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
      strategicRationale: "Mock: contexto inicial, foco em receptividade.",
      contentPool: [
        {
          item: {
            id: "ling_inuit_snow",
            type: "curiosity_hook",
            domain: "linguistics",
            casel_target: ["SA"],
            age_range: [7, 14],
            surprise: 9,
            verified: true,
            base_score: 7,
            fact: "Os Inuit têm 50+ palavras pra neve.",
            bridge: "Quantas palavras você tem pra raiva?",
            quest: "Encontre 5 palavras pro que sente agora.",
            sacrifice_type: "reflect",
          },
          score: 9,
          reasons: ["base_score=7", "surprise_bonus=+4"],
        },
      ],
      contextHints: { language: "pt-br", status_gates: { emotional: { ok: true } } },
    });
  }
  if (service === "motor-drota" && tool === "evaluate_and_select") {
    const _strategicRationale = (args?.["strategicRationale"] as string | undefined) ?? "";
    const _contextHints = (args?.["contextHints"] as Record<string, unknown> | undefined) ?? {};
    const _instructionAddition = (args?.["instruction_addition"] as string | undefined) ?? "";
    void _strategicRationale; void _contextHints; void _instructionAddition;
    const contentPool = (args?.["contentPool"] as unknown[] | undefined) ?? [];
    const first = contentPool[0] as { item?: { id?: string }; score?: number; reasons?: string[] } | undefined;
    const selectedItem = first?.item ?? {
      id: "mock_fallback",
      type: "curiosity_hook",
      domain: "generic",
      casel_target: ["SA"],
      age_range: [0, 99],
      surprise: 7,
      verified: true,
      base_score: 7,
      fact: "",
      bridge: "",
      quest: "",
      sacrifice_type: "reflect",
    };
    return JSON.stringify({
      selectedContent: { item: selectedItem, score: first?.score ?? 0, reasons: first?.reasons ?? [] },
      selectionRationale: "Mock: top do pool.",
      linguisticMaterialization: "Olá! Que bom ter você aqui. Posso te contar algo que pode te surpreender?",
    });
  }
  if (service === "motor-execucao" && tool === "get_state") {
    const sessionId = (args?.["sessionId"] as string) ?? "mock-session";
    return JSON.stringify({
      sessionId,
      trustLevel: 0.3,
      budgetRemaining: 100,
      turn: 0,
      eventLog: [],
      statusMatrix: {
        emotional: "baia",
        social_with_ebrota: "baia",
        social_with_parent: "baia",
        social_with_sibling: "baia",
      },
    });
  }
  if (service === "motor-execucao" && tool === "execute_playbook") {
    const sessionId = (args?.["sessionId"] as string) ?? "mock-session";
    return JSON.stringify({
      success: true,
      newState: { sessionId, trustLevel: 0.34, budgetRemaining: 99, turn: 1, eventLog: [] },
      eventLogged: {
        timestamp: new Date().toISOString(),
        type: "playbook_executed",
        playbookId: "default",
        data: { selectedContentId: args?.["selectedContentId"] ?? "" },
      },
    });
  }
  return JSON.stringify({ ok: true });
}
