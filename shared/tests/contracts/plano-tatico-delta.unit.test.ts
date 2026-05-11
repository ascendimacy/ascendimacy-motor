import { describe, expect, it } from "vitest";

import {
  PlanoTaticoDeltaSchema,
  type PlanoTaticoDelta,
} from "../../src/contracts/index.js";

const baseEnvelope = {
  target_persona_id: "ryo-ochiai-2026",
  ts: "2026-05-11T10:30:00.000Z",
  origem_turn_id: "turn-0042",
};

describe("PlanoTaticoDelta — envelope shape", () => {
  it("rejects when target_persona_id is missing", () => {
    const out = PlanoTaticoDeltaSchema.safeParse({
      delta_type: "ancora_added",
      payload: { eixo_destino: "eixo-coragem-para-agir", forca: "media" },
      ts: baseEnvelope.ts,
      origem_turn_id: baseEnvelope.origem_turn_id,
    });
    expect(out.success).toBe(false);
  });

  it("rejects when ts is not ISO 8601", () => {
    const out = PlanoTaticoDeltaSchema.safeParse({
      ...baseEnvelope,
      ts: "ontem às 10h",
      delta_type: "ancora_added",
      payload: { eixo_destino: "eixo-coragem-para-agir", forca: "media" },
    });
    expect(out.success).toBe(false);
  });

  it("rejects unknown delta_type", () => {
    const out = PlanoTaticoDeltaSchema.safeParse({
      ...baseEnvelope,
      delta_type: "ataque_emergente",
      payload: { foo: "bar" },
    });
    expect(out.success).toBe(false);
  });
});

describe("PlanoTaticoDelta — discriminated by delta_type", () => {
  it("accepts jogada_validada with required payload", () => {
    const v: PlanoTaticoDelta = {
      ...baseEnvelope,
      delta_type: "jogada_validada",
      payload: {
        tipo: "bridge",
        eixo_destino: "eixo-coragem-para-agir",
        arena_associada: "arena-trabalho-historia",
        o_que_funcionou: "Ryo riu da analogia com Dragon Ball",
      },
    };
    expect(PlanoTaticoDeltaSchema.safeParse(v).success).toBe(true);
  });

  it("accepts jogada_falhou with proibido_repetir_por ISO date", () => {
    const v = {
      ...baseEnvelope,
      delta_type: "jogada_falhou" as const,
      payload: {
        tipo: "diamante" as const,
        eixo_destino: "eixo-paciencia-com-frustracao",
        o_que_nao_funcionou: "Diamante Hamlet fora do repertório",
        proibido_repetir_por: "2026-06-11T00:00:00.000Z",
      },
    };
    expect(PlanoTaticoDeltaSchema.safeParse(v).success).toBe(true);
  });

  it("accepts eixo_state_change with from/to enum states", () => {
    const v = {
      ...baseEnvelope,
      delta_type: "eixo_state_change" as const,
      payload: {
        eixo: "eixo-coragem-para-agir",
        from_state: "em-deteccao" as const,
        to_state: "em-divergencia" as const,
        razao: "2 sondagens consistentes apontaram polo_falta",
      },
    };
    expect(PlanoTaticoDeltaSchema.safeParse(v).success).toBe(true);
  });

  it("accepts ancora_added with forca enum", () => {
    const v = {
      ...baseEnvelope,
      delta_type: "ancora_added" as const,
      payload: {
        eixo_destino: "eixo-coragem-para-agir",
        ancora_eixo: "eixo-curiosidade-aberta",
        forca: "alta" as const,
      },
    };
    expect(PlanoTaticoDeltaSchema.safeParse(v).success).toBe(true);
  });

  it("accepts diamante_marker with direcao enum", () => {
    const v = {
      ...baseEnvelope,
      delta_type: "diamante_marker" as const,
      payload: {
        slug: "diamond-dragon-ball-kamehameha",
        direcao: "ressoou" as const,
        contexto: "Após pergunta sobre persistência no treino",
      },
    };
    expect(PlanoTaticoDeltaSchema.safeParse(v).success).toBe(true);
  });

  it("accepts arena_concluida with eixos_navegados array", () => {
    const v = {
      ...baseEnvelope,
      delta_type: "arena_concluida" as const,
      payload: {
        arena_id: "arena-trabalho-historia-2026-05",
        tipo: "academica" as const,
        eixos_navegados: ["eixo-coragem-para-agir", "eixo-paciencia-com-frustracao"],
      },
    };
    expect(PlanoTaticoDeltaSchema.safeParse(v).success).toBe(true);
  });

  it("rejects payload that does not match its delta_type", () => {
    const out = PlanoTaticoDeltaSchema.safeParse({
      ...baseEnvelope,
      delta_type: "arena_concluida",
      payload: {
        tipo: "bridge",
        eixo_destino: "eixo-coragem-para-agir",
        o_que_funcionou: "x",
      },
    });
    expect(out.success).toBe(false);
  });
});
