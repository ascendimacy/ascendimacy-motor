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

/**
 * Subject Knowledge Fase 3: pergunta aberta obrigatória pra cada sessão
 * inaugural (princípio "pergunta aberta abre cada sessão").
 *
 * Schema validador (validateInauguralOutput) rejeita templates sem
 * discovery_question.text não-vazio — não passa code review nem teste.
 */
export interface DiscoveryQuestion {
  /** Pergunta aberta intencional formulada ao sujeito. */
  text: string;
  /** O que estamos investigando — guia downstream do DiscoveryWriter. */
  intent: "interest" | "value" | "context" | "feeling";
  /** Categorias de signal esperadas como resposta (informativo). */
  expected_signal_categories: string[];
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
  /**
   * Subject Knowledge Fase 3: pergunta aberta intencional do turn 0.
   * Para sessão recorrente (sessionNumber > 1) o motor pode optar por
   * não incluir — null sinaliza ausência consciente.
   */
  discovery_question: DiscoveryQuestion | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Universal fallback (built-in PT-BR — funciona sem nenhum YAML)
// ─────────────────────────────────────────────────────────────────────────

// v0.2.7 — Tutor self-introduction como UNIVERSAL_FALLBACK.
// Decisão (Alexa 2026-05-28): primeira jogada do bot DEVE ser se apresentar
// como tutor + convite com baralho concreto + consent gate explícito.
// Spec base: 2026-05-25-session-phases-journey-stages-strategist.md.
// Modulação por idade fica v0.3 — esta versão usa a banda "direct" (10-14)
// que cobre o caso STS Ryo/Kei. Voice_profile / cultural_default ainda
// podem override por família/cultura.
const UNIVERSAL_FALLBACK = {
  greeting: "Oi",
  purpose:
    "Sou um tutor. Diferente de professor: não tenho matéria pra cobrir. Diferente de terapeuta: não vou ficar te perguntando como você se sente. O que faço é a gente escolher junto que potencial seu vale a pena desenvolver.",
  non_evaluation_clause: "Sem prova, sem nota.",
  exit_right: "Se não curtir, a gente para.",
  confirmation_invite_default:
    "Te mandaram um baralho com 4 virtudes — tem uma atividade rápida com ele que pode mostrar onde você quer começar. Vamos tentar?",
  confirmation_invite_template:
    "Te mandaram um baralho com 4 virtudes. Sei que você curte {interest} — vamos fazer uma atividade rápida com o baralho? Pode te mostrar onde começar.",
  /**
   * v0.2.7: discovery_question agora é o convite à atividade do baralho.
   * Subject Knowledge Fase 3 honrado — investiga interest VIA artefato
   * concreto (não pergunta vaga "o que te interessa?").
   */
  discovery_question: {
    text: "Te mandaram um baralho com 4 virtudes — tem uma atividade rápida com ele que pode mostrar onde você quer começar. Vamos tentar?",
    intent: "interest" as const,
    expected_signal_categories: ["interest_marker", "engagement_high"],
  },
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
      discovery_question: null, // recorrente: motor decide dinamicamente
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

  // Resolve discovery_question via cascade. Cultural default pode prover
  // tanto string solta quanto objeto completo; aqui pegamos string e usamos
  // intent default 'interest'. Override completo via voice_profile.discovery_question.
  const discoveryQuestionText = resolveField(
    ["inaugural", "discovery_question"],
    input.voiceProfile,
    input.culturalDefault,
    UNIVERSAL_FALLBACK.discovery_question.text,
  );
  // voice_profile pode declarar intent diferente (interest/value/context/feeling)
  const discoveryQuestionIntentRaw =
    asString(getNested(input.voiceProfile, ["inaugural", "discovery_question_intent"])) ??
    asString(getNested(input.culturalDefault, ["inaugural", "discovery_question_intent"])) ??
    UNIVERSAL_FALLBACK.discovery_question.intent;
  const discoveryQuestionIntent: DiscoveryQuestion["intent"] =
    discoveryQuestionIntentRaw === "value" ||
    discoveryQuestionIntentRaw === "context" ||
    discoveryQuestionIntentRaw === "feeling"
      ? discoveryQuestionIntentRaw
      : "interest";

  const discoveryQuestion: DiscoveryQuestion = {
    text: discoveryQuestionText.value,
    intent: discoveryQuestionIntent,
    expected_signal_categories:
      UNIVERSAL_FALLBACK.discovery_question.expected_signal_categories,
  };

  // Compose final text: invite/discovery_question fecha o acolhimento.
  // Backcompat: se interest disponível usa invite ancorado; senão, se
  // cultural/voice trouxe confirmation_invite_default não-universal, usa
  // ele; em último caso, usa a nova discovery_question (PT-BR universal).
  let closingQuestion: string;
  if (input.child.topInterest) {
    closingQuestion = invite;
  } else {
    const def = resolveField(
      inviteDefaultPath,
      input.voiceProfile,
      input.culturalDefault,
      "", // universal vazio força fallback pra discovery_question
    );
    closingQuestion =
      def.value && def.source !== "universal"
        ? def.value
        : discoveryQuestion.text;
  }
  const greetingLine = `${greeting.value}, ${subjectNameForm}.`;
  const text = [greetingLine, purpose.value, nonEval.value, exitRight.value, closingQuestion]
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
    discovery_question: discoveryQuestion,
  };
}

/**
 * Validador estrutural — falha hard quando o acolhimento do turn 0 não
 * carrega `discovery_question` com texto não-vazio.
 *
 * Princípio "pergunta aberta abre cada sessão" (Subject Knowledge Fase 3):
 * sessão sem pergunta aberta intencional viola o contrato pedagógico
 * eBrota e não pode passar code review nem teste de integração.
 *
 * Sessões recorrentes (template_used === "inaugural_recorrente") são
 * exceção — motor decide pergunta dinamicamente no flow normal.
 */
export class InauguralValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InauguralValidationError";
  }
}

export function validateInauguralOutput(
  output: InauguralResolveOutput,
): void {
  if (output.template_used === "inaugural_recorrente") {
    return; // sessão recorrente — sem obrigatoriedade
  }
  if (!output.discovery_question) {
    throw new InauguralValidationError(
      "discovery_question ausente — princípio pedagógico exige pergunta aberta no turn 0",
    );
  }
  if (
    typeof output.discovery_question.text !== "string" ||
    output.discovery_question.text.trim().length === 0
  ) {
    throw new InauguralValidationError(
      "discovery_question.text vazio — pergunta aberta intencional obrigatória",
    );
  }
  if (!output.non_evaluation_clause_present) {
    throw new InauguralValidationError(
      "non_evaluation_clause obrigatória no acolhimento inaugural",
    );
  }
  if (!output.exit_right_present) {
    throw new InauguralValidationError(
      "exit_right obrigatório no acolhimento inaugural",
    );
  }
}
