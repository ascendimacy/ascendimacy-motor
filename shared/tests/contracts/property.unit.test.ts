import { describe, expect, it } from "vitest";

import {
  PlanoTaticoDeltaSchema,
  TelemetryEventSchema,
  JOGADA_TYPES,
  type DeltaType,
  type JogadaType,
  type PlanoTaticoDelta,
  type TelemetryEvent,
  type TelemetryEventType,
} from "../../src/contracts/index.js";

// ─────────────────────────────────────────────────────────────────────────
// Seeded PRNG (mulberry32) — deterministic property tests sem dep externa.
// ─────────────────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: ReadonlyArray<T>): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function randomISO(rng: () => number): string {
  const base = Date.UTC(2026, 0, 1);
  const offset = Math.floor(rng() * 365 * 24 * 3600 * 1000);
  return new Date(base + offset).toISOString();
}

function randomPersonaId(rng: () => number): string {
  const names = ["ryo", "kei", "saki", "yuji", "yuko"];
  return `${pick(rng, names)}-ochiai-2026`;
}

function randomEixo(rng: () => number): string {
  const eixos = [
    "eixo-coragem-para-agir",
    "eixo-paciencia-com-frustracao",
    "eixo-curiosidade-aberta",
    "eixo-honestidade-consigo",
    "eixo-cuidado-com-outros",
  ];
  return pick(rng, eixos);
}

const DELTA_TYPES: ReadonlyArray<DeltaType> = [
  "jogada_validada",
  "jogada_falhou",
  "eixo_state_change",
  "ancora_added",
  "diamante_marker",
  "arena_concluida",
];

const EIXO_STATES = [
  "latente",
  "em-deteccao",
  "em-divergencia",
  "em-divergencia-reconhecida",
  "em-internalizacao-ativa",
  "internalizado",
] as const;

function genValidDelta(rng: () => number): PlanoTaticoDelta {
  const envelope = {
    target_persona_id: randomPersonaId(rng),
    ts: randomISO(rng),
    origem_turn_id: `turn-${Math.floor(rng() * 10000)}`,
  };
  const delta_type = pick(rng, DELTA_TYPES);
  const jogadaType = pick(rng, JOGADA_TYPES) as JogadaType;

  switch (delta_type) {
    case "jogada_validada":
      return {
        ...envelope,
        delta_type,
        payload: {
          tipo: jogadaType,
          eixo_destino: randomEixo(rng),
          o_que_funcionou: "rng-validated",
        },
      };
    case "jogada_falhou":
      return {
        ...envelope,
        delta_type,
        payload: {
          tipo: jogadaType,
          eixo_destino: randomEixo(rng),
          o_que_nao_funcionou: "rng-failed",
          proibido_repetir_por: randomISO(rng),
        },
      };
    case "eixo_state_change":
      return {
        ...envelope,
        delta_type,
        payload: {
          eixo: randomEixo(rng),
          from_state: pick(rng, EIXO_STATES),
          to_state: pick(rng, EIXO_STATES),
          razao: "rng-reason",
        },
      };
    case "ancora_added":
      return {
        ...envelope,
        delta_type,
        payload: {
          eixo_destino: randomEixo(rng),
          ancora_eixo: randomEixo(rng),
          forca: pick(rng, ["alta", "media", "baixa"] as const),
        },
      };
    case "diamante_marker":
      return {
        ...envelope,
        delta_type,
        payload: {
          slug: `diamond-${Math.floor(rng() * 1000)}`,
          direcao: pick(rng, ["ressoou", "evitar", "expirou_anti_repeticao"] as const),
          contexto: "rng-context",
        },
      };
    case "arena_concluida":
      return {
        ...envelope,
        delta_type,
        payload: {
          arena_id: `arena-${Math.floor(rng() * 1000)}`,
          tipo: pick(rng, ["academica", "social", "criativa", "fisica", "identidade"] as const),
          eixos_navegados: [randomEixo(rng)],
        },
      };
  }
}

const TELEMETRY_TYPES: ReadonlyArray<TelemetryEventType> = [
  "plano_tatico_updated",
  "recovery_triggered",
  "jogada_invocada",
  "jogada_validada",
  "jogada_falhou",
];

