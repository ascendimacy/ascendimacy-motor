import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  GatewayChatCompletionInput,
  GatewayChatCompletionOutput,
  EvaluateAndSelectInput,
  ContentItem,
  ScoredContentItem,
  PersonaDef,
} from "@ascendimacy/shared";

// Mock callGateway antes do import do handler (vitest hoists vi.mock factory).
const mockState: {
  responses: GatewayChatCompletionOutput[];
  callCount: number;
} = {
  responses: [],
  callCount: 0,
};

vi.mock("@ascendimacy/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ascendimacy/shared")>();
  return {
    ...actual,
    callGateway: async (_req: GatewayChatCompletionInput) => {
      const response =
        mockState.responses[mockState.callCount] ??
        mockState.responses[mockState.responses.length - 1];
      mockState.callCount += 1;
      if (!response) {
        throw new Error("test setup error: no mock response queued");
      }
      return response;
    },
  };
});

import { handleSimplifiedPipeline } from "../src/simplified-pipeline-handler.js";
import { rankPool } from "../src/evaluate.js";

function buildLlmResponse(content: string): GatewayChatCompletionOutput {
  return {
    content,
    tokens: { in: 100, out: 50, reasoning: 0 },
    provider: "anthropic",
    model: "claude-haiku-4-5",
    latency_ms: 100,
    attempt_count: 1,
    was_fallback: false,
  };
}

function neutralAssessorResponse(): GatewayChatCompletionOutput {
  return buildLlmResponse(
    `{"mood": 5, "mood_confidence": "medium", "signals": [], "engagement": "medium", "rationale": "neutral"}`,
  );
}

function stubItem(id: string): ScoredContentItem {
  return {
    item: {
      id,
      type: "curiosity_hook",
      domain: "biology",
      casel_target: ["SA"],
      age_range: [7, 14],
      surprise: 6,
      verified: true,
      base_score: 6,
      fact: "Stub fact.",
      bridge: "Stub bridge.",
      quest: "Stub quest.",
      sacrifice_type: "reflect",
      sacrifice_amount: 3,
    } as ContentItem,
    score: 6,
    reasons: [],
  };
}

function stubInput(
  contextHints: Record<string, unknown>,
): EvaluateAndSelectInput {
  return {
    sessionId: "test-session",
    contentPool: [stubItem("a"), stubItem("b")],
    state: {
      sessionId: "test-session",
      trustLevel: 0.5,
      budgetRemaining: 50,
      eventLog: [],
      turn: 1,
    },
    persona: {
      id: "kei-001",
      name: "Kei",
      age: 11,
      profile: {},
    } as PersonaDef,
    strategicRationale: "",
    contextHints,
  } as EvaluateAndSelectInput;
}

beforeEach(() => {
  mockState.responses = [];
  mockState.callCount = 0;
});

