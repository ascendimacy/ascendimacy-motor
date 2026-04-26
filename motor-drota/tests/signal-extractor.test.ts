/**
 * Tests Signal Extractor parser (motor#25). Tests do extractor real (LLM call)
 * são integration — aqui só o parser que é função pura.
 */

import { describe, it, expect } from "vitest";
import { parseExtractorResponse } from "../src/signal-extractor.js";

describe("parseExtractorResponse — happy path", () => {
  it("JSON válido com signals array", () => {
    const raw = `{"signals":["philosophical_self_acceptance","mood_drift_up"],"overall_confidence":0.8}`;
    const r = parseExtractorResponse(raw);
    expect(r.signals).toEqual(["philosophical_self_acceptance", "mood_drift_up"]);
    expect(r.overall_confidence).toBe(0.8);
  });

  it("filtra signals inválidos da lista", () => {
    const raw = `{"signals":["philosophical_self_acceptance","invalid_signal","frame_rejection"]}`;
    const r = parseExtractorResponse(raw);
    expect(r.signals).toEqual(["philosophical_self_acceptance", "frame_rejection"]);
  });

  it("captura evidence map quando presente", () => {
    const raw = `{"signals":["frame_rejection"],"evidence":{"frame_rejection":"trecho..."}}`;
    const r = parseExtractorResponse(raw);
    expect(r.evidence?.frame_rejection).toBe("trecho...");
  });

  it("evidence keys inválidas filtradas", () => {
    const raw = `{"signals":["frame_rejection"],"evidence":{"frame_rejection":"a","invalid_key":"b"}}`;
    const r = parseExtractorResponse(raw);
    expect(Object.keys(r.evidence ?? {})).toEqual(["frame_rejection"]);
  });

  it("signals vazio quando nenhum signal claro", () => {
    const raw = `{"signals":[],"overall_confidence":0}`;
    const r = parseExtractorResponse(raw);
    expect(r.signals).toEqual([]);
    expect(r.overall_confidence).toBe(0);
  });
});

describe("parseExtractorResponse — fallbacks", () => {
  it("regex extract quando explanation antes do JSON", () => {
    const raw = `Sure, my analysis:\n{"signals":["meta_cognitive_observation"]}`;
    const r = parseExtractorResponse(raw);
    expect(r.signals).toEqual(["meta_cognitive_observation"]);
  });

  it("retorna {signals:[]} quando JSON malformado", () => {
    const raw = `not json at all`;
    const r = parseExtractorResponse(raw);
    expect(r.signals).toEqual([]);
    expect(r.overall_confidence).toBe(0);
  });

  it("retorna {signals:[]} quando JSON sem array signals", () => {
    const raw = `{"foo":"bar"}`;
    const r = parseExtractorResponse(raw);
    expect(r.signals).toEqual([]);
  });

  it("retorna {signals:[]} string vazia", () => {
    expect(parseExtractorResponse("").signals).toEqual([]);
  });
});
