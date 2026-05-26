/**
 * ReplayTurnDetail smoke tests — engine x-ray per turn.
 *
 * Cobre cenários: motor data ausente (não renderiza nada),
 * trace completo (pool + selected + SK events + plan).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/svelte";

afterEach(() => cleanup());
import ReplayTurnDetail from "../../src/components/ReplayTurnDetail.svelte";
import type { ReplayTraceTurn } from "../../src/lib/api.js";

const emptyTurn = (): ReplayTraceTurn => ({
  turnNumber: 1,
});

const richTurn = (): ReplayTraceTurn => ({
  turnNumber: 4,
  trustLevel: 0.42,
  budgetRemaining: 96,
  playbookId: "helix-rapport-v1",
  durationMs: 12345,
  motorTrace: {
    plan: {
      strategicRationale: "explorar autoconhecimento via metáfora natural",
      instruction_addition: "tom suave, evitar conceitos abstratos",
      candidateSetEntropy: 2.41,
      contextHints: { stage: "applied_double_helix" },
      contentPool: [
        {
          item: { id: "bio_caterpillar_dissolve", axis_id: 11 },
          score: 14.5,
          reasons: ["base_score=10", "multidim_bonus=+6", "surprise_bonus=+3"],
        },
        {
          item: { id: "bio_dolphin_names", axis_id: 11 },
          score: 12.0,
          reasons: ["base_score=10", "multidim_bonus=+4"],
        },
        {
          item: { id: "myth_kintsugi_philosophy", axis_id: 3 },
          score: 10.5,
          reasons: ["base_score=10", "surprise_bonus=+1"],
        },
      ],
    },
    drota: {
      selectedContent: {
        item: { id: "bio_caterpillar_dissolve", axis_id: 11 },
        score: 14.5,
        reasons: ["base_score=10"],
      },
      selectionRationale: "highest score + matches casel_focus",
      linguisticMaterialization: "Lagarta quando dissolve...",
    },
    exec: {
      eventLogged: { kind: "presented_concept_logged" },
      success: true,
    },
  },
  subjectKnowledgeEvents: [
    {
      type: "presented_concept",
      payload: { concept_id: "bio_caterpillar_dissolve", axis_id: 11 },
    },
    {
      type: "boundary_event",
      payload: { topic_category: "corpo" },
    },
  ],
});

describe("ReplayTurnDetail", () => {
  it("não renderiza nada quando turn sem motor data", () => {
    const { container } = render(ReplayTurnDetail, { turn: emptyTurn() });
    expect(container.querySelector(".engine-detail")).toBeNull();
  });

  it("renderiza colapsado com badges quando trace tem motor data", () => {
    render(ReplayTurnDetail, { turn: richTurn() });
    expect(screen.getByText(/Engine x-ray/)).toBeDefined();
    expect(screen.getByText(/trust=0\.42/)).toBeDefined();
    expect(screen.getByText(/budget=96/)).toBeDefined();
    expect(screen.getByText("helix-rapport-v1")).toBeDefined();
    expect(screen.getByText(/2 sk/)).toBeDefined();
    expect(screen.getByText(/3 pool/)).toBeDefined();
  });

  it("expande ao clicar e mostra todas as seções", async () => {
    render(ReplayTurnDetail, { turn: richTurn() });
    const toggle = screen.getByTestId("engine-toggle");
    await fireEvent.click(toggle);

    // Plan section
    expect(
      screen.getByText(/explorar autoconhecimento via metáfora natural/),
    ).toBeDefined();
    expect(screen.getByText(/tom suave/)).toBeDefined();
    expect(screen.getByText("2.410")).toBeDefined(); // entropy

    // Pool section
    expect(screen.getByTestId("pool-section")).toBeDefined();
    // bio_caterpillar_dissolve aparece no pool list — pode renderizar 1+ vezes
    // dependendo do estado expand interno
    expect(screen.getAllByText("bio_caterpillar_dissolve").length).toBeGreaterThan(0);
    expect(screen.getByText("bio_dolphin_names")).toBeDefined();
    expect(screen.getByText(/SELECTED/)).toBeDefined();
    expect(screen.getByText(/highest score \+ matches casel_focus/)).toBeDefined();

    // SK section
    expect(screen.getByTestId("sk-section")).toBeDefined();
    expect(screen.getByText("presented_concept")).toBeDefined();
    expect(screen.getByText("boundary_event")).toBeDefined();
  });

  it("destaca o item selected dentro do pool", async () => {
    const { container } = render(ReplayTurnDetail, { turn: richTurn() });
    await fireEvent.click(screen.getByTestId("engine-toggle"));
    const selectedLi = container.querySelector("li.selected");
    expect(selectedLi).not.toBeNull();
    expect(selectedLi?.textContent).toContain("bio_caterpillar_dissolve");
  });

  it("renderiza só badges quando flags do turn presentes mas sem motorTrace", () => {
    const turn: ReplayTraceTurn = {
      turnNumber: 1,
      trustLevel: 0.55,
      budgetRemaining: 80,
      playbookId: "warmup",
    };
    render(ReplayTurnDetail, { turn });
    expect(screen.getByText(/trust=0\.55/)).toBeDefined();
    expect(screen.getByText("warmup")).toBeDefined();
  });

  it("fallback pra subjectKnowledgeEvents em motorTrace.drota (legacy STS)", async () => {
    const turn: ReplayTraceTurn = {
      turnNumber: 2,
      motorTrace: {
        drota: {
          subjectKnowledgeEvents: [
            { type: "interest", payload: { label: "tênis" } },
          ],
        },
      },
    };
    render(ReplayTurnDetail, { turn });
    await fireEvent.click(screen.getByTestId("engine-toggle"));
    expect(screen.getByText("interest")).toBeDefined();
    expect(screen.getByText("tênis")).toBeDefined();
  });

  it("mostra cardEmissionSkipReason quando presente", async () => {
    const turn: ReplayTraceTurn = {
      turnNumber: 3,
      trustLevel: 0.4,
      cardEmissionSkipReason: "trust_below_threshold",
      motorTrace: { plan: { strategicRationale: "x" } },
    };
    render(ReplayTurnDetail, { turn });
    await fireEvent.click(screen.getByTestId("engine-toggle"));
    expect(screen.getByText(/trust_below_threshold/)).toBeDefined();
  });
});
