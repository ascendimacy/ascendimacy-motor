/**
 * TV2-7 wiring — ReplayTurnDetail → LlmXrayPanel via llmXrayCalls store.
 *
 * Verifica que o botão "🔬 X-ray (N calls)" aparece quando engineTrace.llm_calls
 * tem itens, e que click popula o store + abre o modal. UI do modal em si está
 * coberta por tests/components/LlmXrayPanel.test.ts — aqui o foco é só a ponte.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/svelte";
import { get } from "svelte/store";
import ReplayTurnDetail from "../src/components/ReplayTurnDetail.svelte";
import { llmXrayCalls, llmXrayPanelOpen } from "../src/lib/stores.js";
import type { ReplayTraceTurn, LlmCallLike } from "../src/lib/api.js";

const sampleCall = (overrides: Partial<LlmCallLike> = {}): LlmCallLike => ({
  id: "call-1",
  role: "assessor",
  provider: "anthropic",
  model: "claude-haiku-4",
  prompt: "PROMPT",
  response: "RESPONSE",
  duration_ms: 100,
  input_tokens: 50,
  output_tokens: 10,
  ...overrides,
});

const turnWithCalls = (calls: LlmCallLike[]): ReplayTraceTurn => ({
  turnNumber: 7,
  trustLevel: 0.5,
  engineTrace: {
    schema_version: 2,
    turn_started_at: "2026-05-27T10:00:00Z",
    turn_completed_at: "2026-05-27T10:00:01Z",
    state_diff: {
      trust_delta: 0,
      budget_delta: 0,
      subject_knowledge_added_count: 0,
    },
    components: {},
    llm_calls: calls,
    subject_knowledge_writes: [],
    warnings: [],
  },
});

beforeEach(() => {
  llmXrayCalls.set([]);
  llmXrayPanelOpen.set(false);
});

afterEach(() => {
  cleanup();
  llmXrayCalls.set([]);
  llmXrayPanelOpen.set(false);
});

describe("ReplayTurnDetail → LlmXrayPanel wiring (TV2-7)", () => {
  it("não renderiza botão X-ray quando engineTrace ausente", () => {
    render(ReplayTurnDetail, {
      turn: { turnNumber: 1, trustLevel: 0.5 } satisfies ReplayTraceTurn,
    });
    expect(screen.queryByTestId("xray-open-btn")).toBeNull();
  });

  it("não renderiza botão X-ray quando llm_calls vazio", () => {
    render(ReplayTurnDetail, { turn: turnWithCalls([]) });
    expect(screen.queryByTestId("xray-open-btn")).toBeNull();
  });

  it("renderiza botão '🔬 X-ray (3 calls)' quando turn tem 3 LLM calls", () => {
    render(ReplayTurnDetail, {
      turn: turnWithCalls([
        sampleCall({ id: "c1", role: "assessor" }),
        sampleCall({ id: "c2", role: "planejador" }),
        sampleCall({ id: "c3", role: "materializer" }),
      ]),
    });
    const btn = screen.getByTestId("xray-open-btn");
    expect(btn).toBeDefined();
    expect(btn.textContent).toMatch(/🔬 X-ray \(3 calls\)/);
  });

  it("singular 'call' quando exatamente 1", () => {
    render(ReplayTurnDetail, {
      turn: turnWithCalls([sampleCall({ id: "only" })]),
    });
    expect(screen.getByTestId("xray-open-btn").textContent).toMatch(
      /🔬 X-ray \(1 call\)/,
    );
  });

  it("click no botão popula llmXrayCalls e abre llmXrayPanelOpen", async () => {
    const calls = [
      sampleCall({ id: "c1", role: "assessor" }),
      sampleCall({ id: "c2", role: "planejador" }),
      sampleCall({ id: "c3", role: "materializer" }),
    ];
    render(ReplayTurnDetail, { turn: turnWithCalls(calls) });

    expect(get(llmXrayPanelOpen)).toBe(false);
    expect(get(llmXrayCalls)).toHaveLength(0);

    await fireEvent.click(screen.getByTestId("xray-open-btn"));

    expect(get(llmXrayPanelOpen)).toBe(true);
    const pushed = get(llmXrayCalls);
    expect(pushed).toHaveLength(3);
    expect(pushed.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("click no botão não toggla a seção expanded (stopPropagation)", async () => {
    render(ReplayTurnDetail, {
      turn: turnWithCalls([sampleCall({ id: "c1" })]),
    });
    const toggle = screen.getByTestId("engine-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await fireEvent.click(screen.getByTestId("xray-open-btn"));

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
