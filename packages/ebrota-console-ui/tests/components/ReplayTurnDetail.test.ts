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

  // ─── TV2-6: v2 engine trace coverage ─────────────────────────────────
  // Quando turn.engineTrace presente, render v2 sections; v1 fica como
  // fallback. Quando ambos presentes, v2 vem primeiro + nota de coexistência.

  it("[v2] engineTrace ausente → v1 motorTrace continua renderizando (regressão)", async () => {
    render(ReplayTurnDetail, { turn: richTurn() });
    await fireEvent.click(screen.getByTestId("engine-toggle"));
    // v2 section NÃO aparece quando engineTrace ausente
    expect(screen.queryByTestId("v2-section")).toBeNull();
    expect(screen.queryByTestId("v2-badge")).toBeNull();
    // v1 sections continuam funcionando
    expect(screen.getByTestId("pool-section")).toBeDefined();
    expect(screen.getByTestId("sk-section")).toBeDefined();
  });

  it("[v2] engineTrace presente → renderiza state_diff badges, components by name, sk_writes e warnings", async () => {
    const turn: ReplayTraceTurn = {
      turnNumber: 5,
      trustLevel: 0.5,
      engineTrace: {
        schema_version: 2,
        turn_started_at: "2026-05-26T15:00:00Z",
        turn_completed_at: "2026-05-26T15:00:08Z",
        state_diff: {
          trust_delta: 0.08,
          budget_delta: -3,
          subject_knowledge_added_count: 2,
          journey_stage_transition: {
            from: "discovery_only",
            to: "mapping_ready",
            trigger: "auto",
          },
          helix_advance: { level_changed: true },
          session_phase_transition: {
            from: "ice_breaker",
            to: "challenge_explain",
          },
        },
        components: {
          unified_assessor: {
            outputs: { mood: 0.72, signals: ["curious", "open"], engagement: "high" },
            mood_method: "rule",
            duration_ms: 12,
          },
          planejador: {
            outputs: {
              strategicRationale: "ancorar em metáfora natural",
              candidateSetEntropy: 1.85,
            },
            triageDecision: { route: "drota", reason: "no_parental_signal" },
            duration_ms: 1450,
          },
          strategist: {
            inputs: { journey_stage: "mapping_ready" },
            outputs: {
              target_demonstrations: [{ id: "demo1" }, { id: "demo2" }, { id: "demo3" }],
              playbook_composition: [],
            },
            composition_method: "template_v1",
            duration_ms: 8,
          },
          pragmatic_selector: {
            inputs: { pool_size: 5, mood: 0.72 },
            filters_applied: [
              {
                name: "mood_gate",
                items_removed: ["heavy_item_a"],
                reason: "mood>0.5 prunes heavy",
              },
            ],
            outputs: { selected_id: "bio_caterpillar_dissolve", pool_remaining: [] },
            duration_ms: 3,
          },
          constrained_materializer: {
            inputs: {
              selected_item_id: "bio_caterpillar_dissolve",
              user_message: "...",
            },
            stable_prefix_hash: "sha256:abc12345",
            user_message_constructed: "...",
            outputs: { raw_response: "...", final_text: "..." },
            llm_call_ref: "llm-call-001",
            duration_ms: 8200,
          },
        },
        llm_calls: [],
        subject_knowledge_writes: [
          {
            type: "discovery",
            payload: { label: "interesse: lagartas" },
            writer: "discovery",
            triggered_by: "unified_assessor.signals",
          },
          {
            type: "presented_concept",
            payload: { concept_id: "bio_caterpillar_dissolve" },
            writer: "concept_ledger",
            triggered_by: "constrained_materializer.execute",
          },
        ],
        warnings: [
          {
            component: "strategist",
            message: "no current_objectives — falling back to default",
            recoverable: true,
          },
        ],
      },
    };
    render(ReplayTurnDetail, { turn });

    // v2 badge no toggle
    expect(screen.getByTestId("v2-badge")).toBeDefined();

    await fireEvent.click(screen.getByTestId("engine-toggle"));

    // v2 section + state diff
    expect(screen.getByTestId("v2-section")).toBeDefined();
    expect(screen.getByTestId("v2-state-diff")).toBeDefined();
    expect(screen.getByTestId("v2-trust-delta")).toBeDefined();
    expect(screen.getByTestId("v2-budget-delta")).toBeDefined();
    expect(screen.getByTestId("v2-journey-transition")).toBeDefined();
    expect(screen.getByTestId("v2-helix-advance")).toBeDefined();
    expect(screen.getByTestId("v2-phase-transition")).toBeDefined();
    expect(screen.getByTestId("v2-sk-added")).toBeDefined();

    // Components present
    expect(screen.getByTestId("v2-comp-assessor")).toBeDefined();
    expect(screen.getByTestId("v2-comp-planejador")).toBeDefined();
    expect(screen.getByTestId("v2-comp-strategist")).toBeDefined();
    expect(screen.getByTestId("v2-comp-selector")).toBeDefined();
    expect(screen.getByTestId("v2-comp-materializer")).toBeDefined();

    // Subject Knowledge writes show writer + triggered_by
    const skWrites = screen.getByTestId("v2-sk-writes");
    expect(skWrites).toBeDefined();
    expect(skWrites.textContent).toContain("discovery");
    expect(skWrites.textContent).toContain("concept_ledger");
    expect(skWrites.textContent).toContain("unified_assessor.signals");

    // Warnings
    expect(screen.getByTestId("v2-warnings")).toBeDefined();
    expect(screen.getByText(/no current_objectives/)).toBeDefined();
  });

  it("[v2] subset de components (só assessor) → outras sections omitidas", async () => {
    const turn: ReplayTraceTurn = {
      turnNumber: 6,
      engineTrace: {
        schema_version: 2,
        turn_started_at: "2026-05-26T15:00:00Z",
        turn_completed_at: "2026-05-26T15:00:01Z",
        state_diff: {
          trust_delta: 0,
          budget_delta: 0,
          subject_knowledge_added_count: 0,
        },
        components: {
          unified_assessor: {
            outputs: { mood: 0.3, signals: [], engagement: "low" },
            mood_method: "fallback",
            duration_ms: 5,
          },
        },
        llm_calls: [],
        subject_knowledge_writes: [],
        warnings: [],
      },
    };
    render(ReplayTurnDetail, { turn });
    await fireEvent.click(screen.getByTestId("engine-toggle"));

    expect(screen.getByTestId("v2-comp-assessor")).toBeDefined();
    expect(screen.queryByTestId("v2-comp-planejador")).toBeNull();
    expect(screen.queryByTestId("v2-comp-strategist")).toBeNull();
    expect(screen.queryByTestId("v2-comp-selector")).toBeNull();
    expect(screen.queryByTestId("v2-comp-materializer")).toBeNull();
    expect(screen.queryByTestId("v2-sk-writes")).toBeNull();
    expect(screen.queryByTestId("v2-warnings")).toBeNull();
    // Sem journey/helix/phase transitions, badges desses não aparecem
    expect(screen.queryByTestId("v2-journey-transition")).toBeNull();
    expect(screen.queryByTestId("v2-helix-advance")).toBeNull();
  });

  it("[v2] engineTrace + motorTrace ambos presentes → v2 vem primeiro + nota de coexistência", async () => {
    const v1 = richTurn();
    const turn: ReplayTraceTurn = {
      ...v1,
      engineTrace: {
        schema_version: 2,
        turn_started_at: "2026-05-26T15:00:00Z",
        turn_completed_at: "2026-05-26T15:00:02Z",
        state_diff: {
          trust_delta: 0.02,
          budget_delta: -1,
          subject_knowledge_added_count: 0,
        },
        components: {
          unified_assessor: {
            outputs: { mood: 0.5, signals: ["x"], engagement: "medium" },
            mood_method: "llm",
            duration_ms: 100,
          },
        },
        llm_calls: [],
        subject_knowledge_writes: [],
        warnings: [],
      },
    };
    const { container } = render(ReplayTurnDetail, { turn });
    await fireEvent.click(screen.getByTestId("engine-toggle"));

    expect(screen.getByTestId("v2-section")).toBeDefined();
    expect(screen.getByTestId("v2-coexist-note")).toBeDefined();
    // v1 sections still rendered abaixo
    expect(screen.getByTestId("pool-section")).toBeDefined();

    // Ordem DOM: v2 vem antes de v1 pool-section
    const v2 = screen.getByTestId("v2-section");
    const pool = screen.getByTestId("pool-section");
    const positionRel = v2.compareDocumentPosition(pool);
    // DOCUMENT_POSITION_FOLLOWING = 4
    expect(positionRel & 4).toBe(4);

    // Sanidade — extra para garantir que renderizou todo o trace
    expect(container.querySelectorAll(".v2-comp").length).toBeGreaterThan(0);
  });
});
