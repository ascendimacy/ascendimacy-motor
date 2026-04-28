/**
 * Inaugural Template Resolver — apresentação do bot na primeira sessão.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-28-motor-simplificacao-llm-spec-v1.md §5.5
 *
 * Cascade fallback:
 *   1. ClientVoiceProfile (override por família) → mais específico
 *   2. CulturalDefaultProfile (ja.yaml, br-pt.yaml, _neutral.yaml)
 *   3. UniversalTemplate (built-in fallback hardcoded)
 *
 * Slots resolvidos:
 *   - greeting (texto da saudação)
 *   - subject_name_form (nome do sujeito + honorífico)
 *   - purpose (1-2 frases sobre o que vão fazer)
 *   - non_evaluation_clause (obrigatória — "não é teste")
 *   - exit_right (sempre presente — como sair)
 *   - confirmation_invite (ancorado em interesse se disponível)
 *
 * DT-SIM-06: voice_profile + cultural_default ainda são YAMLs sem loader
 * canônico em runtime. Esta função aceita os dois como `Record<string, unknown>`
 * (ja parsed via js-yaml externamente). Refatora quando profile-loader real
 * entrar.
 */

// ─────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────

export interface InauguralChild {
  /** Nome do sujeito como deve aparecer (sem honorífico por padrão JP). */
  name: string;
  /** Honorific override (se família configurou diferente do default). */
  honorific?: string;
  /** Idade — usada pra calibração de tom (não exposta no template). */
  age?: number;
  /** Interesse principal pra ancorar confirmation_invite. */
  topInterest?: string;
}

export interface InauguralResolveInput {
  /** Voice profile parseado (ClientVoiceProfile). Pode ser null. */
  voiceProfile?: Record<string, unknown> | null;
  /** Cultural default parseado (ja.yaml, _neutral.yaml). Pode ser null. */
  culturalDefault?: Record<string, unknown> | null;
  /** Dados da criança/sujeito. */
  child: InauguralChild;
  /** Número da sessão (1=inaugural, 2+=recorrente). */
  sessionNumber: number;
  /** Modo joint? (templates de dyad ficam pra v1). */
  isJoint?: boolean;
  /** Nome do parceiro (se joint). */
  jointPartnerName?: string;
}

export interface InauguralResolveOutput {
  /** Texto completo pronto pra Bridge. */
  text: string;
  /** Template resolvido (cascade source). */
  template_used:
    | "inaugural_solo_jp"
    | "inaugural_solo_br"
    | "inaugural_recorrente"
    | "inaugural_universal_fallback";
  /** Cláusula de não-avaliação presente? (acceptance criterion). */
  non_evaluation_clause_present: boolean;
  /** Direito de saída presente? (acceptance criterion). */
  exit_right_present: boolean;
  /** Source da cascade ("client_override" | "cultural_default" | "universal"). */
  cascade_source: "client_override" | "cultural_default" | "universal";
}

// ─────────────────────────────────────────────────────────────────────────
// Universal fallback (built-in PT-BR — funciona sem nenhum YAML)
// ─────────────────────────────────────────────────────────────────────────

const UNIVERSAL_FALLBACK = {
  greeting: "Oi",
  purpose:
    "Estou aqui pra pensar coisas com você. Não dou respostas — falo junto.",
  non_evaluation_clause: "Isso não é prova nem avaliação.",
  exit_right: "Se quiser parar, é só falar.",
  confirmation_invite_default: "O que tá rolando aí?",
  confirmation_invite_template: "Hoje quer falar sobre {interest}?",
};

const UNIVERSAL_RECORRENTE = {
  template: "Olá de novo, {name}. Pegando de onde paramos?",
};

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function getNested(
  obj: Record<string, unknown> | null | undefined,
  path: string[],
): unknown {
  if (!obj) return undefined;
  let cur: unknown = obj;
  for (const key of path) {
    if (cur && typeof cur === "object" && key in cur) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function buildSubjectNameForm(child: InauguralChild): string {
  const honorific = child.honorific && child.honorific !== "bare_name"
    ? `-${child.honorific}`
    : "";
  return `${child.name}${honorific}`;
}

function fillTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, "g"), v);
  }
  return out;
}

