/**
 * SubsystemGrid + SubsystemCard tests — verifica que landing renderiza
 * os 7 cards, click expande, e que SubsystemCard emite events.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-7-subsistemas-redesign-v0.md
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/svelte";
import { get } from "svelte/store";
import SubsystemGrid from "../src/components/SubsystemGrid.svelte";
import SubsystemCard from "../src/components/SubsystemCard.svelte";
import { expandedSubsystem } from "../src/lib/stores.js";

afterEach(() => cleanup());

beforeEach(() => {
  expandedSubsystem.set(null);
});

describe("SubsystemGrid", () => {
  it("renderiza os 7 cards de subsistema", () => {
    render(SubsystemGrid);
    const grid = screen.getByTestId("subsystem-grid");
    expect(grid).toBeDefined();
    for (const id of ["S1", "S2", "S3", "S4", "S5", "B1", "B2"]) {
      expect(screen.getByTestId(`subsystem-card-${id}`)).toBeDefined();
    }
  });

  it("click no card S1 seta expandedSubsystem === 'S1'", async () => {
    render(SubsystemGrid);
    await fireEvent.click(screen.getByTestId("subsystem-card-S1"));
    expect(get(expandedSubsystem)).toBe("S1");
  });

  it("click no card B2 seta expandedSubsystem === 'B2'", async () => {
    render(SubsystemGrid);
    await fireEvent.click(screen.getByTestId("subsystem-card-B2"));
    expect(get(expandedSubsystem)).toBe("B2");
  });
});

describe("SubsystemCard", () => {
  it("emite event 'expand' com id correto quando clicado", async () => {
    let captured: string | null = null;
    const { component } = render(SubsystemCard, {
      props: { id: "S3", title: "Decisão", color: "#eab308" },
    });
    component.$on("expand", (ev: CustomEvent<{ id: string }>) => {
      captured = ev.detail.id;
    });
    await fireEvent.click(screen.getByTestId("subsystem-card-S3"));
    expect(captured).toBe("S3");
  });

  it("mostra status icon impl/partial/placeholder", () => {
    render(SubsystemCard, {
      props: {
        id: "S1",
        title: "Aprendiz",
        status: "partial",
      },
    });
    // ◑ é o icon de partial
    expect(screen.getByText("◑")).toBeDefined();
  });

  it("Enter ou Espaço dispara expand (acessibilidade)", async () => {
    let captured: string | null = null;
    const { component } = render(SubsystemCard, {
      props: { id: "S5", title: "Avaliação" },
    });
    component.$on("expand", (ev: CustomEvent<{ id: string }>) => {
      captured = ev.detail.id;
    });
    const btn = screen.getByTestId("subsystem-card-S5");
    await fireEvent.keyDown(btn, { key: "Enter" });
    expect(captured).toBe("S5");
  });
});
