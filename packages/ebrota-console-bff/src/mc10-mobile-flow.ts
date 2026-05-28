/**
 * MC10 Mobile Onboarding Flow — state machine pra coleta de parental_telos
 * via WhatsApp (alternativa mobile-first ao wizard web de US-PO-01..11).
 *
 * Sequência de 7 prompts canônicos. Cada estado declara o prompt enviado
 * ao pai, o shape esperado da resposta, e o próximo step. Pure functions
 * sem side effects de framework — `mc10-routes.ts` faz o wrapping HTTP.
 *
 * Feature flag: `MC10_MOBILE_ONBOARDING=true` no env do BFF habilita
 * endpoints. Twilio webhook integration é out-of-scope deste PR.
 */

export type Mc10StepId =
  | "welcome"
  | "child_name"
  | "child_age"
  | "child_languages"
  | "parental_telos_short"
  | "daily_window"
  | "consent_confirm"
  | "complete";

export type Mc10ExpectedShape =
  | "ack" // welcome — qualquer resposta avança
  | "name" // non-empty string
  | "age" // integer 3-12
  | "languages" // comma-split list, ≥1 item
  | "free_text" // non-empty string
  | "daily_window_enum" // manhã|tarde|noite (combinações OK)
  | "boolean_yesno"; // sim|não

export interface Mc10StepDef {
  stepId: Mc10StepId;
  promptText: string;
  expectedShape: Mc10ExpectedShape;
  nextStep: Mc10StepId;
}

export const MC10_STEPS: Record<Mc10StepId, Mc10StepDef> = {
  welcome: {
    stepId: "welcome",
    promptText:
      "Oi! Sou Brota. Posso te perguntar 7 coisas pra entender melhor seu filho? Responde quando puder.",
    expectedShape: "ack",
    nextStep: "child_name",
  },
  child_name: {
    stepId: "child_name",
    promptText: "Como ele/ela se chama?",
    expectedShape: "name",
    nextStep: "child_age",
  },
  child_age: {
    stepId: "child_age",
    promptText: "Quantos anos?",
    expectedShape: "age",
    nextStep: "child_languages",
  },
  child_languages: {
    stepId: "child_languages",
    promptText: "Quais línguas vocês usam em casa? (separe com vírgula)",
    expectedShape: "languages",
    nextStep: "parental_telos_short",
  },
  parental_telos_short: {
    stepId: "parental_telos_short",
    promptText: "Em 1 frase, o que você mais quer pra ele/ela?",
    expectedShape: "free_text",
    nextStep: "daily_window",
  },
  daily_window: {
    stepId: "daily_window",
    promptText:
      "Que horários do dia você prefere que ele/ela converse comigo? (manhã/tarde/noite)",
    expectedShape: "daily_window_enum",
    nextStep: "consent_confirm",
  },
  consent_confirm: {
    stepId: "consent_confirm",
    promptText: "Posso começar a conversar com ele/ela amanhã? (sim/não)",
    expectedShape: "boolean_yesno",
    nextStep: "complete",
  },
  complete: {
    stepId: "complete",
    promptText: "Obrigado! Vou começar amanhã.",
    expectedShape: "ack",
    nextStep: "complete",
  },
};

export const FIRST_STEP: Mc10StepId = "welcome";

export type Mc10ParsedValue =
  | { kind: "ack" }
  | { kind: "name"; value: string }
  | { kind: "age"; value: number }
  | { kind: "languages"; value: string[] }
  | { kind: "free_text"; value: string }
  | { kind: "daily_window"; value: string[] }
  | { kind: "boolean_yesno"; value: boolean };

export interface Mc10ParseError {
  ok: false;
  error: string;
  hint: string;
}

export type Mc10ParseResult =
  | { ok: true; parsed: Mc10ParsedValue }
  | Mc10ParseError;

const DAILY_WINDOW_TOKENS = new Set(["manhã", "manha", "tarde", "noite"]);

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export function parseReply(stepId: Mc10StepId, rawText: string): Mc10ParseResult {
  const def = MC10_STEPS[stepId];
  if (!def) {
    return {
      ok: false,
      error: `unknown step ${stepId}`,
      hint: "estado inválido",
    };
  }
  const trimmed = rawText.trim();
  switch (def.expectedShape) {
    case "ack":
      return { ok: true, parsed: { kind: "ack" } };
    case "name": {
      if (trimmed.length === 0) {
        return {
          ok: false,
          error: "name vazio",
          hint: "Pode me dizer o nome dele/dela?",
        };
      }
      return { ok: true, parsed: { kind: "name", value: trimmed } };
    }
    case "age": {
      const match = trimmed.match(/-?\d+/);
      if (!match) {
        return {
          ok: false,
          error: "age não numérica",
          hint: "Pode mandar só o número da idade? Ex: 7",
        };
      }
      const n = parseInt(match[0], 10);
      if (Number.isNaN(n) || n < 3 || n > 12) {
        return {
          ok: false,
          error: "age fora de range 3-12",
          hint: "Idade precisa ser entre 3 e 12 anos.",
        };
      }
      return { ok: true, parsed: { kind: "age", value: n } };
    }
    case "languages": {
      const items = trimmed
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (items.length === 0) {
        return {
          ok: false,
          error: "languages vazio",
          hint: "Pode listar pelo menos 1 língua? Ex: português, japonês",
        };
      }
      return { ok: true, parsed: { kind: "languages", value: items } };
    }
    case "free_text": {
      if (trimmed.length === 0) {
        return {
          ok: false,
          error: "free_text vazio",
          hint: "Pode escrever em 1 frase o que você mais quer pra ele/ela?",
        };
      }
      return { ok: true, parsed: { kind: "free_text", value: trimmed } };
    }
    case "daily_window_enum": {
      const tokens = normalize(trimmed)
        .split(/[\s,/]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t !== "e"); // strip "e" conjunção PT
      const valid = tokens.filter((t) => DAILY_WINDOW_TOKENS.has(t));
      if (valid.length === 0) {
        return {
          ok: false,
          error: "daily_window não reconhecido",
          hint: "Pode escolher: manhã, tarde, noite (ou combinações)?",
        };
      }
      // Normalize "manha" → "manhã"
      const normalized = valid.map((t) => (t === "manha" ? "manhã" : t));
      const unique = [...new Set(normalized)];
      return { ok: true, parsed: { kind: "daily_window", value: unique } };
    }
    case "boolean_yesno": {
      const norm = normalize(trimmed);
      if (/^(sim|s|yes|y|ok|claro|pode)$/i.test(norm)) {
        return { ok: true, parsed: { kind: "boolean_yesno", value: true } };
      }
      if (/^(não|nao|n|no)$/i.test(norm)) {
        return { ok: true, parsed: { kind: "boolean_yesno", value: false } };
      }
      return {
        ok: false,
        error: "consent ambíguo",
        hint: "Pode responder com sim ou não?",
      };
    }
  }
}