/** Resolve campo via cascade: client → cultural → universal fallback. */
function resolveField(
  path: string[],
  client: Record<string, unknown> | null | undefined,
  cultural: Record<string, unknown> | null | undefined,
  fallback: string,
): { value: string; source: "client_override" | "cultural_default" | "universal" } {
  const fromClient = asString(getNested(client, path));
  if (fromClient) return { value: fromClient, source: "client_override" };
  const fromCultural = asString(getNested(cultural, path));
  if (fromCultural) return { value: fromCultural, source: "cultural_default" };
  return { value: fallback, source: "universal" };
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve template inaugural via cascade. Sempre retorna texto válido.
 *
 * sessionNumber > 1 → template recorrente (curto, referencia sessão anterior).
 * sessionNumber = 1 → template completo com greeting + purpose + non_eval +
 * exit_right + confirmation_invite.
 */
export function resolveInauguralTemplate(
  input: InauguralResolveInput,
): InauguralResolveOutput {
  // Sessão recorrente — template curto
  if (input.sessionNumber > 1) {
    const recorrenteOverride = asString(
      getNested(input.voiceProfile, ["client_overrides", "recorrente_template"]),
    );
    const template = recorrenteOverride ?? UNIVERSAL_RECORRENTE.template;
    return {
      text: fillTemplate(template, {
        name: buildSubjectNameForm(input.child),
      }),
      template_used: "inaugural_recorrente",
      non_evaluation_clause_present: false, // recorrente não precisa
      exit_right_present: false,
      cascade_source: recorrenteOverride ? "client_override" : "universal",
    };
  }

  // Sessão 1 — template completo
  const subjectNameForm = buildSubjectNameForm(input.child);

  const greetingPath = ["inaugural", "greeting"];
  const purposePath = ["inaugural", "purpose"];
  const nonEvalPath = ["inaugural", "non_evaluation_clause"];
  const exitRightPath = ["inaugural", "exit_right"];
  const inviteDefaultPath = ["inaugural", "confirmation_invite_default"];
  const inviteTemplatePath = ["inaugural", "confirmation_invite_template"];

  const greeting = resolveField(
    greetingPath,
    input.voiceProfile,
    input.culturalDefault,
    UNIVERSAL_FALLBACK.greeting,
  );
  const purpose = resolveField(
    purposePath,
    input.voiceProfile,
    input.culturalDefault,
    UNIVERSAL_FALLBACK.purpose,
  );
  const nonEval = resolveField(
    nonEvalPath,
    input.voiceProfile,
    input.culturalDefault,
    UNIVERSAL_FALLBACK.non_evaluation_clause,
  );
  const exitRight = resolveField(
    exitRightPath,
    input.voiceProfile,
    input.culturalDefault,
    UNIVERSAL_FALLBACK.exit_right,
  );

  // Confirmation invite: usa template se interesse disponível, default se não
  let invite: string;
  if (input.child.topInterest) {
    const tmpl = resolveField(
      inviteTemplatePath,
      input.voiceProfile,
      input.culturalDefault,
      UNIVERSAL_FALLBACK.confirmation_invite_template,
    );
    invite = fillTemplate(tmpl.value, { interest: input.child.topInterest });
  } else {
    const def = resolveField(
      inviteDefaultPath,
      input.voiceProfile,
      input.culturalDefault,
      UNIVERSAL_FALLBACK.confirmation_invite_default,
    );
    invite = def.value;
  }

  // Compose final text
  const greetingLine = `${greeting.value}, ${subjectNameForm}.`;
  const text = [greetingLine, purpose.value, nonEval.value, exitRight.value, invite]
    .filter((s) => s && s.trim().length > 0)
    .join(" ");

  // Cascade source: pega o mais específico que contribuiu
  const sources = [greeting.source, purpose.source, nonEval.source, exitRight.source];
  let cascadeSource: "client_override" | "cultural_default" | "universal" = "universal";
  if (sources.includes("client_override")) cascadeSource = "client_override";
  else if (sources.includes("cultural_default")) cascadeSource = "cultural_default";

  // Decide template label baseado no language do cultural default
  let templateUsed: InauguralResolveOutput["template_used"] = "inaugural_universal_fallback";
  if (cascadeSource !== "universal") {
    const lang = asString(getNested(input.culturalDefault, ["language"]));
    if (lang === "ja") templateUsed = "inaugural_solo_jp";
    else if (lang === "pt") templateUsed = "inaugural_solo_br";
  }

  return {
    text: text.trim(),
    template_used: templateUsed,
    non_evaluation_clause_present: nonEval.value.length > 0,
    exit_right_present: exitRight.value.length > 0,
    cascade_source: cascadeSource,
  };
}
