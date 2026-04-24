import { describe, it, expect } from "vitest";
import {
  bullyingCheckRuleBased,
  bullyingCheck,
  BULLYING_PATTERNS,
} from "../src/bullying-check.js";

const names = { child_a_name: "Ryo", child_b_name: "Kei" };

function msg(speaker: string, text: string) {
  return { speaker, text };
}

describe("bullyingCheckRuleBased — flags destrutivos", () => {
  it("ridicule pt-br — 'ridículo'", () => {
    const r = bullyingCheckRuleBased({
      ...names,
      recent_messages: [msg("Ryo", "Isso é ridículo, Kei.")],
    });
    expect(r.flagged).toBe(true);
    expect(r.pattern).toBe("ridicule");
    expect(r.confidence).toBe("high");
  });

  it("ridicule ja — バカ", () => {
    const r = bullyingCheckRuleBased({
      ...names,
      recent_messages: [msg("Ryo", "お前、バカだろ")],
    });
    expect(r.flagged).toBe(true);
    expect(r.pattern).toBe("ridicule");
  });

  it("destructive_comparison — 'pior que'", () => {
    const r = bullyingCheckRuleBased({
      ...names,
      recent_messages: [msg("Ryo", "você é pior que eu nisso, Kei")],
    });
    expect(r.flagged).toBe(true);
    expect(r.pattern).toBe("destructive_comparison");
  });

  it("manipulation — ameaça de contar pra mãe", () => {
    const r = bullyingCheckRuleBased({
      ...names,
      recent_messages: [msg("Ryo", "se não fizer, vou contar pra mamãe")],
    });
    expect(r.flagged).toBe(true);
    expect(r.pattern).toBe("manipulation");
  });

  it("threat_casual — violência verbal", () => {
    const r = bullyingCheckRuleBased({
      ...names,
      recent_messages: [msg("Ryo", "vou te bater depois")],
    });
    expect(r.flagged).toBe(true);
    expect(r.pattern).toBe("threat_casual");
  });

  it("exclusion — 'sai daqui'", () => {
    const r = bullyingCheckRuleBased({
      ...names,
      recent_messages: [msg("Ryo", "não quero você aqui, sai daqui Kei")],
    });
    expect(r.flagged).toBe(true);
    expect(r.pattern).toBe("exclusion");
  });
});

describe("bullyingCheckRuleBased — NÃO flaga diferenciação saudável", () => {
  it("especialização explícita", () => {
    const r = bullyingCheckRuleBased({
      ...names,
      recent_messages: [msg("Ryo", "você é mais de matemática, eu sou mais de desenho")],
    });
    expect(r.flagged).toBe(false);
  });

  it("cada um tem seu jeito", () => {
    const r = bullyingCheckRuleBased({
      ...names,
      recent_messages: [msg("Kei", "cada um tem seu jeito diferente")],
    });
    expect(r.flagged).toBe(false);
  });

  it("amae — pedido de ajuda afetiva", () => {
    const r = bullyingCheckRuleBased({
      ...names,
      recent_messages: [msg("Ryo", "me ensina isso aí, você é bom nisso Kei")],
    });
    expect(r.flagged).toBe(false);
  });

  it("discordância respeitosa", () => {
    const r = bullyingCheckRuleBased({
      ...names,
      recent_messages: [msg("Ryo", "acho que não concordo mas entendo seu ponto")],
    });
    expect(r.flagged).toBe(false);
  });
});

describe("bullyingCheck — dispatch com Haiku fallback", () => {
  it("rule-based com high confidence bypassa Haiku", async () => {
    let called = false;
    const mockHaiku = async () => {
      called = true;
      return JSON.stringify({ flagged: false, pattern: null, confidence: "high", reason: "ok" });
    };
    const r = await bullyingCheck(
      { ...names, recent_messages: [msg("Ryo", "ridículo isso")] },
      mockHaiku,
    );
    expect(r.flagged).toBe(true);
    expect(r.mode).toBe("rule_based");
    expect(called).toBe(false); // short-circuit
  });

  it("ambíguo chama Haiku quando disponível", async () => {
    let called = 0;
    const mockHaiku = async () => {
      called++;
      return JSON.stringify({
        flagged: true,
        pattern: "destructive_comparison",
        confidence: "medium",
        reason: "haiku detectou padrão sutil",
      });
    };
    const r = await bullyingCheck(
      {
        ...names,
        recent_messages: [msg("Ryo", "mas o Kei nunca teria conseguido fazer isso sozinho")],
      },
      mockHaiku,
    );
    expect(called).toBe(1);
    expect(r.mode).toBe("haiku");
    expect(r.flagged).toBe(true);
  });

  it("Haiku throw → fallback rule-based mode", async () => {
    const broken = async () => {
      throw new Error("timeout");
    };
    const r = await bullyingCheck(
      { ...names, recent_messages: [msg("Ryo", "talvez seja isso")] },
      broken,
    );
    expect(r.mode).toBe("haiku_fallback_to_rules");
    expect(r.flagged).toBe(false);
  });

  it("Haiku unparseable → fallback rule-based mode", async () => {
    const bad = async () => "not json";
    const r = await bullyingCheck(
      { ...names, recent_messages: [msg("Ryo", "talvez seja isso")] },
      bad,
    );
    expect(r.mode).toBe("haiku_fallback_to_rules");
  });

  it("sem Haiku caller → rule-based sempre", async () => {
    const r = await bullyingCheck({
      ...names,
      recent_messages: [msg("Ryo", "conversa normal")],
    });
    expect(r.mode).toBe("rule_based");
  });
});

describe("BULLYING_PATTERNS — contrato", () => {
  it("inclui os 5 patterns esperados", () => {
    expect(BULLYING_PATTERNS).toEqual([
      "ridicule",
      "destructive_comparison",
      "manipulation",
      "threat_casual",
      "exclusion",
    ]);
  });
});
