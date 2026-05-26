/**
 * Tests pra LlmXrayPanel.svelte (TV2-7).
 *
 * Empty state, populated rows, role filter, total tokens summary,
 * expand row → prompt + response.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/svelte";
import { get } from "svelte/store";
import LlmXrayPanel from "../../src/components/LlmXrayPanel.svelte";
import {
  llmXrayCalls,
  llmXrayPanelOpen,
} from "../../src/lib/stores.js";
import type { LlmCallLike } from "../../src/lib/api.js";

const sampleCall = (overrides: Partial<LlmCallLike> = {}): LlmCallLike => ({
  id: "call-1",
  role: "assessor",
  provider: "anthropic",
  model: "claude-haiku-4",
  prompt: "You are an assessor...",
  response: '{"mood": 0.4, "signals": []}',
  duration_ms: 320,
  input_tokens: 100,
  output_tokens: 30,
  ...overrides,
});

beforeEach(() => {
  llmXrayPanelOpen.set(true);
  llmXrayCalls.set([]);
});

afterEach(() => {
  cleanup();
  llmXrayPanelOpen.set(false);
  llmXrayCalls.set([]);
});

describe("LlmXrayPanel.svelte — visibility", () => {
  it("não renderiza quando llmXrayPanelOpen=false", () => {
    llmXrayPanelOpen.set(false);
    render(LlmXrayPanel);
    expect(screen.queryByTestId("llm-xray-overlay")).toBeNull();
  });

  it("renderiza modal + header quando open", () => {
    render(LlmXrayPanel);
    expect(screen.getByTestId("llm-xray-overlay")).toBeDefined();
    expect(screen.getByTestId("llm-xray-modal")).toBeDefined();
  });

  it("close button fecha o painel", async () => {
    render(LlmXrayPanel);
    await fireEvent.click(screen.getByTestId("llm-xray-close"));
    expect(get(llmXrayPanelOpen)).toBe(false);
  });
});

describe("LlmXrayPanel.svelte — empty state", () => {
  it("calls vazio → empty state visível", () => {
    llmXrayCalls.set([]);
    render(LlmXrayPanel);
    expect(screen.getByTestId("llm-xray-empty")).toBeDefined();
  });

  it("count badge mostra 0 calls", () => {
    llmXrayCalls.set([]);
    render(LlmXrayPanel);
    expect(screen.getByTestId("llm-xray-count").textContent).toMatch(/0 calls/);
  });
});

describe("LlmXrayPanel.svelte — populated calls", () => {
  it("renderiza uma row por call", () => {
    llmXrayCalls.set([
      sampleCall({ id: "c1", role: "assessor" }),
      sampleCall({ id: "c2", role: "materializer" }),
      sampleCall({ id: "c3", role: "planejador" }),
    ]);
    render(LlmXrayPanel);
    expect(screen.getAllByTestId("llm-xray-call")).toHaveLength(3);
  });

  it("role badges visíveis", () => {
    llmXrayCalls.set([
      sampleCall({ id: "c1", role: "assessor" }),
      sampleCall({ id: "c2", role: "materializer" }),
    ]);
    render(LlmXrayPanel);
    const badges = screen.getAllByTestId("llm-xray-role-badge");
    expect(badges).toHaveLength(2);
    expect(badges[0]!.textContent).toBe("assessor");
    expect(badges[1]!.textContent).toBe("materializer");
  });

  it("count badge mostra número correto", () => {
    llmXrayCalls.set([sampleCall({ id: "c1" }), sampleCall({ id: "c2" })]);
    render(LlmXrayPanel);
    expect(screen.getByTestId("llm-xray-count").textContent).toMatch(/2 calls/);
  });

  it("cache hit badge aparece quando prompt_cache_hit=true", () => {
    llmXrayCalls.set([sampleCall({ id: "c1", prompt_cache_hit: true })]);
    render(LlmXrayPanel);
    expect(screen.getByText("⚡cache")).toBeDefined();
  });

  it("error badge aparece quando call tem error", () => {
    llmXrayCalls.set([
      sampleCall({ id: "c1", error: "timeout after 120s" }),
    ]);
    render(LlmXrayPanel);
    expect(screen.getByText("⚠ error")).toBeDefined();
  });
});

describe("LlmXrayPanel.svelte — totals summary", () => {
  it("total input/output tokens calculados", () => {
    llmXrayCalls.set([
      sampleCall({ id: "c1", input_tokens: 100, output_tokens: 30 }),
      sampleCall({ id: "c2", input_tokens: 250, output_tokens: 80 }),
      sampleCall({ id: "c3", input_tokens: 50, output_tokens: 10 }),
    ]);
    render(LlmXrayPanel);
    expect(screen.getByTestId("llm-xray-input-total").textContent).toMatch(
      /400 tok/,
    );
    expect(screen.getByTestId("llm-xray-output-total").textContent).toMatch(
      /120 tok/,
    );
  });

  it("totais tratam tokens undefined como 0", () => {
    llmXrayCalls.set([
      sampleCall({ id: "c1", input_tokens: 100, output_tokens: 30 }),
      sampleCall({
        id: "c2",
        input_tokens: undefined,
        output_tokens: undefined,
      }),
    ]);
    render(LlmXrayPanel);
    expect(screen.getByTestId("llm-xray-input-total").textContent).toMatch(
      /100 tok/,
    );
    expect(screen.getByTestId("llm-xray-output-total").textContent).toMatch(
      /30 tok/,
    );
  });
});

describe("LlmXrayPanel.svelte — role filter", () => {
  it("filter 'all' por default mostra todos", () => {
    llmXrayCalls.set([
      sampleCall({ id: "c1", role: "assessor" }),
      sampleCall({ id: "c2", role: "materializer" }),
      sampleCall({ id: "c3", role: "assessor" }),
    ]);
    render(LlmXrayPanel);
    expect(screen.getAllByTestId("llm-xray-call")).toHaveLength(3);
  });

  it("seleciona role → filtra rows", async () => {
    llmXrayCalls.set([
      sampleCall({ id: "c1", role: "assessor" }),
      sampleCall({ id: "c2", role: "materializer" }),
      sampleCall({ id: "c3", role: "assessor" }),
    ]);
    render(LlmXrayPanel);
    const select = screen.getByTestId(
      "llm-xray-role-select",
    ) as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "assessor" } });
    expect(screen.getAllByTestId("llm-xray-call")).toHaveLength(2);
  });

  it("filtro 'materializer' mostra só materializer", async () => {
    llmXrayCalls.set([
      sampleCall({ id: "c1", role: "assessor" }),
      sampleCall({ id: "c2", role: "materializer" }),
      sampleCall({ id: "c3", role: "planejador" }),
    ]);
    render(LlmXrayPanel);
    const select = screen.getByTestId(
      "llm-xray-role-select",
    ) as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "materializer" } });
    const rows = screen.getAllByTestId("llm-xray-call");
    expect(rows).toHaveLength(1);
    const badge = screen.getByTestId("llm-xray-role-badge");
    expect(badge.textContent).toBe("materializer");
  });
});

describe("LlmXrayPanel.svelte — expand row", () => {
  it("expand toggle revela prompt + response", async () => {
    llmXrayCalls.set([
      sampleCall({
        id: "c1",
        prompt: "SYSTEM PROMPT XYZ",
        response: "ASSISTANT RESPONSE ABC",
      }),
    ]);
    render(LlmXrayPanel);
    expect(screen.queryByTestId("llm-xray-call-body")).toBeNull();
    await fireEvent.click(screen.getByTestId("llm-xray-call-toggle"));
    expect(screen.getByTestId("llm-xray-call-body")).toBeDefined();
    expect(screen.getByTestId("llm-xray-prompt").textContent).toBe(
      "SYSTEM PROMPT XYZ",
    );
    expect(screen.getByTestId("llm-xray-response").textContent).toBe(
      "ASSISTANT RESPONSE ABC",
    );
  });

  it("copy prompt button chama navigator.clipboard.writeText", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    llmXrayCalls.set([sampleCall({ id: "c1", prompt: "PROMPT_DATA" })]);
    render(LlmXrayPanel);
    await fireEvent.click(screen.getByTestId("llm-xray-call-toggle"));
    await fireEvent.click(screen.getByTestId("llm-xray-copy-prompt"));
    expect(writeText).toHaveBeenCalledWith("PROMPT_DATA");
  });

  it("copy response button chama navigator.clipboard.writeText", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    llmXrayCalls.set([
      sampleCall({ id: "c1", response: "RESPONSE_DATA" }),
    ]);
    render(LlmXrayPanel);
    await fireEvent.click(screen.getByTestId("llm-xray-call-toggle"));
    await fireEvent.click(screen.getByTestId("llm-xray-copy-response"));
    expect(writeText).toHaveBeenCalledWith("RESPONSE_DATA");
  });

  it("colapsar uma row não afeta outras", async () => {
    llmXrayCalls.set([
      sampleCall({ id: "c1", role: "assessor" }),
      sampleCall({ id: "c2", role: "materializer" }),
    ]);
    render(LlmXrayPanel);
    const toggles = screen.getAllByTestId("llm-xray-call-toggle");
    await fireEvent.click(toggles[0]!);
    await fireEvent.click(toggles[1]!);
    expect(screen.getAllByTestId("llm-xray-call-body")).toHaveLength(2);
    await fireEvent.click(toggles[0]!);
    expect(screen.getAllByTestId("llm-xray-call-body")).toHaveLength(1);
  });
});
