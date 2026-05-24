import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import App from "../src/App.svelte";
import { globalError } from "../src/lib/stores.js";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  globalError.set(null);
  // Mock fetch pra evitar errors de network real durante mount.
  fetchMock = vi.fn(async () => ({
    ok: false,
    status: 503,
    statusText: "Service Unavailable",
    json: async () => ({}),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App.svelte smoke (PR3 layout)", () => {
  it("renderiza header eBrota Console", () => {
    render(App);
    expect(
      screen.getByRole("heading", { name: /eBrota Console/i, level: 1 }),
    ).toBeDefined();
  });

  it("renderiza versão v0.1.0", () => {
    render(App);
    expect(screen.getByText(/v0\.1\.0/)).toBeDefined();
  });

  it("renderiza chat feed + motor placeholder", () => {
    render(App);
    expect(screen.getByTestId("chat-feed")).toBeDefined();
    expect(screen.getByTestId("motor-placeholder")).toBeDefined();
  });

  it("renderiza session start form", () => {
    render(App);
    expect(screen.getByTestId("session-start")).toBeDefined();
    expect(screen.getByTestId("start-button")).toBeDefined();
  });

  // Nota: error banner via store globalError tem cobertura dedicada em
  // SessionStart.test.ts ("globalError populado quando startCardSession
  // falha"). Smoke aqui foca em render do layout — mount lifecycle do
  // App + status polling via fetch dependeria de jsdom fetch global +
  // svelte onMount timing peculiar do vitest. Cobertura indireta basta
  // pra PR3; PR seguinte pode adicionar integration test com vitest
  // browser mode se necessário.
});