describe("handleSimplifiedPipeline — compose_playbook short-circuit (fatia 5)", () => {
  it("apresenta inventory_probe_options[0].text quando probe presente", async () => {
    mockState.responses.push(neutralAssessorResponse());

    const input = stubInput({
      tutorial: { move_type: "compose_playbook" },
      inventory_probe_options: [
        {
          kind: "materials_around",
          text: "Olha em volta — tem alguma coisa útil pra construir?",
          expected_extraction_target: "available_materials",
        },
        {
          kind: "time_window",
          text: "Quanto tempo livre você tem hoje?",
          expected_extraction_target: "available_time_minutes",
        },
      ],
    });
    const ranked = rankPool(input.contentPool);
    const out = await handleSimplifiedPipeline(input, ranked);
    expect(out.linguisticMaterialization).toBe(
      "Olha em volta — tem alguma coisa útil pra construir?",
    );
  });

  it("apresenta playbook intro quando emergent_playbook presente (sem probe)", async () => {
    mockState.responses.push(neutralAssessorResponse());

    const input = stubInput({
      tutorial: { move_type: "compose_playbook" },
      emergent_playbook: {
        playbook_id: "piloto-Kei-12345",
        steps: [
          { hint_to_subject: "Faz a lista de ingredientes do bolo" },
          { hint_to_subject: "Compra ingredientes (R$ 30 max)" },
          { hint_to_subject: "Mistura e leva ao forno" },
        ],
        total_duration_minutes: 90,
        budget_range_cents: { min: 2000, max: 3000 },
        composition_rationale: "Bolo simples pra primeiro desafio.",
      },
    });
    const ranked = rankPool(input.contentPool);
    const out = await handleSimplifiedPipeline(input, ranked);
    expect(out.linguisticMaterialization).toContain("Kei");
    expect(out.linguisticMaterialization).toContain("3 passos");
    expect(out.linguisticMaterialization).toContain("90min");
    expect(out.linguisticMaterialization).toContain("30.00");
    expect(out.linguisticMaterialization).toContain("Faz a lista");
    expect(out.linguisticMaterialization).toContain("Topa?");
  });

  it("probe tem prioridade sobre playbook quando ambos presentes", async () => {
    mockState.responses.push(neutralAssessorResponse());

    const input = stubInput({
      tutorial: { move_type: "compose_playbook" },
      inventory_probe_options: [
        {
          kind: "time_window",
          text: "Quanto tempo você tem hoje?",
          expected_extraction_target: "available_time_minutes",
        },
      ],
      emergent_playbook: {
        playbook_id: "piloto-Kei-12345",
        steps: [{ hint_to_subject: "Lista" }],
        total_duration_minutes: 30,
        budget_range_cents: { max: 2000 },
        composition_rationale: "x",
      },
    });
    const ranked = rankPool(input.contentPool);
    const out = await handleSimplifiedPipeline(input, ranked);
    expect(out.linguisticMaterialization).toBe("Quanto tempo você tem hoje?");
  });

  it("fallback conversacional quando nem probe nem playbook presentes", async () => {
    mockState.responses.push(neutralAssessorResponse());

    const input = stubInput({
      tutorial: { move_type: "compose_playbook" },
    });
    const ranked = rankPool(input.contentPool);
    const out = await handleSimplifiedPipeline(input, ranked);
    expect(out.linguisticMaterialization).toContain("Kei");
    expect(out.linguisticMaterialization.toLowerCase()).toContain("desafio");
  });

  it("emergent_playbook com steps vazio cai pro fallback conversacional", async () => {
    mockState.responses.push(neutralAssessorResponse());

    const input = stubInput({
      tutorial: { move_type: "compose_playbook" },
      emergent_playbook: {
        playbook_id: "piloto-Kei-empty",
        steps: [],
        total_duration_minutes: 0,
        budget_range_cents: { max: 0 },
        composition_rationale: "empty",
      },
    });
    const ranked = rankPool(input.contentPool);
    const out = await handleSimplifiedPipeline(input, ranked);
    expect(out.linguisticMaterialization.toLowerCase()).toContain("desafio");
  });

  it("warning emitido no engine trace pra observability", async () => {
    mockState.responses.push(neutralAssessorResponse());

    const input = stubInput({
      tutorial: { move_type: "compose_playbook" },
      inventory_probe_options: [
        {
          kind: "materials_around",
          text: "test",
          expected_extraction_target: "available_materials",
        },
      ],
    });
    const ranked = rankPool(input.contentPool);
    const out = await handleSimplifiedPipeline(input, ranked, { captureTrace: true });
    const warnings = out.engineTrace?.warnings ?? [];
    const wiringWarning = warnings.find(
      (w) => w.component === "compose_playbook_wiring",
    );
    expect(wiringWarning).toBeTruthy();
    expect(wiringWarning?.message).toContain("materials_around");
  });

  it("move_type=discover (não compose_playbook) NÃO ativa wiring", async () => {
    mockState.responses.push(neutralAssessorResponse());
    // discover path tem seu próprio short-circuit (com discovery_options).
    // Aqui só verificamos que compose_playbook wiring não é tocado.

    const input = stubInput({
      tutorial: { move_type: "discover" },
      inventory_probe_options: [
        {
          kind: "materials_around",
          text: "PROBE QUE NÃO DEVE APARECER",
          expected_extraction_target: "available_materials",
        },
      ],
      discovery_options: [
        {
          kind: "interest_probe",
          text: "Discover question",
          anchor: "x",
        },
      ],
    });
    const ranked = rankPool(input.contentPool);
    const out = await handleSimplifiedPipeline(input, ranked);
    expect(out.linguisticMaterialization).not.toContain("PROBE QUE NÃO");
    expect(out.linguisticMaterialization).toBe("Discover question");
  });
});
