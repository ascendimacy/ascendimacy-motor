/**
 * Tests TV2-1 — engine-trace-v2 schema + helpers.
 *
 * Spec ops#1136 §2. Foundation only; sub-fase TV2-2+ usa esses tipos
 * pra capturar telemetria real do motor.
 */
import { describe, it, expect } from "vitest";
import {
  EngineTraceV2Schema,
  ENGINE_TRACE_SCHEMA_VERSION,
  createEmptyEngineTrace,
  parseEngineTraceV2,
  computeStateDiff,
  type EngineStateSnapshot,
  type EngineTraceV2,
} from "../src/engine-trace-v2.js";

const NOW = "2026-05-26T15:00:00Z";
const LATER = "2026-05-26T15:00:30Z";

const minimalSnapshot = (
  overrides: Partial<EngineStateSnapshot> = {},
): EngineStateSnapshot => ({
  trust_level: 0.5,
  budget_remaining: 100,
  ...overrides,
});

describe("createEmptyEngineTrace", () => {
  it("retorna estrutura válida segundo schema", () => {
    const t = createEmptyEngineTrace({
      turn_started_at: NOW,
      pre_state: minimalSnapshot(),
    });
    const parsed = EngineTraceV2Schema.safeParse(t);
    expect(parsed.success).toBe(true);
    expect(t.schema_version).toBe(ENGINE_TRACE_SCHEMA_VERSION);
    expect(t.llm_calls).toEqual([]);
    expect(t.subject_knowledge_writes).toEqual([]);
    expect(t.warnings).toEqual([]);
    expect(t.components).toEqual({});
  });

  it("post_state inicializa = pre_state (sentinel pre-finalize)", () => {
    const pre = minimalSnapshot({ trust_level: 0.42 });
    const t = createEmptyEngineTrace({ turn_started_at: NOW, pre_state: pre });
    expect(t.post_state).toEqual(pre);
    expect(t.state_diff.trust_delta).toBe(0);
  });
});

describe("EngineTraceV2Schema", () => {
  it("aceita trace completo realista", () => {
    const trace: EngineTraceV2 = {
      schema_version: 2,
      turn_started_at: NOW,
      turn_completed_at: LATER,
      pre_state: minimalSnapshot({
        journey_state: {
          stage: "discovery_only",
          discoveries_count: 3,
          families_covered: ["carater"],
        },
        trust_level: 0.4,
      }),
      post_state: minimalSnapshot({
        journey_state: {
          stage: "mapping_ready",
          discoveries_count: 5,
          families_covered: ["carater", "disposicao"],
        },
        trust_level: 0.45,
        budget_remaining: 95,
      }),
      state_diff: {
        subject_knowledge_added_count: 2,
        trust_delta: 0.05,
        budget_delta: -5,
        journey_stage_transition: {
          from: "discovery_only",
          to: "mapping_ready",
          trigger: "discoveries_threshold",
        },
      },
      components: {
        unified_assessor: {
          inputs: { user_message: "tipo, jogando..." },
          outputs: { mood: 7, signals: ["positive_engagement"], engagement: "medium" },
          mood_method: "rule",
          duration_ms: 12,
        },
        constrained_materializer: {
          inputs: {
            selected_item_id: "bio_caterpillar_dissolve",
            instruction_addition: "tom suave",
            user_message: "tipo, jogando...",
          },
          stable_prefix_hash: "sha256:abc",
          user_message_constructed: "User: tipo, jogando...",
          outputs: {
            raw_response: "<frame>Lagarta...</frame>",
            final_text: "Lagarta quando dissolve...",
          },
          llm_call_ref: "llm-2",
          duration_ms: 2890,
        },
      },
      llm_calls: [
        {
          id: "llm-1",
          role: "assessor",
          provider: "local",
          model: "qwen14b",
          prompt: "Classify mood + signals from: tipo, jogando...",
          response: '{"mood":7,"signals":["positive_engagement"]}',
          duration_ms: 1200,
          input_tokens: 145,
          output_tokens: 32,
        },
        {
          id: "llm-2",
          role: "materializer",
          provider: "local",
          model: "qwen14b",
          prompt: "[stable prefix]\nUser: tipo, jogando...",
          response: "<frame>Lagarta...</frame>",
          duration_ms: 2890,
          prompt_cache_hit: true,
        },
      ],
      subject_knowledge_writes: [
        {
          type: "presented_concept",
          payload: { concept_id: "bio_caterpillar_dissolve", axis_id: 11 },
          writer: "concept_ledger",
          triggered_by: "materializer_emit",
        },
      ],
      warnings: [],
    };
    const r = EngineTraceV2Schema.safeParse(trace);
    expect(r.success).toBe(true);
  });

  it("rejeita schema_version diferente de 2", () => {
    const t = createEmptyEngineTrace({
      turn_started_at: NOW,
      pre_state: minimalSnapshot(),
    });
    const bad = { ...t, schema_version: 1 } as unknown;
    expect(EngineTraceV2Schema.safeParse(bad).success).toBe(false);
  });

  it("rejeita LLM call sem provider", () => {
    const t = createEmptyEngineTrace({
      turn_started_at: NOW,
      pre_state: minimalSnapshot(),
    });
    t.llm_calls.push({
      // @ts-expect-error — provider faltando intencional
      id: "x",
      role: "assessor",
      model: "qwen14b",
      prompt: "x",
      response: "y",
      duration_ms: 100,
    });
    expect(EngineTraceV2Schema.safeParse(t).success).toBe(false);
  });

  it("rejeita warning sem recoverable=true", () => {
    const t = createEmptyEngineTrace({
      turn_started_at: NOW,
      pre_state: minimalSnapshot(),
    });
    // @ts-expect-error — recoverable false não permitido
    t.warnings.push({ component: "x", message: "y", recoverable: false });
    expect(EngineTraceV2Schema.safeParse(t).success).toBe(false);
  });

  it("aceita components todos ausentes (turn que não passou pipeline)", () => {
    const t = createEmptyEngineTrace({
      turn_started_at: NOW,
      pre_state: minimalSnapshot(),
    });
    expect(EngineTraceV2Schema.safeParse(t).success).toBe(true);
  });
});

