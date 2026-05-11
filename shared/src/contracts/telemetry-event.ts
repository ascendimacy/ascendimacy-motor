/**
 * TelemetryEvent — envelope de telemetria operacional do Plano Tático.
 *
 * S-CT-01-03 do Pre-Sprint Bootstrap (ops#1008). Envelope herda shape
 * do pattern Sprint 1 (#991: menu_generated, menu_hit) — discriminado
 * por `event_type` + `persona_id` + `ts` + `payload`.
 *
 * 5 event_types canônicos (Brota Mestre Core v0.1 §13 — métricas
 * operacionais):
 *   plano_tatico_updated — após regeneração (§8 — per-compaction)
 *   recovery_triggered   — após qualquer protocolo de §9
 *   jogada_invocada      — H6 disparou jogada de giro
 *   jogada_validada      — H9 confirmou sucesso
 *   jogada_falhou        — H9 confirmou falha (espelha PlanoTaticoDelta variante)
 */

import { z } from "zod";
import { Iso8601DateTime } from "./iso8601.js";
import { JOGADA_TYPES } from "./jogada-step.js";

export const TELEMETRY_EVENT_TYPES = [
  "plano_tatico_updated",
  "recovery_triggered",
  "jogada_invocada",
  "jogada_validada",
  "jogada_falhou",
] as const;
export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

const JogadaTypeSchema = z.enum(JOGADA_TYPES);

const PlanoTaticoUpdatedPayload = z.object({
  trigger: z.enum(["post-onboarding", "post-compaction", "post-arena", "manual"]),
  sections_refreshed: z.array(z.string().min(1)).min(1),
  cost_usd_est: z.number().min(0),
});

const RecoveryTriggeredPayload = z.object({
  recovery_type: z.enum([
    "jogada_falhou",
    "brejo_emocional",
    "trust_caindo",
    "evitacao_persistente",
    "substituicao_humana",
  ]),
  eixos_afetados: z.array(z.string().min(1)),
  acao_tomada: z.enum([
    "pausar_jogada",
    "modo_acolhimento",
    "elevar_carvalho",
    "recalibrar",
    "safeguard_formal",
  ]),
});

const JogadaInvocadaPayload = z.object({
  jogada_type: JogadaTypeSchema,
  eixo_destino: z.string().min(1),
  ancora: z.string().min(1).optional(),
});

const JogadaValidadaPayload = z.object({
  jogada_type: JogadaTypeSchema,
  eixo_destino: z.string().min(1),
  arena_associada: z.string().min(1).optional(),
  o_que_funcionou: z.string().min(1),
});

const JogadaFalhouPayload = z.object({
  jogada_type: JogadaTypeSchema,
  eixo_destino: z.string().min(1),
  o_que_nao_funcionou: z.string().min(1),
  proibido_repetir_por: Iso8601DateTime,
});

const envelope = {
  persona_id: z.string().min(1),
  ts: Iso8601DateTime,
};

export const TelemetryEventSchema = z.discriminatedUnion("event_type", [
  z.object({ ...envelope, event_type: z.literal("plano_tatico_updated"), payload: PlanoTaticoUpdatedPayload }),
  z.object({ ...envelope, event_type: z.literal("recovery_triggered"), payload: RecoveryTriggeredPayload }),
  z.object({ ...envelope, event_type: z.literal("jogada_invocada"), payload: JogadaInvocadaPayload }),
  z.object({ ...envelope, event_type: z.literal("jogada_validada"), payload: JogadaValidadaPayload }),
  z.object({ ...envelope, event_type: z.literal("jogada_falhou"), payload: JogadaFalhouPayload }),
]);

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
