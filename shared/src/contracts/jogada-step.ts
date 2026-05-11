/**
 * JogadaStep — interface puro funcional para as 5 jogadas de giro
 * (Brota Mestre Core v0.1 §6).
 *
 * S-CT-01-02 do Pre-Sprint Bootstrap (ops#1008). Consumido por
 * CC-Jogadas (capability C-T-10) e CC-Recovery.
 *
 * Contrato:
 *   - Função pura — sem I/O, sem mutação de input, sem dependência
 *     de estado externo. Mesmo input → mesmo output.
 *   - Inputs são tratados como readonly. Implementações devem clonar
 *     antes de modificar se precisarem (uso defensivo).
 *
 * As 5 jogadas (Brota Mestre Core §6):
 *   bridge   — A→C→B (interesse vivo + mediador cultural + virtude destino)
 *   espelho  — espelho de contraste com eixo internalizado
 *   diamante — citação cultural densa para comprimir argumento
 *   arena    — preparação para arena externa que combina o eixo
 *   canal    — usar canal-Gardner forte para traduzir trabalho do eixo
 */

export const JOGADA_TYPES = ["bridge", "espelho", "diamante", "arena", "canal"] as const;
export type JogadaType = (typeof JOGADA_TYPES)[number];

/**
 * Signal observado no turn — input para a jogada. Forma rica (com value
 * + timestamp), distinta de `SemanticSignal` (string literal em
 * shared/src/semantic-signals.ts). A jogada consome ambos: a flag
 * semântica vira `type` e o texto observado vira `value`.
 */
export interface JogadaSignal {
  readonly type: string;
  readonly value: string;
  /** ISO 8601 UTC. */
  readonly ts: string;
}

/**
 * Snapshot do Plano Tático passado para a jogada. O schema completo
 * é tema do próximo sprint (motor/src/plano-tatico/*). Aqui guardamos
 * apenas a identidade mínima — implementações tratam o resto como
 * `unknown` até o schema canônico aterrissar.
 */
export interface PlanoTaticoSnapshot {
  readonly persona_id: string;
  readonly schema_version: string;
  readonly [key: string]: unknown;
}

export interface JogadaInput {
  readonly eixo: string;
  readonly ancora?: string;
  readonly signals: ReadonlyArray<JogadaSignal>;
  readonly planoTatico: PlanoTaticoSnapshot;
}

export interface JogadaOutput {
  readonly type: JogadaType;
  /** Frase pronta para drota.materialize injetar como base. */
  readonly script_proposto: string;
  /** Critérios verificáveis (P4) de sucesso da jogada. */
  readonly validation_criteria: ReadonlyArray<string>;
}

/**
 * JogadaStep — assinatura canônica. Implementações concretas vivem
 * em motor-drota/src/jogadas/* (próximo sprint).
 */
export type JogadaStep = (input: JogadaInput) => JogadaOutput;
