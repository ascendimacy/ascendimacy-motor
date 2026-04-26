/**
 * Parse fallback grácil pra output do drota LLM (motor#25 handoff #24 Tarefa 3).
 *
 * Razão: drota output esperado é JSON `{selectionRationale, linguisticMaterialization}`.
 * Quando Kimi/Sonnet abrem com explanation ("Could not generate response in this
 * language..."), JSON.parse direto crasha SyntaxError → turn aborta.
 *
 * Estratégia em camadas:
 * 1. JSON.parse direto — happy path
 * 2. Regex extract `\{[\s\S]*\}` — modelo às vezes prefixa com explanation
 * 3. Hard fallback — retorna {} com skipReason populado, caller decide
 */

export interface DrotaParsed {
  selectionRationale?: string;
  linguisticMaterialization?: string;
}

export interface DrotaParseResult {
  parsed: DrotaParsed;
  /** undefined em happy path; "parse_failure" ou "json_invalid_after_extract" em fallback. */
  skipReason?: string;
}

export function parseDrotaOutput(rawContent: string): DrotaParseResult {
  // 1. Happy path
  try {
    const parsed = JSON.parse(rawContent) as DrotaParsed;
    return { parsed };
  } catch {
    // 2. Regex extract — primeiro objeto JSON-shaped no texto
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as DrotaParsed;
        return { parsed };
      } catch {
        // Regex achou {} mas parse interno falhou (ex: braces desbalanceadas)
        return { parsed: {}, skipReason: "json_invalid_after_extract" };
      }
    }
    // 3. Sem JSON detectável — refusal puro
    return { parsed: {}, skipReason: "parse_failure" };
  }
}