describe("parseEngineTraceV2", () => {
  it("retorna trace parseado em JSON válido", () => {
    const t = createEmptyEngineTrace({
      turn_started_at: NOW,
      pre_state: minimalSnapshot(),
    });
    const json = JSON.parse(JSON.stringify(t));
    const parsed = parseEngineTraceV2(json);
    expect(parsed).not.toBeNull();
    expect(parsed?.schema_version).toBe(2);
  });

  it("retorna null em JSON inválido", () => {
    expect(parseEngineTraceV2({ foo: "bar" })).toBeNull();
    expect(parseEngineTraceV2(null)).toBeNull();
    expect(parseEngineTraceV2("string")).toBeNull();
  });
});

describe("computeStateDiff", () => {
  it("captura trust + budget deltas", () => {
    const pre = minimalSnapshot({ trust_level: 0.4, budget_remaining: 100 });
    const post = minimalSnapshot({ trust_level: 0.5, budget_remaining: 92 });
    const diff = computeStateDiff(pre, post, 0);
    expect(diff.trust_delta).toBeCloseTo(0.1, 5);
    expect(diff.budget_delta).toBe(-8);
    expect(diff.subject_knowledge_added_count).toBe(0);
  });

  it("detecta journey_stage_transition", () => {
    const pre = minimalSnapshot({
      journey_state: {
        stage: "discovery_only",
        discoveries_count: 4,
        families_covered: [],
      },
    });
    const post = minimalSnapshot({
      journey_state: {
        stage: "mapping_ready",
        discoveries_count: 5,
        families_covered: ["carater"],
      },
    });
    const diff = computeStateDiff(pre, post, 1);
    expect(diff.journey_stage_transition).toEqual({
      from: "discovery_only",
      to: "mapping_ready",
      trigger: "auto",
    });
  });

  it("sem journey transition quando stage igual", () => {
    const pre = minimalSnapshot({
      journey_state: {
        stage: "mapping_ready",
        discoveries_count: 5,
        families_covered: [],
      },
    });
    const post = minimalSnapshot({
      journey_state: {
        stage: "mapping_ready",
        discoveries_count: 6,
        families_covered: [],
      },
    });
    const diff = computeStateDiff(pre, post, 1);
    expect(diff.journey_stage_transition).toBeUndefined();
  });

  it("detecta helix dimension change", () => {
    const pre = minimalSnapshot({
      helix_state: {
        activeDimension: "SA",
        activeLevel: 2,
        cycleDay: 3,
        progress: 0.4,
      },
    });
    const post = minimalSnapshot({
      helix_state: {
        activeDimension: "SM",
        activeLevel: 2,
        cycleDay: 4,
        progress: 0.5,
      },
    });
    const diff = computeStateDiff(pre, post, 0);
    expect(diff.helix_advance?.dimension_changed).toBe(true);
    expect(diff.helix_advance?.level_changed).toBeUndefined();
  });

  it("detecta session_phase_transition", () => {
    const pre = minimalSnapshot({ current_session_phase: "ice_breaker" });
    const post = minimalSnapshot({ current_session_phase: "challenge_explain" });
    const diff = computeStateDiff(pre, post, 0);
    expect(diff.session_phase_transition).toEqual({
      from: "ice_breaker",
      to: "challenge_explain",
    });
  });
});