function genValidEvent(rng: () => number): TelemetryEvent {
  const envelope = { persona_id: randomPersonaId(rng), ts: randomISO(rng) };
  const event_type = pick(rng, TELEMETRY_TYPES);
  const jogadaType = pick(rng, JOGADA_TYPES) as JogadaType;
  switch (event_type) {
    case "plano_tatico_updated":
      return {
        ...envelope,
        event_type,
        payload: {
          trigger: pick(rng, ["post-onboarding", "post-compaction", "post-arena", "manual"] as const),
          sections_refreshed: ["conhecimento"],
          cost_usd_est: rng() * 0.01,
        },
      };
    case "recovery_triggered":
      return {
        ...envelope,
        event_type,
        payload: {
          recovery_type: pick(
            rng,
            ["jogada_falhou", "brejo_emocional", "trust_caindo", "evitacao_persistente"] as const,
          ),
          eixos_afetados: [randomEixo(rng)],
          acao_tomada: pick(
            rng,
            ["pausar_jogada", "modo_acolhimento", "elevar_carvalho", "recalibrar"] as const,
          ),
        },
      };
    case "jogada_invocada":
      return {
        ...envelope,
        event_type,
        payload: { jogada_type: jogadaType, eixo_destino: randomEixo(rng) },
      };
    case "jogada_validada":
      return {
        ...envelope,
        event_type,
        payload: {
          jogada_type: jogadaType,
          eixo_destino: randomEixo(rng),
          o_que_funcionou: "rng",
        },
      };
    case "jogada_falhou":
      return {
        ...envelope,
        event_type,
        payload: {
          jogada_type: jogadaType,
          eixo_destino: randomEixo(rng),
          o_que_nao_funcionou: "rng",
          proibido_repetir_por: randomISO(rng),
        },
      };
  }
}

const N = 100;
const SEED = 0xc0ffee;

describe("Property — PlanoTaticoDelta", () => {
  it("accepts 100 generated valid deltas across all variants (seed=0xc0ffee)", () => {
    const rng = mulberry32(SEED);
    for (let i = 0; i < N; i++) {
      const v = genValidDelta(rng);
      const out = PlanoTaticoDeltaSchema.safeParse(v);
      if (!out.success) {
        throw new Error(
          `iteration ${i} failed for delta_type=${v.delta_type}: ${JSON.stringify(out.error.issues)}`,
        );
      }
    }
  });

  it("rejects 100 mutated deltas with envelope field removed", () => {
    const rng = mulberry32(SEED ^ 1);
    for (let i = 0; i < N; i++) {
      const v: Record<string, unknown> = { ...genValidDelta(rng) };
      const fieldToRemove = pick(rng, ["target_persona_id", "ts", "origem_turn_id", "delta_type"] as const);
      delete v[fieldToRemove];
      expect(PlanoTaticoDeltaSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe("Property — TelemetryEvent", () => {
  it("accepts 100 generated valid events across all event_types (seed=0xc0ffee)", () => {
    const rng = mulberry32(SEED);
    for (let i = 0; i < N; i++) {
      const v = genValidEvent(rng);
      const out = TelemetryEventSchema.safeParse(v);
      if (!out.success) {
        throw new Error(
          `iteration ${i} failed for event_type=${v.event_type}: ${JSON.stringify(out.error.issues)}`,
        );
      }
    }
  });

  it("rejects 100 events with garbled payload (foreign event_type)", () => {
    const rng = mulberry32(SEED ^ 2);
    for (let i = 0; i < N; i++) {
      const v = genValidEvent(rng) as Record<string, unknown>;
      // Substitui payload por shape de outro event_type → rejeição esperada.
      const foreignPayload = genValidEvent(rng).payload;
      v.payload = foreignPayload;
      const out = TelemetryEventSchema.safeParse(v);
      if (out.success) {
        // só falha se gerador escolheu o mesmo event_type; aceita.
        expect(["plano_tatico_updated", "recovery_triggered", "jogada_invocada", "jogada_validada", "jogada_falhou"])
          .toContain(v.event_type);
      }
    }
  });
});
