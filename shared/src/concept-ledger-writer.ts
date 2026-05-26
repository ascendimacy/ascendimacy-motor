/**
 * ConceptLedgerWriter — emite presented_concept (+1pt) quando motor
 * materializa um Fact ancorado em eixo/lineage.
 *
 * Spec: 2026-05-25-subject-knowledge-bridge.md §4.4.
 *
 * Pure function: recebe content_item + context → SubjectKnowledgeEntry | null.
 * Retorna null quando item não tem os 4 campos necessários (axis_id, family,
 * lineage_anchor, extracted_keywords) — items legados sem tags simplesmente
 * não contribuem pro ledger (zero side-effect).
 */

import type { ContentItem } from "./content-item.js";
import type { SubjectKnowledgeEntry } from "./subject-knowledge.js";

export interface ConceptLedgerWriterInput {
  subjectId: string;
  sessionId: string;
  turnRef: string;
  item: ContentItem;
  /**
   * PR 2 tracer — fase atual da sessão. Quando = "ice_breaker",
   * writer retorna null automaticamente (ledger NÃO acumula durante
   * quebra-gelo; presented_concept é instrumento de internalization
   * pedagógica, não de descoberta).
   *
   * Outras fases não bloqueiam. Default (undefined): comportamento
   * backcompat — emite sempre que item está taggeado.
   */
  sessionPhase?: "ice_breaker" | "challenge_explain" | "challenge_execute" | "follow_up";
}

/**
 * Tenta emitir presented_concept (+1pt). Retorna null se item não tem
 * as 4 tags necessárias — Fase 3 não força backfill mecânico em items
 * existentes, então a maioria dos items continua sem entry (esperado).
 *
 * Quando todos os campos estão presentes:
 *   - concept_id = item.id (assumimos único cross-catalog)
 *   - keywords = item.extracted_keywords
 *   - lineage_anchor = item.lineage_anchor
 *   - axis_id = item.axis_id
 *   - family = item.family
 *   - points = 1 (fixo na v1)
 */
export function extractPresentedConcept(
  input: ConceptLedgerWriterInput,
): SubjectKnowledgeEntry | null {
  // PR 2: gate por fase — ice_breaker NÃO acumula ledger
  if (input.sessionPhase === "ice_breaker") return null;

  const { item } = input;
  if (
    typeof item.axis_id !== "number" ||
    item.axis_id < 1 ||
    item.axis_id > 12
  )
    return null;
  if (
    item.family !== "carater" &&
    item.family !== "disposicao" &&
    item.family !== "cognicao_si"
  )
    return null;
  if (typeof item.lineage_anchor !== "string" || item.lineage_anchor.length === 0)
    return null;
  if (
    !Array.isArray(item.extracted_keywords) ||
    item.extracted_keywords.length === 0
  )
    return null;

  return {
    id: `sk-pc-${input.subjectId}-${input.turnRef}-${item.id}`,
    subject_id: input.subjectId,
    type: "presented_concept",
    source: "motor_inferred",
    confidence: 1.0,
    confirmed_at: input.turnRef,
    alignment: "unknown",
    payload: {
      kind: "presented_concept",
      concept_id: item.id,
      keywords: item.extracted_keywords,
      lineage_anchor: item.lineage_anchor,
      axis_id: item.axis_id,
      family: item.family,
      points: 1,
    },
    turn_ref: input.turnRef,
    session_id: input.sessionId,
    created_at: new Date().toISOString(),
  };
}

/**
 * Helper para uso direto no pipeline: retorna array (vazio ou unitário)
 * pra concatenar com outros eventos do turn sem branching no caller.
 */
export function extractPresentedConcepts(
  input: ConceptLedgerWriterInput,
): SubjectKnowledgeEntry[] {
  const entry = extractPresentedConcept(input);
  return entry ? [entry] : [];
}
