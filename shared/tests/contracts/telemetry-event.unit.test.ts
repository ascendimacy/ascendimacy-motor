import { describe, expect, it } from "vitest";

import {
  TELEMETRY_EVENT_TYPES,
  TelemetryEventSchema,
  type TelemetryEvent,
} from "../../src/contracts/index.js";

const baseEnvelope = {
  persona_id: "ryo-ochiai-2026",
  ts: "2026-05-11T10:30:00.000Z",
};

describe("TelemetryEvent — envelope contract", () => {
  it("exposes exactly the 5 canonical event_types", () => {
    expect(new Set(TELEMETRY_EVENT_TYPES)).toEqual(
      new Set([
        "plano_tatico_updated",
        "recovery_triggered",
        "jogada_invocada",
        "jogada_validada",
        "jogada_falhou",
      ]),
    );
  });

  it("rejects when persona_id is missing", () => {
    const out = TelemetryEventSchema.safeParse({
      event_type: "jogada_invocada",
      ts: baseEnvelope.ts,
      payload: { jogada_type: "bridge", eixo_destino: "eixo-coragem-para-agir" },
    });
    expect(out.success).toBe(false);
  });

  it("rejects when ts is not ISO 8601", () => {
    const out = TelemetryEventSchema.safeParse({
      ...baseEnvelope,
      ts: "2026/05/11 10:30",
      event_type: "jogada_invocada",
      payload: { jogada_type: "bridge", eixo_destino: "eixo-coragem-para-agir" },
    });
    expect(out.success).toBe(false);
  });

  it("rejects unknown event_type", () => {
    const out = TelemetryEventSchema.safeParse({
      ...baseEnvelope,
      event_type: "menu_generated",
      payload: {},
    });
    expect(out.success).toBe(false);
  });
});

describe("TelemetryEvent — discriminated by event_type", () => {
  it("accepts plano_tatico_updated", () => {
    const v: TelemetryEvent = {
      ...baseEnvelope,
      event_type: "plano_tatico_updated",
      payload: {
        trigger: "post-compaction",
        sections_refreshed: ["conhecimento", "eixos_estado", "diamantes"],
        cost_usd_est: 0.0034,
      },
    };
    expect(TelemetryEventSchema.safeParse(v).success).toBe(true);
  });

  it("accepts recovery_triggered", () => {
    const v: TelemetryEvent = {
      ...baseEnvelope,
      event_type: "recovery_triggered",
      payload: {
        recovery_type: "brejo_emocional",
        eixos_afetados: ["eixo-coragem-para-agir"],
        acao_tomada: "modo_acolhimento",
      },
    };
    expect(TelemetryEventSchema.safeParse(v).success).toBe(true);
  });

  it("accepts jogada_invocada with optional ancora", () => {
    const v: TelemetryEvent = {
      ...baseEnvelope,
      event_type: "jogada_invocada",
      payload: {
        jogada_type: "bridge",
        eixo_destino: "eixo-coragem-para-agir",
        ancora: "eixo-curiosidade-aberta",
      },
    };
    expect(TelemetryEventSchema.safeParse(v).success).toBe(true);
  });

  it("accepts jogada_validada", () => {
    const v: TelemetryEvent = {
      ...baseEnvelope,
      event_type: "jogada_validada",
      payload: {
        jogada_type: "diamante",
        eixo_destino: "eixo-paciencia-com-frustracao",
        o_que_funcionou: "Ryo completou a referência",
      },
    };
    expect(TelemetryEventSchema.safeParse(v).success).toBe(true);
  });

  it("accepts jogada_falhou with proibido_repetir_por", () => {
    const v: TelemetryEvent = {
      ...baseEnvelope,
      event_type: "jogada_falhou",
      payload: {
        jogada_type: "espelho",
        eixo_destino: "eixo-coragem-para-agir",
        o_que_nao_funcionou: "Treinador percebeu como cobrança e fechou",
        proibido_repetir_por: "2026-06-11T00:00:00.000Z",
      },
    };
    expect(TelemetryEventSchema.safeParse(v).success).toBe(true);
  });

  it("rejects payload mismatched to event_type", () => {
    const out = TelemetryEventSchema.safeParse({
      ...baseEnvelope,
      event_type: "plano_tatico_updated",
      payload: { jogada_type: "bridge", eixo_destino: "eixo-coragem-para-agir" },
    });
    expect(out.success).toBe(false);
  });
});
