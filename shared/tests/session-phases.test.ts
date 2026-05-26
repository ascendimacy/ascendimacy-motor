/**
 * Tests SessionPhase + JourneyStage + SessionStateResolver + threshold.
 * Spec: ascendimacy-ops/docs/specs/2026-05-25-session-phases-journey-stages-strategist.md
 */
import { describe, it, expect } from "vitest";
import {
  resolveSessionState,
  readyForMapping,
  computeDiscoveryMaturity,
  initialJourneyState,
  DEFAULT_SESSION_TIMING,
  READY_FOR_MAPPING_MIN_DISCOVERIES,
  READY_FOR_MAPPING_MIN_FAMILIES,
  type SubjectKnowledgeEntry,
  type JourneyState,
} from "../src/index.js";

const NOW = "2026-05-25T18:00:00.000Z";

describe("resolveSessionState — heurística temporal", () => {
  it("turn 1 (4min) → ice_breaker", () => {
    const r = resolveSessionState({ turn: 1, journeyStage: "discovery_only" });
    expect(r.phase).toBe("ice_breaker");
    expect(r.elapsed_minutes_estimate).toBe(4);
    expect(r.minutes_until_next_phase).toBe(11);
  });

  it("turn 4 (16min) → challenge_execute (sem challenge_explain explícito)", () => {
    const r = resolveSessionState({ turn: 4, journeyStage: "discovery_only" });
    // 16min > ice_end(15) + explain(0) = 15. Entra em execute.
    expect(r.phase).toBe("challenge_execute");
  });

  it("turn 11 (44min) → challenge_execute (limite)", () => {
    const r = resolveSessionState({ turn: 11, journeyStage: "applied_double_helix" });
    expect(r.phase).toBe("challenge_execute");
  });

  it("turn 12 (48min) → follow_up", () => {
    const r = resolveSessionState({ turn: 12, journeyStage: "applied_double_helix" });
    expect(r.phase).toBe("follow_up");
    expect(r.elapsed_minutes_estimate).toBe(48);
  });

  it("avgMinutesPerTurn override altera elapsed", () => {
    const r = resolveSessionState({
      turn: 3,
      avgMinutesPerTurn: 2,
      journeyStage: "discovery_only",
    });
    expect(r.elapsed_minutes_estimate).toBe(6);
    expect(r.phase).toBe("ice_breaker");
  });

  it("elapsedMinutesOverride vence heurística por turn", () => {
    const r = resolveSessionState({
      turn: 1,
      elapsedMinutesOverride: 47,
      journeyStage: "applied_double_helix",
    });
    expect(r.elapsed_minutes_estimate).toBe(47);
    expect(r.phase).toBe("follow_up"); // 47 > 45 = ice+execute
  });

  it("preserva journey_stage no output", () => {
    const r = resolveSessionState({ turn: 1, journeyStage: "applied_double_helix" });
    expect(r.journey_stage).toBe("applied_double_helix");
  });
});

describe("readyForMapping — threshold", () => {
  const baseState: JourneyState = {
    subject_id: "ryo",
    stage: "discovery_only",
    stage_entered_at: NOW,
    discoveries_count: 0,
    families_covered: [],
    last_updated_at: NOW,
  };

  it("false quando count < threshold", () => {
    expect(
      readyForMapping({
        state: {
          ...baseState,
          discoveries_count: READY_FOR_MAPPING_MIN_DISCOVERIES - 1,
          families_covered: ["carater", "disposicao", "cognicao_si"],
        },
      }),
    ).toBe(false);
  });

  it("false quando famílias < threshold", () => {
    expect(
      readyForMapping({
        state: {
          ...baseState,
          discoveries_count: 20,
          families_covered: ["carater", "disposicao"],
        },
      }),
    ).toBe(false);
  });

  it("true quando ambos critérios batem", () => {
    expect(
      readyForMapping({
        state: {
          ...baseState,
          discoveries_count: READY_FOR_MAPPING_MIN_DISCOVERIES,
          families_covered: ["carater", "disposicao", "cognicao_si"],
        },
      }),
    ).toBe(true);
  });

  it("override parental 'mapping_ready' força true", () => {
    expect(
      readyForMapping({
        state: baseState,
        parentOverride: "mapping_ready",
      }),
    ).toBe(true);
  });

  it("override parental 'applied_double_helix' também força true", () => {
    expect(
      readyForMapping({
        state: baseState,
        parentOverride: "applied_double_helix",
      }),
    ).toBe(true);
  });

  it("override parental 'discovery_only' força false mesmo com threshold OK", () => {
    expect(
      readyForMapping({
        state: {
          ...baseState,
          discoveries_count: 100,
          families_covered: ["carater", "disposicao", "cognicao_si"],
        },
        parentOverride: "discovery_only",
      }),
    ).toBe(false);
  });
});

