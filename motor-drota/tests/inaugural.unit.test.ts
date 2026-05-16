import { describe, it, expect } from "vitest";
import { buildInaugural } from "../src/inaugural.js";
import type { InauguralContext } from "../src/inaugural.js";

const baseCtxJp: InauguralContext = {
  personaName: "Ryo",
  personaAge: 13,
  profileId: "kids-jp",
  sessionNumber: 1,
  isJoint: false,
};

const baseCtxBr: InauguralContext = {
  personaName: "Paula",
  personaAge: 13,
  profileId: "kids-br",
  sessionNumber: 1,
  isJoint: false,
};

describe("buildInaugural — primeira sessão (turn 0 + isFirstSession)", () => {
  it("JP profile: non_evaluation_clause present", async () => {
    const result = await buildInaugural(baseCtxJp);
    expect(result.non_evaluation_clause_present).toBe(true);
    expect(result.text).toMatch(/não.*avaliar|sem.*julgamento/i);
  });

  it("JP profile: exit_right present", async () => {
    const result = await buildInaugural(baseCtxJp);
    expect(result.exit_right_present).toBe(true);
    expect(result.text).toMatch(/parar|sair/i);
  });

  it("JP profile: uses inaugural_solo_jp template", async () => {
    const result = await buildInaugural(baseCtxJp);
    expect(result.template_used).toBe("inaugural_solo_jp");
  });

  it("BR profile: uses inaugural_solo_br template", async () => {
    const result = await buildInaugural(baseCtxBr);
    expect(result.template_used).toBe("inaugural_solo_br");
    expect(result.non_evaluation_clause_present).toBe(true);
    expect(result.exit_right_present).toBe(true);
  });

  it("nagareyama profileId routes to JP template", async () => {
    const result = await buildInaugural({ ...baseCtxJp, profileId: "nagareyama-ryo-001" });
    expect(result.template_used).toBe("inaugural_solo_jp");
  });

  it("addresses persona by name", async () => {
    const result = await buildInaugural(baseCtxJp);
    expect(result.text).toContain("Ryo");
  });

  it("NUNCA 'Como posso te ajudar'", async () => {
    const jp = await buildInaugural(baseCtxJp);
    const br = await buildInaugural(baseCtxBr);
    expect(jp.text).not.toMatch(/como posso te?\s+ajudar/i);
    expect(br.text).not.toMatch(/como posso te?\s+ajudar/i);
  });

  it("NUNCA identificadores técnicos (dot-notation, UUIDs)", async () => {
    const result = await buildInaugural(baseCtxJp);
    expect(result.text).not.toMatch(/kids-jp|nagareyama-ryo|[a-f0-9-]{36}/i);
    expect(result.text).not.toMatch(/profileId|personaAge|sessionNumber/i);
  });

  it("NUNCA 'Como IA' ou tom de assistente genérico", async () => {
    const jp = await buildInaugural(baseCtxJp);
    const br = await buildInaugural(baseCtxBr);
    expect(jp.text).not.toMatch(/como ia/i);
    expect(br.text).not.toMatch(/como ia/i);
    expect(jp.text).not.toMatch(/estou aqui para te ajudar/i);
    expect(br.text).not.toMatch(/estou aqui para te ajudar/i);
  });
});

describe("buildInaugural — segunda sessão (turn 0 + !isFirstSession)", () => {
  it("uses inaugural_recorrente template", async () => {
    const result = await buildInaugural({ ...baseCtxJp, sessionNumber: 2 });
    expect(result.template_used).toBe("inaugural_recorrente");
  });

  it("recorrente does NOT require non_evaluation_clause (já estabelecido)", async () => {
    const result = await buildInaugural({ ...baseCtxJp, sessionNumber: 2 });
    expect(result.non_evaluation_clause_present).toBe(false);
  });

  it("recorrente references previous session", async () => {
    const result = await buildInaugural({ ...baseCtxJp, sessionNumber: 2 });
    expect(result.text).toMatch(/últim|de volta|voltou/i);
  });
});

describe("buildInaugural — modo joint", () => {
  it("addresses both names in joint JP session", async () => {
    const result = await buildInaugural({
      ...baseCtxJp,
      isJoint: true,
      jointPartnerName: "Kei",
    });
    expect(result.text).toMatch(/Ryo/);
    expect(result.text).toMatch(/Kei/);
    expect(result.non_evaluation_clause_present).toBe(true);
  });

  it("joint recorrente also addresses both", async () => {
    const result = await buildInaugural({
      ...baseCtxJp,
      sessionNumber: 2,
      isJoint: true,
      jointPartnerName: "Kei",
    });
    expect(result.text).toMatch(/Ryo/);
    expect(result.text).toMatch(/Kei/);
  });
});
