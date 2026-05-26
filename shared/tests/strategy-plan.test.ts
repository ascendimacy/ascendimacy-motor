/**
 * Tests Strategist + StrategyPlan (PR 3 tracer).
 */
import { describe, it, expect } from "vitest";
import {
  composeStrategyPlan,
  nextPlaybookMove,
  PLAYBOOK_MOVES,
  type StrategyPlan,
  type SubjectKnowledgeEntry,
} from "../src/index.js";

const baseInput = {
  sessionId: "s1",
  subjectId: "ryo",
};

describe("composeStrategyPlan — gating por journey_stage", () => {
  it("retorna null em discovery_only", () => {
    const plan = composeStrategyPlan({
      ...baseInput,
      journeyStage: "discovery_only",
      knowledgeEntries: [],
      subjectProposed: { axes_active: [3], complements_per_axis: { 3: [] } },
    });
    expect(plan).toBeNull();
  });

  it("retorna null em mapping_ready", () => {
    const plan = composeStrategyPlan({
      ...baseInput,
      journeyStage: "mapping_ready",
      knowledgeEntries: [],
      subjectProposed: { axes_active: [3], complements_per_axis: {} },
    });
    expect(plan).toBeNull();
  });

  it("retorna null em applied_double_helix sem subject_proposed", () => {
    const plan = composeStrategyPlan({
      ...baseInput,
      journeyStage: "applied_double_helix",
      knowledgeEntries: [],
    });
    expect(plan).toBeNull();
  });
});

describe("composeStrategyPlan — composição v1", () => {
  it("compõe plan com 1 target_demonstration + 1 playbook move", () => {
    const plan = composeStrategyPlan({
      ...baseInput,
      journeyStage: "applied_double_helix",
      knowledgeEntries: [],
      subjectProposed: {
        axes_active: [3, 7, 11],
        complements_per_axis: { 3: ["andreia"], 7: ["hesed"], 11: ["gnothi_seauton"] },
      },
    });
    expect(plan).not.toBeNull();
    expect(plan!.target_demonstrations).toHaveLength(1);
    expect(plan!.playbook_composition).toHaveLength(1);
    expect(plan!.playbook_composition[0].move_id).toBe("propose_dilemma");
    expect(plan!.playbook_composition[0].phase).toBe("challenge_execute");
  });

  it("target prioriza eixo sem presented_concept anterior (goal=expose)", () => {
    const presented: SubjectKnowledgeEntry = {
      id: "pc-1",
      subject_id: "ryo",
      type: "presented_concept",
      source: "motor_inferred",
      confidence: 1.0,
      confirmed_at: "s0__t2",
      alignment: "unknown",
      payload: {
        kind: "presented_concept",
        concept_id: "old",
        keywords: ["x"],
        lineage_anchor: "estoica/x",
        axis_id: 3,
        family: "carater",
        points: 1,
      },
      turn_ref: "s0__t2",
      session_id: "s0",
      created_at: "2026-05-25",
    };
    const plan = composeStrategyPlan({
      ...baseInput,
      journeyStage: "applied_double_helix",
      knowledgeEntries: [presented],
      subjectProposed: {
        axes_active: [3, 7],
        complements_per_axis: { 3: [], 7: [] },
      },
    });
    expect(plan!.target_demonstrations[0].dimension).toBe("axis_7");
    expect(plan!.target_demonstrations[0].goal).toBe("expose");
  });

  it("fallback consolidate quando todos os eixos já têm presented_concept", () => {
    const presented = (axisId: number, i: number): SubjectKnowledgeEntry => ({
      id: `pc-${i}`,
      subject_id: "ryo",
      type: "presented_concept",
      source: "motor_inferred",
      confidence: 1.0,
      confirmed_at: "s0__t",
      alignment: "unknown",
      payload: {
        kind: "presented_concept",
        concept_id: `x-${i}`,
        keywords: ["x"],
        lineage_anchor: "estoica/x",
        axis_id: axisId,
        family: axisId <= 4 ? "carater" : axisId <= 8 ? "disposicao" : "cognicao_si",
        points: 1,
      },
      turn_ref: "s0__t",
      session_id: "s0",
      created_at: "2026-05-25",
    });
    const plan = composeStrategyPlan({
      ...baseInput,
      journeyStage: "applied_double_helix",
      knowledgeEntries: [presented(3, 1), presented(7, 2)],
      subjectProposed: {
        axes_active: [3, 7],
        complements_per_axis: { 3: [], 7: [] },
      },
    });
    expect(plan!.target_demonstrations[0].goal).toBe("consolidate");
  });

  it("plan inclui fallback_strategy + overall_success_criteria", () => {
    const plan = composeStrategyPlan({
      ...baseInput,
      journeyStage: "applied_double_helix",
      knowledgeEntries: [],
      subjectProposed: { axes_active: [3], complements_per_axis: {} },
    });
    expect(plan!.fallback_strategy).toBeDefined();
    expect(plan!.overall_success_criteria.length).toBeGreaterThan(0);
  });
});

describe("nextPlaybookMove", () => {
  const plan: StrategyPlan = {
    session_id: "s1",
    subject_id: "ryo",
    composed_at: "2026-05-25",
    target_demonstrations: [],
    playbook_composition: [
      {
        move_id: "propose_dilemma",
        phase: "challenge_execute",
        estimated_minutes: 10,
        success_signal: "x",
      },
    ],
    overall_success_criteria: "y",
  };

  it("retorna 1º move quando phase bate e nenhum executado", () => {
    const move = nextPlaybookMove(plan, "challenge_execute", 0);
    expect(move?.move_id).toBe("propose_dilemma");
  });

  it("retorna null quando phase não bate", () => {
    const move = nextPlaybookMove(plan, "ice_breaker", 0);
    expect(move).toBeNull();
  });

  it("retorna null quando moves esgotados", () => {
    const move = nextPlaybookMove(plan, "challenge_execute", 1);
    expect(move).toBeNull();
  });
});

describe("PLAYBOOK_MOVES catálogo v1", () => {
  it("tem 6 moves stub", () => {
    expect(Object.keys(PLAYBOOK_MOVES).length).toBe(6);
  });

  it("propose_dilemma está em challenge_execute", () => {
    expect(PLAYBOOK_MOVES.propose_dilemma.phase).toBe("challenge_execute");
  });

  it("todos os moves têm framing_template + success_signal", () => {
    for (const m of Object.values(PLAYBOOK_MOVES)) {
      expect(m.framing_template.length).toBeGreaterThan(0);
      expect(m.success_signal.length).toBeGreaterThan(0);
    }
  });
});
