import { describe, it, expect } from "vitest";
import {
  FIRST_STEP,
  MC10_STEPS,
  buildCompletionPayload,
  getNextStep,
  parseReply,
  validateReply,
  type Mc10ReplyHistoryEntry,
} from "../src/mc10-mobile-flow.js";

describe("MC10 state machine — step transitions", () => {
  it("FIRST_STEP é welcome com prompt apresentando Brota", () => {
    expect(FIRST_STEP).toBe("welcome");
    expect(MC10_STEPS.welcome.promptText).toContain("Brota");
    expect(MC10_STEPS.welcome.promptText).toContain("7 coisas");
  });

  it("welcome → child_name avança com qualquer ack", () => {
    const r = getNextStep("welcome", "ok");
    expect(r.advanced).toBe(true);
    expect(r.nextStep).toBe("child_name");
  });

  it("cada step não-complete aponta pro próximo correto", () => {
    expect(MC10_STEPS.welcome.nextStep).toBe("child_name");
    expect(MC10_STEPS.child_name.nextStep).toBe("child_age");
    expect(MC10_STEPS.child_age.nextStep).toBe("child_languages");
    expect(MC10_STEPS.child_languages.nextStep).toBe("parental_telos_short");
    expect(MC10_STEPS.parental_telos_short.nextStep).toBe("daily_window");
    expect(MC10_STEPS.daily_window.nextStep).toBe("consent_confirm");
    expect(MC10_STEPS.consent_confirm.nextStep).toBe("complete");
  });

  it("complete é estado terminal (idempotente)", () => {
    const r = getNextStep("complete", "sim");
    expect(r.advanced).toBe(false);
    expect(r.nextStep).toBe("complete");
  });

  it("reply inválido NÃO avança — currentStep preservado", () => {
    const r = getNextStep("child_age", "não sei");
    expect(r.advanced).toBe(false);
    expect(r.nextStep).toBe("child_age");
  });
});

describe("MC10 parseReply — válidos", () => {
  it("name: trim e accept non-empty", () => {
    const r = parseReply("child_name", "  Ryo  ");
    expect(r.ok).toBe(true);
    if (r.ok && r.parsed.kind === "name") {
      expect(r.parsed.value).toBe("Ryo");
    }
  });

  it("age: 7 dentro de range 3-12", () => {
    const r = parseReply("child_age", "7");
    expect(r.ok).toBe(true);
    if (r.ok && r.parsed.kind === "age") {
      expect(r.parsed.value).toBe(7);
    }
  });

  it("age: extrai número de texto livre ('tem 8 anos')", () => {
    const r = parseReply("child_age", "tem 8 anos");
    expect(r.ok).toBe(true);
    if (r.ok && r.parsed.kind === "age") {
      expect(r.parsed.value).toBe(8);
    }
  });

  it("languages: comma split e trim", () => {
    const r = parseReply(
      "child_languages",
      "português, japonês ,  inglês",
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.parsed.kind === "languages") {
      expect(r.parsed.value).toEqual(["português", "japonês", "inglês"]);
    }
  });

  it("free_text: aceita frase de telos", () => {
    const r = parseReply(
      "parental_telos_short",
      "Quero que ele seja curioso e gentil.",
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.parsed.kind === "free_text") {
      expect(r.parsed.value).toContain("curioso");
    }
  });

  it("daily_window: 'manhã e tarde' → ['manhã', 'tarde']", () => {
    const r = parseReply("daily_window", "manhã e tarde");
    expect(r.ok).toBe(true);
    if (r.ok && r.parsed.kind === "daily_window") {
      expect(r.parsed.value).toEqual(["manhã", "tarde"]);
    }
  });

  it("daily_window: 'manha' sem til normaliza pra 'manhã'", () => {
    const r = parseReply("daily_window", "manha");
    expect(r.ok).toBe(true);
    if (r.ok && r.parsed.kind === "daily_window") {
      expect(r.parsed.value).toEqual(["manhã"]);
    }
  });

  it("consent: 'sim' → true", () => {
    const r = parseReply("consent_confirm", "sim");
    expect(r.ok).toBe(true);
    if (r.ok && r.parsed.kind === "boolean_yesno") {
      expect(r.parsed.value).toBe(true);
    }
  });

  it("consent: 'Não' (case-insensitive) → false", () => {
    const r = parseReply("consent_confirm", "Não");
    expect(r.ok).toBe(true);
    if (r.ok && r.parsed.kind === "boolean_yesno") {
      expect(r.parsed.value).toBe(false);
    }
  });
});

