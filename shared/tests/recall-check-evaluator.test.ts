/**
 * Tests RecallCheckEvaluator (spec §4.5 Fase 5).
 */
import { describe, it, expect } from "vitest";
import {
  evaluateRecallCheck,
  classifyRecallResponse,
  type PresentedConceptRef,
  type PriorRecallCheck,
} from "../src/recall-check-evaluator.js";

const NOW = "2026-05-25T12:00:00.000Z";
const OLD = "2026-04-01T12:00:00.000Z"; // ~54 dias atrás

const conceptOld: PresentedConceptRef = {
  concept_id: "metamorfose_lagarta",
  keywords: ["lagarta", "metamorfose", "casulo"],
  lineage_anchor: "zen/shoshin",
  axis_id: 4,
  family: "carater",
  presented_at: OLD,
  session_id: "sess-old",
};

const conceptRecent: PresentedConceptRef = {
  concept_id: "phronesis_recente",
  keywords: ["phronesis", "prudência"],
  lineage_anchor: "aristotelica/phronesis",
  axis_id: 1,
  family: "carater",
  presented_at: NOW,
  session_id: "sess-current",
};

describe("evaluateRecallCheck — gating básico", () => {
  it("budget=0 retorna null mesmo com candidatos", () => {
    const r = evaluateRecallCheck({
      presentedConcepts: [conceptOld],
      priorChecks: [],
      currentSessionId: "sess-current",
      checksInSessionSoFar: 0,
      now: NOW,
      config: { budgetPerSession: 0 },
    });
    expect(r).toBeNull();
  });

  it("budget esgotado retorna null", () => {
    const r = evaluateRecallCheck({
      presentedConcepts: [conceptOld],
      priorChecks: [],
      currentSessionId: "sess-current",
      checksInSessionSoFar: 1,
      now: NOW,
      config: { budgetPerSession: 1 },
    });
    expect(r).toBeNull();
  });

  it("mood baixo (<4) retorna null", () => {
    const r = evaluateRecallCheck({
      presentedConcepts: [conceptOld],
      priorChecks: [],
      currentSessionId: "sess-current",
      checksInSessionSoFar: 0,
      mood: 3,
      now: NOW,
    });
    expect(r).toBeNull();
  });

  it("engagement disengaging retorna null", () => {
    const r = evaluateRecallCheck({
      presentedConcepts: [conceptOld],
      priorChecks: [],
      currentSessionId: "sess-current",
      checksInSessionSoFar: 0,
      engagement: "disengaging",
      now: NOW,
    });
    expect(r).toBeNull();
  });
});

describe("evaluateRecallCheck — scoring heurístico", () => {
  it("conceito antigo + low_internalization passa threshold", () => {
    const r = evaluateRecallCheck({
      presentedConcepts: [conceptOld],
      priorChecks: [],
      currentSessionId: "sess-current",
      checksInSessionSoFar: 0,
      now: NOW,
    });
    expect(r).not.toBeNull();
    expect(r?.concept.concept_id).toBe("metamorfose_lagarta");
    // OLD_CONCEPT_BONUS=5 + LOW_INTERNALIZATION_BONUS=3 = 8 >= 5
    expect(r?.score).toBeGreaterThanOrEqual(5);
  });

  it("conceito recente sem outros bonus → não dispara", () => {
    const r = evaluateRecallCheck({
      presentedConcepts: [conceptRecent],
      priorChecks: [
        // já houve check positivo no mesmo axis → não dispara LOW_INTERNALIZATION
        {
          concept_id_referenced: "outro_axis_1",
          session_id: "sess-other",
          result: "positive",
          checked_at: OLD,
        },
      ],
      currentSessionId: "sess-current",
      checksInSessionSoFar: 0,
      now: NOW,
    });
    expect(r).toBeNull();
  });

  it("lineage adjacente boosta score", () => {
    const r = evaluateRecallCheck({
      presentedConcepts: [conceptOld],
      priorChecks: [],
      currentSessionId: "sess-current",
      checksInSessionSoFar: 0,
      now: NOW,
      currentLineage: "zen/karuna", // mesma tradição zen
    });
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThanOrEqual(15); // 5 + 3 + 10
    expect(r!.suggested_framing).toContain("lembra");
  });

  it("prioriza maior score quando múltiplos candidatos", () => {
    const r = evaluateRecallCheck({
      presentedConcepts: [conceptOld, { ...conceptRecent, presented_at: OLD }],
      priorChecks: [],
      currentSessionId: "sess-current",
      checksInSessionSoFar: 0,
      now: NOW,
      currentLineage: "aristotelica/proairesis", // adjacente a phronesis_recente
    });
    expect(r).not.toBeNull();
    expect(r!.concept.concept_id).toBe("phronesis_recente");
  });
});

describe("evaluateRecallCheck — cooldown", () => {
  it("conceito já checado em sessão recente é pulado", () => {
    const checks: PriorRecallCheck[] = [
      {
        concept_id_referenced: "metamorfose_lagarta",
        session_id: "sess-recent",
        result: "positive",
        checked_at: "2026-05-24T12:00:00.000Z",
      },
    ];
    const r = evaluateRecallCheck({
      presentedConcepts: [conceptOld],
      priorChecks: checks,
      currentSessionId: "sess-current",
      checksInSessionSoFar: 0,
      now: NOW,
    });
    expect(r).toBeNull();
  });
});

describe("evaluateRecallCheck — framing", () => {
  it("framing tem keyword do conceito", () => {
    const r = evaluateRecallCheck({
      presentedConcepts: [conceptOld],
      priorChecks: [],
      currentSessionId: "sess-current",
      checksInSessionSoFar: 0,
      now: NOW,
    });
    expect(r!.suggested_framing.toLowerCase()).toContain("lagarta");
  });
});

describe("classifyRecallResponse", () => {
  it("positive quando keyword + sem negação", () => {
    expect(
      classifyRecallResponse("ah sim aquela lagarta do casulo", [
        "lagarta",
        "casulo",
      ]),
    ).toBe("positive");
  });

  it("positive quando apenas afirmação genérica", () => {
    expect(classifyRecallResponse("sim lembro", ["lagarta"])).toBe("positive");
  });

  it("negative quando 'não lembro'", () => {
    expect(classifyRecallResponse("não lembro disso", ["lagarta"])).toBe(
      "negative",
    );
  });

  it("strong negation 'não lembro' vence keyword mencionada → negative", () => {
    expect(
      classifyRecallResponse("não lembro da lagarta mesmo", ["lagarta"]),
    ).toBe("negative");
  });

  it("keyword + negação simples (não strong) → ambiguous", () => {
    expect(
      classifyRecallResponse("lagarta? nada disso", ["lagarta"]),
    ).toBe("ambiguous");
  });

  it("ambiguous quando resposta neutra", () => {
    expect(classifyRecallResponse("hmm, talvez", ["lagarta"])).toBe(
      "ambiguous",
    );
  });

  it("positive com 'aquela'", () => {
    expect(classifyRecallResponse("aquela ali, sim", ["x"])).toBe("positive");
  });
});
