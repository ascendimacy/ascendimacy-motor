import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import App from "../src/App.svelte";

describe("App.svelte placeholder", () => {
  it("renderiza header eBrota Console", () => {
    render(App);
    expect(screen.getByRole("heading", { name: /eBrota Console/i })).toBeDefined();
  });

  it("renderiza versão", () => {
    render(App);
    expect(screen.getByText(/v0\.1\.0/)).toBeDefined();
  });

  it("lista PRs futuros (PR2..PR6+)", () => {
    render(App);
    // Texto quebrado entre <strong>PR2</strong> e " — BFF proxy..." então
    // procura por substring suficiente pra match.
    expect(screen.getByText(/BFF proxy/i)).toBeDefined();
    expect(screen.getByText(/Vista usuário/i)).toBeDefined();
    expect(screen.getByText(/leque pedagógico/i)).toBeDefined();
  });
});