export interface ValidationOk {
  ok: true;
}
export interface ValidationErr {
  ok: false;
  error: string;
}
export type ValidationResult = ValidationOk | ValidationErr;

export function validateReply(
  parsed: Mc10ParsedValue,
  stepId: Mc10StepId,
): ValidationResult {
  const def = MC10_STEPS[stepId];
  if (!def) {
    return { ok: false, error: `unknown step ${stepId}` };
  }
  // parseReply já carrega validação shape+range. validateReply confirma
  // que o kind do parsed bate com o expected do step (defesa adicional
  // contra mismatch caller).
  const expectKindMap: Record<Mc10ExpectedShape, Mc10ParsedValue["kind"]> = {
    ack: "ack",
    name: "name",
    age: "age",
    languages: "languages",
    free_text: "free_text",
    daily_window_enum: "daily_window",
    boolean_yesno: "boolean_yesno",
  };
  const expected = expectKindMap[def.expectedShape];
  if (parsed.kind !== expected) {
    return {
      ok: false,
      error: `kind mismatch: esperava ${expected}, recebeu ${parsed.kind}`,
    };
  }
  return { ok: true };
}

export interface Mc10NextStepResult {
  nextStep: Mc10StepId;
  advanced: boolean;
}

/**
 * Calcula próximo estado dado o atual + reply do usuário.
 *
 * - Se reply não parsea: NÃO avança. Retorna `advanced: false, nextStep =
 *   currentStep`. Caller deve mostrar `hint` do parse error pro user.
 * - Se reply parseia OK: avança pra `def.nextStep`. `advanced: true`.
 * - Se currentStep já é `complete`: nunca avança (idempotente).
 */
export function getNextStep(
  currentStep: Mc10StepId,
  userReply: string,
): Mc10NextStepResult {
  if (currentStep === "complete") {
    return { nextStep: "complete", advanced: false };
  }
  const parsed = parseReply(currentStep, userReply);
  if (!parsed.ok) {
    return { nextStep: currentStep, advanced: false };
  }
  const def = MC10_STEPS[currentStep];
  return { nextStep: def.nextStep, advanced: true };
}

export interface Mc10ReplyHistoryEntry {
  stepId: Mc10StepId;
  rawText: string;
  parsed: Mc10ParsedValue;
}

export interface Mc10CompletionPayload {
  childName: string;
  childAge: number;
  childLanguages: string[];
  parentalTelosShort: string;
  dailyWindow: string[];
  consentGranted: boolean;
}

/**
 * Compõe payload final pra emissão (`OnboardingComplete`) a partir do
 * histórico de replies. Lança se algum campo obrigatório está faltando
 * — só deve ser chamado depois de `consent_confirm` validado.
 */
export function buildCompletionPayload(
  history: Mc10ReplyHistoryEntry[],
): Mc10CompletionPayload {
  const byStep = new Map<Mc10StepId, Mc10ParsedValue>();
  for (const entry of history) {
    byStep.set(entry.stepId, entry.parsed);
  }
  const name = byStep.get("child_name");
  const age = byStep.get("child_age");
  const langs = byStep.get("child_languages");
  const telos = byStep.get("parental_telos_short");
  const window = byStep.get("daily_window");
  const consent = byStep.get("consent_confirm");

  if (!name || name.kind !== "name") {
    throw new Error("buildCompletionPayload: child_name ausente");
  }
  if (!age || age.kind !== "age") {
    throw new Error("buildCompletionPayload: child_age ausente");
  }
  if (!langs || langs.kind !== "languages") {
    throw new Error("buildCompletionPayload: child_languages ausente");
  }
  if (!telos || telos.kind !== "free_text") {
    throw new Error("buildCompletionPayload: parental_telos_short ausente");
  }
  if (!window || window.kind !== "daily_window") {
    throw new Error("buildCompletionPayload: daily_window ausente");
  }
  if (!consent || consent.kind !== "boolean_yesno") {
    throw new Error("buildCompletionPayload: consent_confirm ausente");
  }

  return {
    childName: name.value,
    childAge: age.value,
    childLanguages: langs.value,
    parentalTelosShort: telos.value,
    dailyWindow: window.value,
    consentGranted: consent.value,
  };
}
