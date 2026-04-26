/**
 * Tests parseDrotaOutput (motor#25 handoff #24 Tarefa 3).
 */

import { describe, it, expect } from "vitest";
import { parseDrotaOutput } from "../src/parse-output.js";

describe("parseDrotaOutput — happy path", () => {
  it("JSON válido completo", () => {
    const raw = `{"selectionRationale":"hook ling SA","linguisticMaterialization":"Sabia que..."}`;
    const r = parseDrotaOutput(raw);
    expect(r.skipReason).toBeUndefined();
    expect(r.parsed.selectionRationale).toBe("hook ling SA");
    expect(r.parsed.linguisticMaterialization).toBe("Sabia que...");
  });

  it("JSON com whitespace leading", () => {
    const raw = `\n  {"linguisticMaterialization":"oi"}  `;
    const r = parseDrotaOutput(raw);
    expect(r.skipReason).toBeUndefined();
    expect(r.parsed.linguisticMaterialization).toBe("oi");
  });

  it("JSON parcial (só linguisticMaterialization) ainda válido", () => {
    const raw = `{"linguisticMaterialization":"hello"}`;
    const r = parseDrotaOutput(raw);
    expect(r.skipReason).toBeUndefined();
    expect(r.parsed.selectionRationale).toBeUndefined();
    expect(r.parsed.linguisticMaterialization).toBe("hello");
  });
});

describe("parseDrotaOutput — regex extract (Camada 2)", () => {
  it("explanation antes do JSON é extraído via regex", () => {
    const raw = `Sure, here is my response:\n{"selectionRationale":"r","linguisticMaterialization":"m"}`;
    const r = parseDrotaOutput(raw);
    expect(r.skipReason).toBeUndefined();
    expect(r.parsed.linguisticMaterialization).toBe("m");
  });

  it("markdown fence around JSON", () => {
    const raw = '```json\n{"linguisticMaterialization":"hi"}\n```';
    const r = parseDrotaOutput(raw);
    expect(r.skipReason).toBeUndefined();
    expect(r.parsed.linguisticMaterialization).toBe("hi");
  });

  it("trailing text after JSON", () => {
    const raw = `{"linguisticMaterialization":"oi"}\n\nNote: this is the response.`;
    const r = parseDrotaOutput(raw);
    expect(r.skipReason).toBeUndefined();
    expect(r.parsed.linguisticMaterialization).toBe("oi");
  });
});

describe("parseDrotaOutput — hard fallback (Camada 3)", () => {
  it("'Could not generate response' → skipReason=parse_failure", () => {
    const raw = "Could not generate response in this language.";
    const r = parseDrotaOutput(raw);
    expect(r.skipReason).toBe("parse_failure");
    expect(r.parsed).toEqual({});
  });

  it("plain refusal sem JSON → parse_failure", () => {
    const raw = "I cannot help with this request.";
    const r = parseDrotaOutput(raw);
    expect(r.skipReason).toBe("parse_failure");
  });

  it("string vazia → parse_failure", () => {
    const r = parseDrotaOutput("");
    expect(r.skipReason).toBe("parse_failure");
  });

  it("JSON malformado dentro de regex match → json_invalid_after_extract", () => {
    // Regex acha "{...}" mas conteúdo interno é inválido
    const raw = `Note: {invalid json here} more text`;
    const r = parseDrotaOutput(raw);
    expect(r.skipReason).toBe("json_invalid_after_extract");
  });

  it("multiplas {}s — pega primeiro objeto válido se possível", () => {
    // Regex greedy `\{[\s\S]*\}` pega o range mais externo
    const raw = `{"a":1} text {"linguisticMaterialization":"x"}`;
    const r = parseDrotaOutput(raw);
    // Com greedy match, vai pegar tudo do primeiro { ao último } e tentar parsear → falha
    // Comportamento: skipReason populado, parsed vazio
    expect(r.skipReason).toBe("json_invalid_after_extract");
  });
});
