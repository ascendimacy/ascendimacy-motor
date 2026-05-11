// Smoke import-test — verifica que a superfície pública de
// shared/src/contracts/ é importável pelos consumidores futuros
// (CC-Strategist em capability C-T-09, CC-Jogadas em C-T-10,
// CC-Recovery e CC-STS). Sem assertions runtime — o tsc --noEmit
// é a verificação. Se este arquivo compila, os 3 contratos
// expõem a interface acordada na PR.

import {
  PlanoTaticoDeltaSchema,
  TelemetryEventSchema,
  JOGADA_TYPES,
  TELEMETRY_EVENT_TYPES,
  type PlanoTaticoDelta,
  type DeltaType,
  type EixoState,
  type JogadaInput,
  type JogadaOutput,
  type JogadaStep,
  type JogadaType,
  type TelemetryEvent,
  type TelemetryEventType,
} from "../../src/contracts/index.js";

// CC-Strategist (C-T-09) emite deltas após gerar Plano Tático novo.
export function fakeStrategistEmit(delta: PlanoTaticoDelta): boolean {
  return PlanoTaticoDeltaSchema.safeParse(delta).success;
}

// CC-Jogadas (C-T-10) implementa JogadaStep — função pura.
export const fakeJogadasStep: JogadaStep = (input: JogadaInput): JogadaOutput => ({
  type: "bridge",
  script_proposto: `bridge para ${input.eixo}`,
  validation_criteria: ["treinador reconhece"],
});

// CC-Recovery + CC-STS emitem telemetria com envelope compartilhado.
export function fakeTelemetryEmit(event: TelemetryEvent): boolean {
  return TelemetryEventSchema.safeParse(event).success;
}

// Type-only assertions — garantem que enums são re-exportados como tuplas
// `as const` (preserva tipo literal, não generaliza para string[]).
export const _jogadaTypeCheck: ReadonlyArray<JogadaType> = JOGADA_TYPES;
export const _telemetryTypeCheck: ReadonlyArray<TelemetryEventType> = TELEMETRY_EVENT_TYPES;
export const _deltaTypes: ReadonlyArray<DeltaType> = [
  "jogada_validada",
  "jogada_falhou",
  "eixo_state_change",
  "ancora_added",
  "diamante_marker",
  "arena_concluida",
];
export const _eixoStates: ReadonlyArray<EixoState> = [
  "latente",
  "em-deteccao",
  "em-divergencia",
  "em-divergencia-reconhecida",
  "em-internalizacao-ativa",
  "internalizado",
];
