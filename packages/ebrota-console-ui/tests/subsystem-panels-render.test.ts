/**
 * Smoke tests para os 7 painéis de subsistema (S1-S5 + B1-B2).
 * Verifica que cada um renderiza sem erro, expõe a shell com ID
 * correto, e que placeholders mostram link pra spec quando aplicável.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-7-subsistemas-redesign-v0.md
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/svelte";
import { get } from "svelte/store";
import S1AprendizPanel from "../src/components/subsystem-panels/S1AprendizPanel.svelte";
import S2DoutrinaPanel from "../src/components/subsystem-panels/S2DoutrinaPanel.svelte";
import S3DecisaoTurnPanel from "../src/components/subsystem-panels/S3DecisaoTurnPanel.svelte";
import S4ExpressaoTurnPanel from "../src/components/subsystem-panels/S4ExpressaoTurnPanel.svelte";
import S5AvaliacaoPanel from "../src/components/subsystem-panels/S5AvaliacaoPanel.svelte";
import B1SocialPanel from "../src/components/subsystem-panels/B1SocialPanel.svelte";
import B2DrillingPanel from "../src/components/subsystem-panels/B2DrillingPanel.svelte";
import {
  expandedSubsystem,
  currentTurnSnapshot,
  llmXrayPanelOpen,
} from "../src/lib/stores.js";

beforeEach(() => {
  expandedSubsystem.set("S1");
  currentTurnSnapshot.set(null);
  llmXrayPanelOpen.set(false);
  // Silence console errors from missing window APIs in jsdom edge cases.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("subsystem panels — smoke render", () => {
  it("S1AprendizPanel renderiza shell com id correto + placeholder pra objetivos", () => {
    render(S1AprendizPanel);
    expect(screen.getByTestId("subsystem-panel-S1")).toBeDefined();
    // placeholder banner aponta pra spec de objetivos declarados
    const placeholders = screen.getAllByTestId("placeholder-banner");
    expect(placeholders.length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/2026-05-26-s1-objetivos-declarados-v0\.md/),
    ).toBeDefined();
  });

  it("S2DoutrinaPanel renderiza shell + 6 jogadas (5 + Recovery)", () => {
    render(S2DoutrinaPanel);
    expect(screen.getByTestId("subsystem-panel-S2")).toBeDefined();
    expect(screen.getByText("Bridge")).toBeDefined();
    expect(screen.getByText("Espelho")).toBeDefined();
    expect(screen.getByText("Canal")).toBeDefined();
    expect(screen.getByText("Diamante")).toBeDefined();
    expect(screen.getByText("Arena")).toBeDefined();
    expect(screen.getByText("Recovery")).toBeDefined();
  });

  it("S3DecisaoTurnPanel mostra empty state sem snapshot + botão X-ray", async () => {
    render(S3DecisaoTurnPanel);
    expect(screen.getByTestId("subsystem-panel-S3")).toBeDefined();
    expect(screen.getByText(/Sem turno ativo/)).toBeDefined();
    const xray = screen.getByTestId("s3-xray-btn");
    await fireEvent.click(xray);
    expect(get(llmXrayPanelOpen)).toBe(true);
  });

  it("S3DecisaoTurnPanel renderiza dados do turno quando snapshot existe", () => {
    currentTurnSnapshot.set({
      sessionId: "sess-x",
      turn: 7,
      lastPhase: "selection_made",
      lastTimestamp: "2026-05-27T10:00:00Z",
      strategicRationale: "explorar curiosidade sobre joaninhas",
      contentPoolSize: 8,
      selectedContentId: "ladybug.life-cycle.001",
      selectedContentScore: 0.823,
    });
    render(S3DecisaoTurnPanel);
    expect(screen.getByText(/turn 7/)).toBeDefined();
    expect(screen.getByText(/explorar curiosidade sobre joaninhas/)).toBeDefined();
    expect(screen.getByText("ladybug.life-cycle.001")).toBeDefined();
  });

  it("S4ExpressaoTurnPanel mostra empty state + botão X-ray funcional", async () => {
    render(S4ExpressaoTurnPanel);
    expect(screen.getByTestId("subsystem-panel-S4")).toBeDefined();
    expect(screen.getByText(/Sem turno ativo/)).toBeDefined();
    await fireEvent.click(screen.getByTestId("s4-xray-btn"));
    expect(get(llmXrayPanelOpen)).toBe(true);
  });

  it("S5AvaliacaoPanel renderiza 3 sub-tabs (Guardrail / STS / Longitudinal)", async () => {
    render(S5AvaliacaoPanel);
    expect(screen.getByTestId("subsystem-panel-S5")).toBeDefined();
    expect(screen.getByTestId("s5-tab-guardrail")).toBeDefined();
    expect(screen.getByTestId("s5-tab-sts")).toBeDefined();
    expect(screen.getByTestId("s5-tab-longitudinal")).toBeDefined();
    // tab inicial = guardrail
    expect(screen.getByTestId("s5-pane-guardrail")).toBeDefined();
    // troca pra STS
    await fireEvent.click(screen.getByTestId("s5-tab-sts"));
    expect(screen.getByTestId("s5-pane-sts")).toBeDefined();
    // troca pra Longitudinal — mostra placeholder com link spec
    await fireEvent.click(screen.getByTestId("s5-tab-longitudinal"));
    expect(screen.getByTestId("s5-pane-longitudinal")).toBeDefined();
    expect(screen.getByText(/2026-05-26-s5c-longitudinal-v0\.md/)).toBeDefined();
  });

  it("B1SocialPanel renderiza shell + loading inicial (B1/B2 wiring PR #243)", () => {
    // Render sem api injetado → usa default client; b1-loading aparece antes
    // do Promise resolver, garantindo que a shell montou.
    render(B1SocialPanel);
    expect(screen.getByTestId("subsystem-panel-B1")).toBeDefined();
    expect(screen.getByTestId("b1-loading")).toBeDefined();
  });

  it("B2DrillingPanel renderiza shell + loading inicial (B1/B2 wiring PR #244)", () => {
    render(B2DrillingPanel);
    expect(screen.getByTestId("subsystem-panel-B2")).toBeDefined();
    expect(screen.getByTestId("b2-loading")).toBeDefined();
  });

  it("close button volta ao grid (seta expandedSubsystem=null)", async () => {
    render(S1AprendizPanel);
    await fireEvent.click(screen.getByTestId("subsystem-panel-S1-close"));
    expect(get(expandedSubsystem)).toBeNull();
  });
});
