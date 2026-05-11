// Pre-Sprint Bootstrap contracts (ops#1008) — superfície pública
// importada por CC-Strategist (C-T-09), CC-Jogadas (C-T-10),
// CC-Recovery e CC-STS.

export { Iso8601DateTime } from "./iso8601.js";

export {
  JOGADA_TYPES,
  type JogadaType,
  type JogadaSignal,
  type PlanoTaticoSnapshot,
  type JogadaInput,
  type JogadaOutput,
  type JogadaStep,
} from "./jogada-step.js";

export {
  PlanoTaticoDeltaSchema,
  DELTA_TYPES,
  EIXO_STATES,
  type PlanoTaticoDelta,
  type DeltaType,
  type EixoState,
} from "./plano-tatico-delta.js";

export {
  TelemetryEventSchema,
  TELEMETRY_EVENT_TYPES,
  type TelemetryEvent,
  type TelemetryEventType,
} from "./telemetry-event.js";
