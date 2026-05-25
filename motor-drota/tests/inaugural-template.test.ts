import { describe, it, expect } from "vitest";
import { resolveInauguralTemplate } from "../src/inaugural-template.js";

const JA_CULTURAL = {
  language: "ja",
  inaugural: {
    greeting: "こんにちは",
    purpose: "僕はあなたと一緒に何かを考える相手だよ。",
    non_evaluation_clause: "これはテストじゃないよ。",
    exit_right: "「もういい」って言えば、いつでも終われるよ。",
    confirmation_invite_default: "今日は何が気になってる?",
    confirmation_invite_template: "今日、{interest}について話したい?",
  },
};

const PT_CULTURAL = {
  language: "pt",
  inaugural: {
    greeting: "Oi",
    purpose: "Estou aqui pra pensar coisas com você.",
    non_evaluation_clause: "Isso não é prova nem avaliação.",
    exit_right: "Se quiser parar, é só falar.",
    confirmation_invite_default: "O que tá rolando aí?",
    confirmation_invite_template: "Hoje quer falar sobre {interest}?",
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Sessão 1 — template completo
// ─────────────────────────────────────────────────────────────────────────

describe("resolveInauguralTemplate — sessão 1 cultural JP", () => {
  it("retorna texto JP com todos os slots", () => {
    const r = resolveInauguralTemplate({
      culturalDefault: JA_CULTURAL,
      child: { name: "Ryo" },
      sessionNumber: 1,
    });
    expect(r.text).toContain("こんにちは");
    expect(r.text).toContain("Ryo");
    expect(r.text).toContain("これはテストじゃないよ");
    expect(r.text).toContain("もういい");
    expect(r.template_used).toBe("inaugural_solo_jp");
    expect(r.non_evaluation_clause_present).toBe(true);
    expect(r.exit_right_present).toBe(true);
    expect(r.cascade_source).toBe("cultural_default");
  });

  it("usa interest no confirmation_invite quando disponível", () => {
    const r = resolveInauguralTemplate({
      culturalDefault: JA_CULTURAL,
      child: { name: "Ryo", topInterest: "Dragon Ball" },
      sessionNumber: 1,
    });
    expect(r.text).toContain("Dragon Ball");
  });

  it("usa default invite quando interest ausente", () => {
    const r = resolveInauguralTemplate({
      culturalDefault: JA_CULTURAL,
      child: { name: "Ryo" },
      sessionNumber: 1,
    });
    expect(r.text).toContain("気になってる");
  });

  it("honorific bare_name → sem sufixo", () => {
    const r = resolveInauguralTemplate({
      culturalDefault: JA_CULTURAL,
      child: { name: "Ryo", honorific: "bare_name" },
      sessionNumber: 1,
    });
    expect(r.text).toContain("Ryo.");
    expect(r.text).not.toContain("Ryo-");
  });

  it("honorific kun → sufixo aplicado", () => {
    const r = resolveInauguralTemplate({
      culturalDefault: JA_CULTURAL,
      child: { name: "Ryo", honorific: "kun" },
      sessionNumber: 1,
    });
    expect(r.text).toContain("Ryo-kun");
  });
});

describe("resolveInauguralTemplate — sessão 1 cultural PT", () => {
  it("retorna texto PT-BR com todos os slots", () => {
    const r = resolveInauguralTemplate({
      culturalDefault: PT_CULTURAL,
      child: { name: "Saki" },
      sessionNumber: 1,
    });
    expect(r.text).toContain("Oi");
    expect(r.text).toContain("Saki");
    expect(r.text).toContain("não é prova");
    expect(r.template_used).toBe("inaugural_solo_br");
    expect(r.non_evaluation_clause_present).toBe(true);
    expect(r.exit_right_present).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Cascade override (ClientVoiceProfile)
// ─────────────────────────────────────────────────────────────────────────

describe("resolveInauguralTemplate — cascade ClientVoiceProfile sobrescreve", () => {
  it("client_override.inaugural.purpose vence cultural", () => {
    const client = {
      inaugural: {
        purpose: "Custom purpose desta família.",
      },
    };
    const r = resolveInauguralTemplate({
      voiceProfile: client,
      culturalDefault: JA_CULTURAL,
      child: { name: "Ryo" },
      sessionNumber: 1,
    });
    expect(r.text).toContain("Custom purpose desta família");
    expect(r.text).not.toContain("僕はあなた"); // cultural purpose NÃO usado
    expect(r.cascade_source).toBe("client_override");
  });

  it("client parcial → fallback cultural pros campos não cobertos", () => {
    const client = { inaugural: { greeting: "Olá!" } }; // só override greeting
    const r = resolveInauguralTemplate({
      voiceProfile: client,
      culturalDefault: JA_CULTURAL,
      child: { name: "Ryo" },
      sessionNumber: 1,
    });
    expect(r.text).toContain("Olá!"); // do client
    expect(r.text).toContain("もういい"); // do cultural (exit_right)
    expect(r.cascade_source).toBe("client_override");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Universal fallback (sem voice profile nem cultural)
// ─────────────────────────────────────────────────────────────────────────

describe("resolveInauguralTemplate — universal fallback", () => {
  it("sem profile nem cultural → texto built-in PT-BR funciona", () => {
    const r = resolveInauguralTemplate({
      child: { name: "Test" },
      sessionNumber: 1,
    });
    expect(r.text).toContain("Test");
    expect(r.text.length).toBeGreaterThan(20);
    expect(r.template_used).toBe("inaugural_universal_fallback");
    expect(r.non_evaluation_clause_present).toBe(true);
    expect(r.exit_right_present).toBe(true);
    expect(r.cascade_source).toBe("universal");
  });

  it("cultural null + voice null → fallback hardcoded sempre disponível", () => {
    const r = resolveInauguralTemplate({
      voiceProfile: null,
      culturalDefault: null,
      child: { name: "X" },
      sessionNumber: 1,
    });
    expect(r.text).toBeTruthy();
    expect(r.exit_right_present).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Sessão recorrente (sessionNumber > 1)
// ─────────────────────────────────────────────────────────────────────────

describe("resolveInauguralTemplate — sessão recorrente", () => {
  it("sessionNumber=2 → template recorrente curto", () => {
    const r = resolveInauguralTemplate({
      culturalDefault: JA_CULTURAL,
      child: { name: "Ryo" },
      sessionNumber: 2,
    });
    expect(r.template_used).toBe("inaugural_recorrente");
    expect(r.text).toContain("Ryo");
    // Recorrente não precisa de non_eval/exit (já apresentados na sessão 1)
    expect(r.non_evaluation_clause_present).toBe(false);
    expect(r.exit_right_present).toBe(false);
  });

  it("sessionNumber=10 também usa recorrente", () => {
    const r = resolveInauguralTemplate({
      child: { name: "Kei" },
      sessionNumber: 10,
    });
    expect(r.template_used).toBe("inaugural_recorrente");
    expect(r.text).toContain("Kei");
  });

  it("client_override.recorrente_template vence universal", () => {
    const client = {
      client_overrides: { recorrente_template: "Custom: {name}, vamos lá!" },
    };
    const r = resolveInauguralTemplate({
      voiceProfile: client,
      child: { name: "Ryo" },
      sessionNumber: 3,
    });
    expect(r.text).toBe("Custom: Ryo, vamos lá!");
    expect(r.cascade_source).toBe("client_override");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Acceptance criteria do spec §11
// ─────────────────────────────────────────────────────────────────────────

describe("acceptance criteria — non_eval + exit_right bilíngue", () => {
  it("PT + JP ambos têm non_eval + exit_right (sessão 1)", () => {
    const ja = resolveInauguralTemplate({
      culturalDefault: JA_CULTURAL,
      child: { name: "Ryo" },
      sessionNumber: 1,
    });
    const pt = resolveInauguralTemplate({
      culturalDefault: PT_CULTURAL,
      child: { name: "Saki" },
      sessionNumber: 1,
    });
    expect(ja.non_evaluation_clause_present).toBe(true);
    expect(ja.exit_right_present).toBe(true);
    expect(pt.non_evaluation_clause_present).toBe(true);
    expect(pt.exit_right_present).toBe(true);
  });
});
