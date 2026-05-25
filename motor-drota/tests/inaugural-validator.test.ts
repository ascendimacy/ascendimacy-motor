/**
 * Tests do validateInauguralOutput (spec 2026-05-25 Fase 3).
 * Princípio "pergunta aberta abre cada sessão".
 */
import { describe, it, expect } from "vitest";
import {
  resolveInauguralTemplate,
  validateInauguralOutput,
  InauguralValidationError,
  type InauguralResolveOutput,
} from "../src/inaugural-template.js";

describe("resolveInauguralTemplate inclui discovery_question", () => {
  it("session 1 universal (sem profile) traz discovery_question default", () => {
    const out = resolveInauguralTemplate({
      child: { name: "Ryo" },
      sessionNumber: 1,
    });
    expect(out.discovery_question).not.toBeNull();
    expect(out.discovery_question?.text.length).toBeGreaterThan(0);
    expect(out.discovery_question?.intent).toBe("interest");
  });

  it("session recorrente discovery_question = null (motor decide dinâmico)", () => {
    const out = resolveInauguralTemplate({
      child: { name: "Ryo" },
      sessionNumber: 3,
    });
    expect(out.discovery_question).toBeNull();
  });

  it("cultural profile pode override discovery_question text", () => {
    const out = resolveInauguralTemplate({
      culturalDefault: {
        language: "ja",
        inaugural: {
          greeting: "こんにちは",
          purpose: "p",
          non_evaluation_clause: "n",
          exit_right: "e",
          discovery_question: "今、何が頭にある?",
        },
      },
      child: { name: "Ryo" },
      sessionNumber: 1,
    });
    expect(out.discovery_question?.text).toBe("今、何が頭にある?");
  });

  it("voice profile pode override intent", () => {
    const out = resolveInauguralTemplate({
      voiceProfile: {
        inaugural: {
          discovery_question_intent: "feeling",
        },
      },
      child: { name: "Ryo" },
      sessionNumber: 1,
    });
    expect(out.discovery_question?.intent).toBe("feeling");
  });

  it("invalid intent default volta pra 'interest'", () => {
    const out = resolveInauguralTemplate({
      voiceProfile: {
        inaugural: { discovery_question_intent: "garbage" },
      },
      child: { name: "Ryo" },
      sessionNumber: 1,
    });
    expect(out.discovery_question?.intent).toBe("interest");
  });
});

describe("validateInauguralOutput — princípio P3", () => {
  const validBase: InauguralResolveOutput = {
    text: "Oi, Ryo. ...",
    template_used: "inaugural_universal_fallback",
    non_evaluation_clause_present: true,
    exit_right_present: true,
    cascade_source: "universal",
    discovery_question: {
      text: "Tem alguma coisa te interessando?",
      intent: "interest",
      expected_signal_categories: ["interest_marker"],
    },
  };

  it("passa pra output válido", () => {
    expect(() => validateInauguralOutput(validBase)).not.toThrow();
  });

  it("falha quando discovery_question é null em sessão 1", () => {
    const bad: InauguralResolveOutput = { ...validBase, discovery_question: null };
    expect(() => validateInauguralOutput(bad)).toThrow(InauguralValidationError);
    expect(() => validateInauguralOutput(bad)).toThrow(/discovery_question ausente/);
  });

  it("falha quando discovery_question.text é vazio", () => {
    const bad: InauguralResolveOutput = {
      ...validBase,
      discovery_question: { ...validBase.discovery_question!, text: "   " },
    };
    expect(() => validateInauguralOutput(bad)).toThrow(/text vazio/);
  });

  it("falha quando non_evaluation_clause ausente", () => {
    const bad: InauguralResolveOutput = { ...validBase, non_evaluation_clause_present: false };
    expect(() => validateInauguralOutput(bad)).toThrow(/non_evaluation_clause/);
  });

  it("falha quando exit_right ausente", () => {
    const bad: InauguralResolveOutput = { ...validBase, exit_right_present: false };
    expect(() => validateInauguralOutput(bad)).toThrow(/exit_right/);
  });

  it("sessão recorrente é exceção — não exige discovery_question", () => {
    const recorrente: InauguralResolveOutput = {
      text: "Olá de novo, Ryo. Pegando de onde paramos?",
      template_used: "inaugural_recorrente",
      non_evaluation_clause_present: false,
      exit_right_present: false,
      cascade_source: "universal",
      discovery_question: null,
    };
    expect(() => validateInauguralOutput(recorrente)).not.toThrow();
  });

  it("output do resolver real passa no validador (smoke)", () => {
    const out = resolveInauguralTemplate({
      child: { name: "Ryo" },
      sessionNumber: 1,
    });
    expect(() => validateInauguralOutput(out)).not.toThrow();
  });
});
