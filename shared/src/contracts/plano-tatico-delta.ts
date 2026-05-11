/**
 * PlanoTaticoDelta — mutação atômica aplicada ao Plano Tático do
 * Treinador (spec: docs/architecture/plano-tatico-treinador-v0.1.md).
 *
 * S-CT-01-01 do Pre-Sprint Bootstrap (ops#1008). Emitido por
 * H9 (read response + atualizar) no loop principal — Brota Mestre
 * Core v0.1 §3.
 *
 * 6 variantes (discriminadas por `delta_type`):
 *   jogada_validada    — após Ciclo Fase 7 (debriefing) positivo
 *   jogada_falhou      — após Ciclo Fase 7 negativo OU recovery §9.1
 *   eixo_state_change  — transição entre os 6 estados do eixo §5
 *   ancora_added       — nova âncora disponível p/ eixo destino §6
 *   diamante_marker    — diamante ressoou / evitar / expirou anti-rep
 *   arena_concluida    — arena atravessada, alimenta §1.arenas_atravessadas
 */

import { z } from "zod";
import { Iso8601DateTime } from "./iso8601.js";
import { JOGADA_TYPES } from "./jogada-step.js";

export const DELTA_TYPES = [
  "jogada_validada",
  "jogada_falhou",
  "eixo_state_change",
  "ancora_added",
  "diamante_marker",
  "arena_concluida",
] as const;
export type DeltaType = (typeof DELTA_TYPES)[number];

export const EIXO_STATES = [
  "latente",
  "em-deteccao",
  "em-divergencia",
  "em-divergencia-reconhecida",
  "em-internalizacao-ativa",
  "internalizado",
] as const;
export type EixoState = (typeof EIXO_STATES)[number];

const JogadaTypeSchema = z.enum(JOGADA_TYPES);
const EixoStateSchema = z.enum(EIXO_STATES);

const JogadaValidadaPayload = z.object({
  tipo: JogadaTypeSchema,
  eixo_destino: z.string().min(1),
  arena_associada: z.string().min(1).optional(),
  o_que_funcionou: z.string().min(1),
});

const JogadaFalhouPayload = z.object({
  tipo: JogadaTypeSchema,
  eixo_destino: z.string().min(1),
  o_que_nao_funcionou: z.string().min(1),
  proibido_repetir_por: Iso8601DateTime,
});

const EixoStateChangePayload = z.object({
  eixo: z.string().min(1),
  from_state: EixoStateSchema,
  to_state: EixoStateSchema,
  razao: z.string().min(1),
});

const AncoraAddedPayload = z.object({
  eixo_destino: z.string().min(1),
  ancora_eixo: z.string().min(1).optional(),
  ou_tipo_ancora: z.enum(["interesse_vivo", "canal_gardner_forte", "arena_conquistada"]).optional(),
  forca: z.enum(["alta", "media", "baixa"]),
});

const DiamanteMarkerPayload = z.object({
  slug: z.string().min(1),
  direcao: z.enum(["ressoou", "evitar", "expirou_anti_repeticao"]),
  contexto: z.string().min(1),
});

const ArenaConcluidaPayload = z.object({
  arena_id: z.string().min(1),
  tipo: z.enum(["academica", "social", "criativa", "fisica", "identidade"]),
  eixos_navegados: z.array(z.string().min(1)).min(1),
  card_id: z.string().min(1).optional(),
});

const envelope = {
  target_persona_id: z.string().min(1),
  ts: Iso8601DateTime,
  origem_turn_id: z.string().min(1),
};

export const PlanoTaticoDeltaSchema = z.discriminatedUnion("delta_type", [
  z.object({ ...envelope, delta_type: z.literal("jogada_validada"), payload: JogadaValidadaPayload }),
  z.object({ ...envelope, delta_type: z.literal("jogada_falhou"), payload: JogadaFalhouPayload }),
  z.object({ ...envelope, delta_type: z.literal("eixo_state_change"), payload: EixoStateChangePayload }),
  z.object({ ...envelope, delta_type: z.literal("ancora_added"), payload: AncoraAddedPayload }),
  z.object({ ...envelope, delta_type: z.literal("diamante_marker"), payload: DiamanteMarkerPayload }),
  z.object({ ...envelope, delta_type: z.literal("arena_concluida"), payload: ArenaConcluidaPayload }),
]);

export type PlanoTaticoDelta = z.infer<typeof PlanoTaticoDeltaSchema>;
