/**
 * drill-fuzzy-match — re-export from `@ascendimacy/shared`.
 *
 * Função mudou pra shared/src/drill-fuzzy-match.ts pra ser consumida tanto
 * por motor-drota quanto por orchestrator (matching pós-turn da resposta
 * do sujeito ao drill emitido). API e comportamento idênticos — re-export
 * preserva paths de import dos testes existentes.
 */

export {
  matchDrillAnswer,
  normalize,
  type FuzzyMatchResult,
  type FuzzyMatchOpts,
} from "@ascendimacy/shared";
