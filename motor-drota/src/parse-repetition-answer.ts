/**
 * Parse cascata pra resposta da criança ao repetition_inquiry (ops#1068).
 *
 * Estratégia em camadas (sub-decisão 7):
 *  1. Match literal regex case-insensitive
 *     - Letras: \b(a|b|c)\b
 *     - Números: \b(1|2|3)\b → 1=a, 2=b, 3=c
 *     - Linguagem natural:
 *       - "de novo" / "mesm[oa]" / "aquel[ae]" → a
 *       - "parecid[oa]" / "outro parecido" / "similar" → b
 *       - "outro" / "novo" / "diferente" / "mudar" → c
 *  2. LLM intent classifier via mood-extractor — v0.1 follow-up (não nesta PR)
 *  3. Skip default — retorna defaultOnSkip configurado per-persona (default "b")
 *
 * Ordem importa: matches específicos (multi-palavra) ANTES de single-letter
 * pra evitar "casca-do-c" ser pego como (c).
 *
 * Quem chama: motor-execucao após coletar input da criança no turn seguinte
 * ao repetition_inquiry_asked. Resultado vai pro contextHints do próximo
 * planTurn em forma de `last_inquiry_answer: "a"|"b"|"c"`.
 */

export type InquiryChoice = "a" | "b" | "c";

export interface RepetitionAnswerParseResult {
  /** Escolha resolvida. Sempre populada (com default em fallback). */
  choice: InquiryChoice;
  /** Stage que produziu o match. */
  stage: "literal" | "llm" | "default";
  /** Confidence heurística (0-1). Literal=1.0, default=0.0. */
  confidence: number;
}

/** Padrões "categoria b" (parecido). Ordem matters — multi-palavra primeiro. */
const B_PATTERNS = [
  /outro\s+parecid[oa]/i,
  /algo\s+parecid[oa]/i,
  /parecid[oa]/i,
  /similar/i,
  /tipo\s+(esse|isso|aquele)/i,
];

/** Padrões "categoria a" (de novo / tentar mesmo). Ordem matters. */
const A_PATTERNS = [
  /de\s+novo/i,
  /(o|aquel[ae])\s+mesm[oa]/i,
  /aquel[ae]\b/i,
  /repetir/i,
  /tentar\s+(de\s+)?novo/i,
];

/** Padrões "categoria c" (algo novo / diferente). Ordem matters. */
const C_PATTERNS = [
  /algo\s+novo/i,
  /outr[oa]\s+coisa/i,
  /diferente/i,
  /mudar/i,
  /coisa\s+nova/i,
  /\bnovo\b/i, // single-word "novo" — depois dos compostos
  /\boutro\b/i, // single-word "outro" — depois de "outro parecido"
];

/**
 * Parse resposta da criança ao repetition_inquiry.
 *
 * @param rawText - input cru da criança
 * @param defaultOnSkip - default quando texto vazio/ambíguo (per-persona)
 */
export function parseRepetitionAnswer(
  rawText: string,
  defaultOnSkip: InquiryChoice = "b",
): RepetitionAnswerParseResult {
  const trimmed = (rawText ?? "").trim();

  // Empty / silence → default
  if (trimmed.length === 0) {
    return { choice: defaultOnSkip, stage: "default", confidence: 0 };
  }

  // ─── Stage 1: literal regex ─────────────────────────────────────────────
  // Ordem das checagens importa:
  // 1. Padrões multi-palavra específicos (B > A > C — mais raros vencem)
  // 2. Single-letter / single-digit como fallback do stage 1

  for (const pat of B_PATTERNS) {
    if (pat.test(trimmed)) return { choice: "b", stage: "literal", confidence: 1 };
  }
  for (const pat of A_PATTERNS) {
    if (pat.test(trimmed)) return { choice: "a", stage: "literal", confidence: 1 };
  }
  for (const pat of C_PATTERNS) {
    if (pat.test(trimmed)) return { choice: "c", stage: "literal", confidence: 1 };
  }

  // Single-letter / single-digit como resposta isolada. JS \b é ASCII-only,
  // então "açúcar" matcharia \ba\b — defesa: exige que letra/dígito seja o
  // INPUT TODO (com pontuação opcional). Cobre "a", "b)", "c.", "1", "2!"
  // sem matchar dentro de palavras acentuadas.
  const STANDALONE_LETTER = /^[\s]*([abc])[\s.,!?:;)\]]*$/i;
  const STANDALONE_DIGIT = /^[\s]*([123])[\s.,!?:;)\]]*$/;
  const letterMatch = trimmed.match(STANDALONE_LETTER);
  if (letterMatch) {
    const letter = letterMatch[1]!.toLowerCase() as InquiryChoice;
    return { choice: letter, stage: "literal", confidence: 1 };
  }
  const digitMatch = trimmed.match(STANDALONE_DIGIT);
  if (digitMatch) {
    const digit = digitMatch[1]!;
    const mapped: InquiryChoice = digit === "1" ? "a" : digit === "2" ? "b" : "c";
    return { choice: mapped, stage: "literal", confidence: 1 };
  }

  // ─── Stage 2: LLM intent classifier (v0.1 follow-up) ────────────────────
  // Quando ativo, reusa mood-extractor pra classificar intent. Pra v0,
  // pulamos direto pro default.

  // ─── Stage 3: default ───────────────────────────────────────────────────
  // "tanto faz" / "sei lá" / texto ambíguo → respeita default per-persona.
  return { choice: defaultOnSkip, stage: "default", confidence: 0 };
}
