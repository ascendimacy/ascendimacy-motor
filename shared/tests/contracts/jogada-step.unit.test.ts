import { describe, expect, it } from "vitest";

import {
  JOGADA_TYPES,
  type JogadaInput,
  type JogadaOutput,
  type JogadaStep,
  type JogadaType,
} from "../../src/contracts/index.js";

describe("JogadaType — exhaustiveness", () => {
  it("contains exactly the 5 canonical jogadas (Brota Mestre Core §6)", () => {
    const expected: ReadonlySet<JogadaType> = new Set([
      "bridge",
      "espelho",
      "diamante",
      "arena",
      "canal",
    ]);
    expect(new Set(JOGADA_TYPES)).toEqual(expected);
    expect(JOGADA_TYPES.length).toBe(5);
  });
});

describe("JogadaStep — pure functional interface", () => {
  const referenceNoopJogada: JogadaStep = (input) => ({
    type: "bridge",
    script_proposto: `noop for ${input.eixo}`,
    validation_criteria: [`treinador reconhece eixo ${input.eixo}`],
  });

  const sampleInput: JogadaInput = Object.freeze({
    eixo: "eixo-coragem-para-agir",
    ancora: "eixo-curiosidade-aberta",
    signals: Object.freeze([
      Object.freeze({
        type: "deflection_thematic",
        value: "queria falar de outra coisa",
        ts: "2026-05-11T10:30:00.000Z",
      }),
    ]),
    planoTatico: Object.freeze({
      persona_id: "ryo-ochiai-2026",
      schema_version: "v0.1",
    }),
  }) as JogadaInput;

  it("produces output conforming to JogadaOutput shape", () => {
    const out: JogadaOutput = referenceNoopJogada(sampleInput);
    expect(JOGADA_TYPES).toContain(out.type);
    expect(typeof out.script_proposto).toBe("string");
    expect(Array.isArray(out.validation_criteria)).toBe(true);
    expect(out.validation_criteria.length).toBeGreaterThan(0);
  });

  it("does not mutate its input (pure)", () => {
    const before = JSON.parse(JSON.stringify(sampleInput));
    referenceNoopJogada(sampleInput);
    expect(sampleInput).toEqual(before);
  });

  it("is referentially transparent — same input → same output", () => {
    const a = referenceNoopJogada(sampleInput);
    const b = referenceNoopJogada(sampleInput);
    expect(a).toEqual(b);
  });
});
