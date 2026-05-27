import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import ParentalOnboardingWizard from "../src/components/ParentalOnboardingWizard.svelte";

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

const MC10_RESPONSE = {
  beforeBullets: ["bullet antes 1"],
  duringBullets: ["bullet durante 1", "bullet durante 2"],
  afterBullets: ["bullet depois 1", "bullet depois 2"],
  jpPhrases: [{ pt: "test PT", jp: "テスト" }],
  escalationPath: "escala pro Jun",
};

function buildFetchMock(): {
  fn: typeof globalThis.fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fn = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    let body: unknown = undefined;
    if (init?.body !== undefined) {
      body = JSON.parse(init.body as string);
    }
    calls.push({ url, method, body });
    if (url.endsWith("/parental/mc10-material") && method === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => MC10_RESPONSE,
      } as Response;
    }
    if (url.endsWith("/parental/onboarding/draft") && method === "POST") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ acquirerId: "x", step: 1, status: "in_progress" }),
      } as Response;
    }
    if (url.endsWith("/parental/onboarding/complete") && method === "POST") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ acquirerId: "x", status: "complete" }),
      } as Response;
    }
    if (url.endsWith("/parental/mc1/preview") && method === "POST") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          personaId: "p1",
          text: "Oi! Eu sou Brota.",
          generatedAt: new Date().toISOString(),
        }),
      } as Response;
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    } as Response;
  };
  return { fn: fn as unknown as typeof globalThis.fetch, calls };
}

let mock = buildFetchMock();

beforeEach(() => {
  mock = buildFetchMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderWizard(opts: { withMaterial?: boolean } = {}) {
  return render(ParentalOnboardingWizard, {
    fetchImpl: mock.fn,
    initialMc10Material: opts.withMaterial === false ? null : MC10_RESPONSE,
  });
}

describe("ParentalOnboardingWizard render + step 1", () => {
  it("renderiza wizard com step 1 e progress 1/11", async () => {
    renderWizard();
    await tick();
    expect(screen.getByTestId("parental-onboarding-wizard")).toBeDefined();
    expect(
      screen.getByText(/Passo 1\/11 — Receber material MC10/),
    ).toBeDefined();
  });

  it("sem material pré-carregado, exibe 'Carregando' ou 'indisponível'", async () => {
    // Quando fetchImpl não é wired e initialMc10Material=null, wizard
    // tenta fetch real (jsdom não tem rede) → cai no catch → material
    // permanece null e o estado de erro/indisponível é renderizado.
    // O comportamento crítico (gate em step 1 disabled) é verificado em
    // testes de unidade.
    renderWizard({ withMaterial: false });
    await tick();
    const stepEl = screen.getByTestId("step-01");
    expect(stepEl.textContent).toMatch(/Carregando|indisponível/);
  });

  it("botão Próximo disabled antes de marcar MC10 como lido", async () => {
    renderWizard();
    await waitFor(() => {
      const btn = screen.getByTestId("mc10-mark-read") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    const nextBtn = screen.getByTestId("wizard-next") as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });

  it("após click em 'Li, entendi', botão Próximo habilita", async () => {
    renderWizard();
    await waitFor(() => {
      const btn = screen.getByTestId("mc10-mark-read") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    const markRead = screen.getByTestId("mc10-mark-read");
    await fireEvent.click(markRead);
    await tick();
    const nextBtn = screen.getByTestId("wizard-next") as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);
  });
});

describe("Navegação básica step 1 → step 2", () => {
  it("após Próximo, step 2 aparece e MC10 timestamp persiste", async () => {
    renderWizard();
    await waitFor(() => {
      const btn = screen.getByTestId("mc10-mark-read") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    await fireEvent.click(screen.getByTestId("mc10-mark-read"));
    await tick();
    await fireEvent.click(screen.getByTestId("wizard-next"));
    await tick();
    expect(screen.getByTestId("step-02")).toBeDefined();
    expect(
      screen.getByText(/Passo 2\/11 — Cadastrar família/),
    ).toBeDefined();
  });
});

describe("isStep8Complete + isStep10Complete (unit logic)", () => {
  it("isStep8Complete só true com 4 consents", async () => {
    const { isStep8Complete } = await import("../src/lib/wizard-types.js");
    expect(
      isStep8Complete({
        storeTrace: false,
        emitPhysicalCards: false,
        activeHoursMessaging: false,
        confirmIsAi: false,
      }),
    ).toBe(false);
    expect(
      isStep8Complete({
        storeTrace: true,
        emitPhysicalCards: true,
        activeHoursMessaging: true,
        confirmIsAi: false,
      }),
    ).toBe(false);
    expect(
      isStep8Complete({
        storeTrace: true,
        emitPhysicalCards: true,
        activeHoursMessaging: true,
        confirmIsAi: true,
      }),
    ).toBe(true);
  });

  it("isStep10Complete exige aprovação per criança", async () => {
    const { isStep10Complete } = await import("../src/lib/wizard-types.js");
    const children = [
      { id: "ryo", name: "Ryo", age: 8, primaryLanguage: "pt" },
      { id: "kei", name: "Kei", age: 8, primaryLanguage: "pt" },
    ];
    expect(isStep10Complete([], children)).toBe(false);
    expect(
      isStep10Complete(
        [{ childId: "ryo", text: "x", approved: true }],
        children,
      ),
    ).toBe(false);
    expect(
      isStep10Complete(
        [
          { childId: "ryo", text: "x", approved: true },
          { childId: "kei", text: "y", approved: true },
        ],
        children,
      ),
    ).toBe(true);
  });
});

describe("emptyWizardState defaults", () => {
  it("step inicia em 1 e tem 3 defaults de forbidden zones", async () => {
    const { emptyWizardState } = await import("../src/lib/wizard-types.js");
    const s = emptyWizardState();
    expect(s.step).toBe(1);
    expect(s.forbiddenZones.length).toBe(3);
    expect(s.budget.sacrificeBudgetCap).toBe(100);
    expect(s.consents.storeTrace).toBe(false);
    expect(s.readyForPilot).toBe(false);
  });
});
