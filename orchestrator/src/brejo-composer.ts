/**
 * BrejoSignal composer — caller-side helper (ops#1092, follow-up motor#129).
 *
 * Compõe `BrejoSignal[]` pra alimentar `decideBrejoPause` / `decideNextSpeaker`
 * a partir de:
 *   - `statusMatrix` per persona (dimension → "brejo"|"baia"|"pasto")
 *   - `participant.regulation_strategy` (declarado no persona profile)
 *
 * Regra (CC default ratify Jun ops#1092):
 *   1. `statusMatrix.emotional === "brejo"` → emite `{ type: "emotional" }`.
 *      Override §11.4 doctrine: qualquer participant em brejo emocional → full pause.
 *
 *   2. participant com `regulation_strategy === "sensory"` E **alguma** dimensão
 *      sensorial-leaning em brejo → emite `{ type: "sensory" }`. v1 trata
 *      `social_with_sibling === "brejo"` como sensory-proxy (Saki ASD-1: conflito
 *      sensorial frequentemente surge como ruído social-irmão). Doctrine §11.4
 *      Saki entry — partial pause path.
 *
 *   3. Sem brejo em nenhum dim → sem signal.
 *
 * Pure function — sem IO, sem persistência. Caller mantém o map per-persona.
 *
 * Doctrine cross-ref:
 *   ascendimacy-ops/docs/fundamentos/ebrota-kids-dinamicas-grupo.md §11.4
 *   ascendimacy-ops/docs/playbooks/kids.group.playbook.yaml (brejo_pause_policy_trio)
 */

import type { BrejoSignal, TrioParticipant } from "@ascendimacy/shared";
import type { StatusMatrix } from "@ascendimacy/shared";

/**
 * Dimensões consideradas "sensory-leaning" no contexto trio Saki entry v1.
 * Lista conservadora — outras dimensões cognitivas/linguísticas NÃO entram
 * porque brejo cognitivo em Saki não exige partial pause (apenas emotional/sensory).
 *
 * Pode ser estendida via override `extraSensoryDimensions` em
 * `composeBrejoSignals` se um caller tiver matrix com chaves customizadas.
 */
export const DEFAULT_SENSORY_DIMENSIONS: readonly string[] = [
  "social_with_sibling",
  "sensory",
];

export interface ComposeBrejoSignalsInput {
  /** Participants da sessão (mesmos passados pra TrioState). */
  participants: TrioParticipant[];
  /**
   * Map persona_id → statusMatrix. Caller monta tipicamente lendo o
   * statusMatrix de cada participant (motor-execucao get_state per child).
   * Participants sem matrix são ignorados (graceful).
   */
  statusMatrixByPersona: Record<string, StatusMatrix | undefined>;
  /**
   * Override opcional pra adicionar dimensões além de DEFAULT_SENSORY_DIMENSIONS.
   * Não substitui — extends.
   */
  extraSensoryDimensions?: readonly string[];
}

/**
 * Compõe BrejoSignal[] a partir do statusMatrix per persona + perfis.
 *
 * Cada participant pode contribuir com 0, 1 ou 2 signals (max 1 emotional + 1 sensory).
 * Order de signals é: emotional first (per persona), depois sensory (per persona).
 * Caller é livre pra deduplicar ou agregar se a doctrine evoluir.
 */
export function composeBrejoSignals(
  input: ComposeBrejoSignalsInput,
): BrejoSignal[] {
  const { participants, statusMatrixByPersona, extraSensoryDimensions } = input;
  const sensoryDims = new Set([
    ...DEFAULT_SENSORY_DIMENSIONS,
    ...(extraSensoryDimensions ?? []),
  ]);
  const signals: BrejoSignal[] = [];

  for (const participant of participants) {
    const matrix = statusMatrixByPersona[participant.personaId];
    if (!matrix) continue;

    // (1) Emotional brejo — emite pra qualquer participant (não depende de strategy).
    if (matrix["emotional"] === "brejo") {
      signals.push({ personaId: participant.personaId, type: "emotional" });
    }

    // (2) Sensory brejo — só pra participants com regulation_strategy="sensory".
    //     Doctrine §11.4 partial-pause path é desenhado pra Saki especificamente.
    //     Sem strategy match, brejo sensorial sobe pra "full pause" por precaução
    //     já dentro de decideBrejoPause — aqui só emitimos quando o sinal qualifica
    //     pra partial.
    if (participant.regulation_strategy === "sensory") {
      const hasSensoryBrejo = Object.entries(matrix).some(
        ([dim, val]) => val === "brejo" && sensoryDims.has(dim),
      );
      if (hasSensoryBrejo) {
        signals.push({ personaId: participant.personaId, type: "sensory" });
      }
    }
  }

  return signals;
}

/**
 * Helper conveniente: extrai `regulation_strategy` e `silence_tolerance_rounds`
 * de um `PersonaDef.profile` no shape canonical (ver Saki fixture).
 *
 * Retorna um `TrioParticipant` pronto pra uso em TrioState.
 *
 * `profile` é `Record<string, unknown>` por PersonaDef — fields opcionais com
 * type-narrowing defensivo.
 */
export function trioParticipantFromPersona(
  personaId: string,
  name: string,
  profile: Record<string, unknown> | undefined,
): TrioParticipant {
  const participant: TrioParticipant = { personaId, name };
  const strategy = profile?.["regulation_strategy"];
  if (
    strategy === "sensory" ||
    strategy === "emotional" ||
    strategy === "cognitive"
  ) {
    participant.regulation_strategy = strategy;
  }
  const tolerance = profile?.["silence_tolerance_rounds"];
  if (typeof tolerance === "number" && Number.isFinite(tolerance) && tolerance > 0) {
    participant.silence_tolerance_rounds = tolerance;
  }
  return participant;
}