describe("MC10 parseReply — inválidos retornam hint", () => {
  it("name vazio → erro com hint", () => {
    const r = parseReply("child_name", "   ");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.hint).toBeTruthy();
    }
  });

  it("age não numérica → erro", () => {
    const r = parseReply("child_age", "sei lá");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint).toContain("número");
  });

  it("age fora de range (2) → erro", () => {
    const r = parseReply("child_age", "2");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("range");
  });

  it("age fora de range (15) → erro", () => {
    const r = parseReply("child_age", "15");
    expect(r.ok).toBe(false);
  });

  it("languages vazio → erro", () => {
    const r = parseReply("child_languages", "   ,  ,  ");
    expect(r.ok).toBe(false);
  });

  it("free_text vazio (telos) → erro", () => {
    const r = parseReply("parental_telos_short", "");
    expect(r.ok).toBe(false);
  });

  it("daily_window 'meio-dia' → erro com hint dos válidos", () => {
    const r = parseReply("daily_window", "meio-dia");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint).toMatch(/manhã|tarde|noite/);
  });

  it("consent ambíguo ('talvez') → erro", () => {
    const r = parseReply("consent_confirm", "talvez");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ambíguo");
  });
});

describe("MC10 validateReply — kind alinhado ao step", () => {
  it("kind name no step child_name → ok", () => {
    const v = validateReply({ kind: "name", value: "Ryo" }, "child_name");
    expect(v.ok).toBe(true);
  });

  it("kind age no step child_name → erro mismatch", () => {
    const v = validateReply({ kind: "age", value: 7 }, "child_name");
    expect(v.ok).toBe(false);
  });
});

describe("MC10 buildCompletionPayload", () => {
  const fullHistory = (): Mc10ReplyHistoryEntry[] => [
    { stepId: "welcome", rawText: "ok", parsed: { kind: "ack" } },
    {
      stepId: "child_name",
      rawText: "Ryo",
      parsed: { kind: "name", value: "Ryo" },
    },
    {
      stepId: "child_age",
      rawText: "8",
      parsed: { kind: "age", value: 8 },
    },
    {
      stepId: "child_languages",
      rawText: "pt, jp",
      parsed: { kind: "languages", value: ["pt", "jp"] },
    },
    {
      stepId: "parental_telos_short",
      rawText: "curioso",
      parsed: { kind: "free_text", value: "curioso" },
    },
    {
      stepId: "daily_window",
      rawText: "tarde",
      parsed: { kind: "daily_window", value: ["tarde"] },
    },
    {
      stepId: "consent_confirm",
      rawText: "sim",
      parsed: { kind: "boolean_yesno", value: true },
    },
  ];

  it("payload completo com todos campos", () => {
    const p = buildCompletionPayload(fullHistory());
    expect(p).toEqual({
      childName: "Ryo",
      childAge: 8,
      childLanguages: ["pt", "jp"],
      parentalTelosShort: "curioso",
      dailyWindow: ["tarde"],
      consentGranted: true,
    });
  });

  it("consentGranted=false quando pai disse não", () => {
    const h = fullHistory();
    h[6]!.parsed = { kind: "boolean_yesno", value: false };
    const p = buildCompletionPayload(h);
    expect(p.consentGranted).toBe(false);
  });

  it("histórico incompleto → lança", () => {
    const h = fullHistory().slice(0, 4);
    expect(() => buildCompletionPayload(h)).toThrow();
  });
});

describe("MC10 idempotency — reply 2x mesmo step", () => {
  it("getNextStep com mesma reply duas vezes avança apenas se válida; complete não avança nunca", () => {
    const first = getNextStep("child_name", "Ryo");
    expect(first.advanced).toBe(true);
    expect(first.nextStep).toBe("child_age");
    // Caller mantém estado em child_age; reapply same name não é
    // chamado de novo, mas se for chamado em child_name, avança igual.
    const second = getNextStep("child_name", "Ryo");
    expect(second.advanced).toBe(true);
    // Estado complete nunca avança.
    const term1 = getNextStep("complete", "Ryo");
    const term2 = getNextStep("complete", "Ryo");
    expect(term1.advanced).toBe(false);
    expect(term2.advanced).toBe(false);
  });
});