describe("computeDiscoveryMaturity", () => {
  const makeEntry = (
    type: SubjectKnowledgeEntry["type"],
    payload: Record<string, unknown>,
  ): SubjectKnowledgeEntry => ({
    id: `id-${Math.random()}`,
    subject_id: "ryo",
    type,
    source: "self_declared",
    confidence: 0.8,
    confirmed_at: NOW,
    alignment: "unknown",
    payload: { kind: type, ...payload } as SubjectKnowledgeEntry["payload"],
    turn_ref: "s1__t1",
    session_id: "s1",
    created_at: NOW,
  });

  it("count = só interest/value/need/discovery; boundary_event não conta", () => {
    const entries = [
      makeEntry("interest", { label: "tênis" }),
      makeEntry("value", { label: "esforço" }),
      makeEntry("boundary_event", { topic_category: "x", signal_type: "deflection_thematic", intensity: "mid", motor_response: "muda_tema", severity_band: "routine" }),
    ];
    const r = computeDiscoveryMaturity(entries);
    expect(r.discoveries_count).toBe(2);
  });

  it("families_covered dedup + sorted", () => {
    const entries = [
      makeEntry("interest", { label: "x", family: "carater" }),
      makeEntry("interest", { label: "y", family: "disposicao" }),
      makeEntry("value", { label: "z", family: "carater" }), // dup
    ];
    const r = computeDiscoveryMaturity(entries);
    expect(r.families_covered).toEqual(["carater", "disposicao"]);
  });

  it("entries sem family/axis_id não contribuem pra families", () => {
    const entries = [
      makeEntry("interest", { label: "x" }), // sem family
      makeEntry("value", { label: "y" }),
    ];
    const r = computeDiscoveryMaturity(entries);
    expect(r.discoveries_count).toBe(2);
    expect(r.families_covered).toEqual([]);
  });

  it("usa axisToFamilyFn quando payload tem axis_id mas não family", () => {
    const entries = [
      makeEntry("interest", { label: "x", axis_id: 3 }),
    ];
    const r = computeDiscoveryMaturity(entries, (axisId) =>
      axisId >= 1 && axisId <= 4 ? "carater" : "outra",
    );
    expect(r.families_covered).toEqual(["carater"]);
  });
});

describe("initialJourneyState", () => {
  it("começa em discovery_only", () => {
    const s = initialJourneyState("ryo");
    expect(s.subject_id).toBe("ryo");
    expect(s.stage).toBe("discovery_only");
    expect(s.discoveries_count).toBe(0);
    expect(s.families_covered).toEqual([]);
    expect(s.override_by_parent).toBeUndefined();
  });
});

describe("DEFAULT_SESSION_TIMING", () => {
  it("totaliza 50 min", () => {
    const t = DEFAULT_SESSION_TIMING;
    expect(t.ice_breaker_minutes + t.challenge_explain_minutes + t.challenge_execute_minutes + t.follow_up_minutes).toBe(t.total_minutes);
    expect(t.total_minutes).toBe(50);
  });
});

describe("constants integridade", () => {
  it("threshold valores ratificados (10 / 3)", () => {
    expect(READY_FOR_MAPPING_MIN_DISCOVERIES).toBe(10);
    expect(READY_FOR_MAPPING_MIN_FAMILIES).toBe(3);
  });
});
