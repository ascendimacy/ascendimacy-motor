import { describe, it, expect } from "vitest";
import { emitPulso } from "../src/pulso-emitter.js";

describe("pulso-emitter", () => {
  it("adult → omikuji format com outcome culturalmente carregado", () => {
    const p = emitPulso({
      persona_id: "yuji-ochiai",
      age_group: "adult",
      window_name: "post-bedtime-kids-jp",
      now_iso: "2026-05-20T12:00:00Z",
      seed: 1,
    });
    expect(p.kind).toBe("pulso:ritual_return");
    expect(p.pulso_kind).toBe("omikuji");
    expect(p.text).toMatch(/Hoje você tirou (大吉|中吉|小吉|吉|末吉)/);
    expect(p.text).toContain("sessão curta");
  });

  it("kid → mini_history format com 2 linhas", () => {
    const p = emitPulso({
      persona_id: "saki-ochiai",
      age_group: "kid",
      window_name: "post-school-jp",
      now_iso: "2026-05-20T07:00:00Z",
      seed: 1,
    });
    expect(p.pulso_kind).toBe("mini_history");
    const lines = p.text.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
  });

  it("seed fixo → output determinístico", () => {
    const a = emitPulso({
      persona_id: "x",
      age_group: "adult",
      window_name: "w",
      now_iso: "2026-05-20T12:00:00Z",
      seed: 42,
    });
    const b = emitPulso({
      persona_id: "x",
      age_group: "adult",
      window_name: "w",
      now_iso: "2026-05-20T12:00:00Z",
      seed: 42,
    });
    expect(a.text).toBe(b.text);
  });

  it("preserva persona_id, window_name e emitted_at no output", () => {
    const p = emitPulso({
      persona_id: "kei-ochiai",
      age_group: "kid",
      window_name: "weekend-morning-jp",
      now_iso: "2026-05-23T10:00:00Z",
      seed: 7,
    });
    expect(p.persona_id).toBe("kei-ochiai");
    expect(p.window_name).toBe("weekend-morning-jp");
    expect(p.emitted_at).toBe("2026-05-23T10:00:00Z");
  });
});
