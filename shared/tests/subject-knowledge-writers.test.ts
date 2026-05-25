/**
 * Tests DiscoveryWriter + BoundaryEventWriter (spec 2026-05-25 Fase 2).
 */
import { describe, it, expect } from "vitest";
import {
  extractDiscoveries,
  extractBoundaryEvents,
} from "../src/subject-knowledge-writers.js";

const baseDiscoveryInput = {
  subjectId: "ryo",
  sessionId: "sess-1",
  turnRef: "sess-1__turn_2",
};

describe("extractDiscoveries — interests", () => {
  it("detecta 'eu gosto de X' como interest mid", () => {
    const out = extractDiscoveries({
      ...baseDiscoveryInput,
      lastUserMessage: "eu gosto de tênis e anime",
    });
    expect(out.length).toBeGreaterThanOrEqual(1);
    const interest = out.find((e) => e.type === "interest");
    expect(interest).toBeDefined();
    if (interest && interest.payload.kind === "interest") {
      expect(interest.payload.label).toContain("tênis");
      expect(interest.payload.intensity).toBe("mid");
    }
  });

  it("detecta 'adoro X' como interest high", () => {
    const out = extractDiscoveries({
      ...baseDiscoveryInput,
      lastUserMessage: "adoro Dragon Ball",
    });
    const interest = out.find((e) => e.type === "interest");
    expect(interest).toBeDefined();
    if (interest && interest.payload.kind === "interest") {
      expect(interest.payload.label).toContain("Dragon Ball");
      expect(interest.payload.intensity).toBe("high");
    }
  });

  it("detecta 'sou fã de X' como interest high", () => {
    const out = extractDiscoveries({
      ...baseDiscoveryInput,
      lastUserMessage: "sou fã declarado de skate",
    });
    const interest = out.find((e) => e.type === "interest");
    expect(interest).toBeDefined();
  });

  it("não emite interest pra mensagem neutra", () => {
    const out = extractDiscoveries({
      ...baseDiscoveryInput,
      lastUserMessage: "hoje fui na escola, voltei e jantei",
    });
    expect(out.filter((e) => e.type === "interest")).toHaveLength(0);
  });

  it("não emite nada pra mensagem vazia", () => {
    const out = extractDiscoveries({
      ...baseDiscoveryInput,
      lastUserMessage: "",
    });
    expect(out).toHaveLength(0);
  });

  it("entries têm source=self_declared e confirmed_at=turnRef", () => {
    const out = extractDiscoveries({
      ...baseDiscoveryInput,
      lastUserMessage: "eu gosto de matemática",
    });
    for (const e of out) {
      expect(e.source).toBe("self_declared");
      expect(e.confirmed_at).toBe(baseDiscoveryInput.turnRef);
    }
  });
});

describe("extractDiscoveries — values", () => {
  it("detecta 'pra mim importa X'", () => {
    const out = extractDiscoveries({
      ...baseDiscoveryInput,
      lastUserMessage: "pra mim importa amizade verdadeira mais que nota boa",
    });
    const v = out.find((e) => e.type === "value");
    expect(v).toBeDefined();
    if (v && v.payload.kind === "value") {
      expect(v.payload.label.toLowerCase()).toContain("amizade");
    }
  });
});

describe("extractDiscoveries — needs", () => {
  it("detecta 'queria muito ...' como need", () => {
    const out = extractDiscoveries({
      ...baseDiscoveryInput,
      lastUserMessage: "queria muito poder dormir mais",
    });
    const n = out.find((e) => e.type === "need");
    expect(n).toBeDefined();
  });

  it("detecta 'precisava de X'", () => {
    const out = extractDiscoveries({
      ...baseDiscoveryInput,
      lastUserMessage: "precisava de paz pra estudar",
    });
    const n = out.find((e) => e.type === "need");
    expect(n).toBeDefined();
  });
});

const baseBoundaryInput = {
  subjectId: "ryo",
  sessionId: "sess-1",
  turnRef: "sess-1__turn_3",
};

describe("extractBoundaryEvents", () => {
  it("emite boundary_event pra deflection_thematic", () => {
    const out = extractBoundaryEvents({
      ...baseBoundaryInput,
      signals: ["deflection_thematic"],
      topicCategory: "tema_escolar_recente",
    });
    expect(out).toHaveLength(1);
    const e = out[0];
    expect(e.type).toBe("boundary_event");
    expect(e.source).toBe("motor_inferred");
    if (e.payload.kind === "boundary_event") {
      expect(e.payload.signal_type).toBe("deflection_thematic");
      expect(e.payload.topic_category).toBe("tema_escolar_recente");
      expect(e.payload.motor_response).toBe("muda_tema");
      expect(e.payload.severity_band).toBe("routine");
      expect(e.payload.intensity).toBe("mid");
    }
  });

  it("mapeia distress_marker_high → motor_response=recua_total + intensity=high", () => {
    const out = extractBoundaryEvents({
      ...baseBoundaryInput,
      signals: ["distress_marker_high"],
    });
    const e = out[0];
    if (e.payload.kind === "boundary_event") {
      expect(e.payload.motor_response).toBe("recua_total");
      expect(e.payload.intensity).toBe("high");
    }
  });

  it("mapeia exit_marker_explicit → recua_total", () => {
    const out = extractBoundaryEvents({
      ...baseBoundaryInput,
      signals: ["exit_marker_explicit"],
    });
    if (out[0].payload.kind === "boundary_event") {
      expect(out[0].payload.motor_response).toBe("recua_total");
    }
  });

  it("mapeia gatekeeper_resistance → suaviza", () => {
    const out = extractBoundaryEvents({
      ...baseBoundaryInput,
      signals: ["gatekeeper_resistance"],
    });
    if (out[0].payload.kind === "boundary_event") {
      expect(out[0].payload.motor_response).toBe("suaviza");
    }
  });

  it("ignora signals que não são boundaries (ex: frame_synthesis)", () => {
    const out = extractBoundaryEvents({
      ...baseBoundaryInput,
      signals: ["frame_synthesis", "mood_drift_up"],
    });
    expect(out).toHaveLength(0);
  });

  it("emite multiple events quando há multiple boundary signals", () => {
    const out = extractBoundaryEvents({
      ...baseBoundaryInput,
      signals: [
        "deflection_thematic",
        "gatekeeper_resistance",
        "mood_drift_down",
      ],
      topicCategory: "tema_X",
    });
    expect(out).toHaveLength(3);
    for (const e of out) {
      expect(e.type).toBe("boundary_event");
    }
  });

  it("topicCategory ausente vira 'indefinido'", () => {
    const out = extractBoundaryEvents({
      ...baseBoundaryInput,
      signals: ["deflection_thematic"],
    });
    if (out[0].payload.kind === "boundary_event") {
      expect(out[0].payload.topic_category).toBe("indefinido");
    }
  });

  it("respeita motorResponse override do caller", () => {
    const out = extractBoundaryEvents({
      ...baseBoundaryInput,
      signals: ["deflection_thematic"],
      motorResponse: "outro",
    });
    if (out[0].payload.kind === "boundary_event") {
      expect(out[0].payload.motor_response).toBe("outro");
    }
  });
});

describe("entry IDs", () => {
  it("são únicos entre múltiplas extrações no mesmo turn", () => {
    const out = extractDiscoveries({
      ...baseDiscoveryInput,
      lastUserMessage: "eu gosto de tênis e gosto de anime e adoro Dragon Ball",
    });
    const ids = out.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
