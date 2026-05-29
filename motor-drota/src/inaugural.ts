/**
 * Inaugural turn — apresentação de primeira sessão (turn 0).
 *
 * Salvage de motor#59 (PR closed PHANTOM-MERGEABLE associated com motor#58).
 * Ported para main pós motor#125 (post-processor F3+F5) — escopo independente,
 * additive only. Spec ops#1084.
 *
 * Differentiation: em vez de passar pelo pipeline scorePool/LLM normal, turn 0
 * retorna mensagem construída por template determinístico, com cláusulas
 * obrigatórias de não-avaliação + direito de saída (primeira sessão), ou
 * resumo conversacional de retorno (sessões subsequentes).
 *
 * Sub-decisões CC defaults (per ops#1084):
 * 1. Trigger turn 0 = `state.turn === 0`. Distinção primeira-vs-recorrente via
 *    `eventLog.some(e => e.type === 'playbook_executed')` (sessão recorrente
 *    quando há histórico prévio de execução).
 * 2. Language detection: `contextHints.profile_id` (string) com fallback
 *    `persona.id`. Patterns JP: contém `-jp`, `_jp`, ou `nagareyama`.
 * 3. Recorrente semantics: `sessionNumber > 1` triggera template
 *    `inaugural_recorrente`. Sem cláusulas (já estabelecidas na primeira).
 *
 * Refs:
 * - ops#1084 (spec)
 * - motor#59 (source, closed)
 * - motor#125 (sibling salvage pattern — post-processor F3+F5)
 * - motor#110 (repetition_inquiry — NOT touched, this code lives before rankPool)
 */

export interface InauguralContext {
  personaName: string;
  personaAge: number;
  profileId: string;
  culturalDefaults?: object;
  sessionNumber: number;
  isJoint: boolean;
  jointPartnerName?: string;
}

export interface InauguralOutput {
  text: string;
  template_used: string;
  non_evaluation_clause_present: boolean;
  exit_right_present: boolean;
}

function isJpProfile(profileId: string): boolean {
  return profileId.includes("-jp") || profileId.includes("_jp") || profileId.includes("nagareyama");
}

function buildSoloJp(ctx: InauguralContext): InauguralOutput {
  const addressee = ctx.isJoint && ctx.jointPartnerName
    ? `${ctx.personaName} e ${ctx.jointPartnerName}`
    : ctx.personaName;

  const text = [
    `${addressee}, bom te ver por aqui.`,
    ``,
    `Não estou aqui pra te avaliar — sem provas, sem notas, sem julgamentos. O que você compartilhar aqui fica entre nós.`,
    ``,
    `Se em algum momento quiser parar, é só falar — sem explicação necessária.`,
    ``,
    `${ctx.personaName}, tem algo que move você bastante ultimamente? Pode ser um interesse, algo que você pratica, ou uma ideia que fica voltando mesmo quando você não quer.`,
  ].join("\n");

  return {
    text,
    template_used: "inaugural_solo_jp",
    non_evaluation_clause_present: true,
    exit_right_present: true,
  };
}

/**
 * v0.2.7-bands (2026-05-28) — 3 bandas etárias do tutor self-introduction.
 * Estrutura comum: identidade + diferenciação + partnership + artefato +
 * convite + consent gate. Banda etária define vocabulário + densidade.
 *
 * Dispatch em buildInaugural via ctx.personaAge:
 *  - < 10: buildSoloBrLudic
 *  - 10-14 OU age desconhecida: buildSoloBr (direct, default)
 *  - >= 15: buildSoloBrPhil
 */
function joinAddressee(ctx: InauguralContext): string {
  return ctx.isJoint && ctx.jointPartnerName
    ? `${ctx.personaName} e ${ctx.jointPartnerName}`
    : ctx.personaName;
}

function buildSoloBrLudic(ctx: InauguralContext): InauguralOutput {
  const addressee = joinAddressee(ctx);
  const text = [
    `${addressee}, oi!`,
    ``,
    `Sou um tutor — tipo um amigo que ajuda você a descobrir coisas que você é bom e que ninguém viu ainda.`,
    ``,
    `Seus pais te deram um baralho com 4 super-poderes (eles chamam de virtudes). A gente pode jogar com ele e descobrir os seus.`,
    ``,
    `Que tal a gente tentar? Se for chato, a gente para.`,
  ].join("\n");
  return {
    text,
    template_used: "inaugural_solo_br_tutor_intro_ludic_v027",
    non_evaluation_clause_present: true,
    exit_right_present: true,
  };
}

function buildSoloBr(ctx: InauguralContext): InauguralOutput {
  // Banda "direct" (10-14) — cobre Ryo, Kei. Default quando age desconhecida.
  // Decisão Alexa 2026-05-28: tutor se apresenta + convite a atividade com
  // baralho de 4 virtudes + consent gate explícito.
  // Spec base: 2026-05-25-session-phases-journey-stages-strategist.md.
  const addressee = joinAddressee(ctx);
  const text = [
    `${addressee}, bom te conhecer.`,
    ``,
    `Sou um tutor. Diferente de professor: não tenho matéria pra cobrir. Diferente de terapeuta: não vou ficar te perguntando como você se sente.`,
    ``,
    `O que faço é a gente escolher junto que potencial seu vale a pena desenvolver. Sem prova, sem nota. Se não curtir, a gente para.`,
    ``,
    `Te mandaram um baralho com 4 virtudes — tem uma atividade rápida com ele que pode mostrar onde você quer começar. Vamos tentar?`,
  ].join("\n");
  return {
    text,
    template_used: "inaugural_solo_br_tutor_intro_direct_v027",
    non_evaluation_clause_present: true,
    exit_right_present: true,
  };
}

function buildSoloBrPhil(ctx: InauguralContext): InauguralOutput {
  const addressee = joinAddressee(ctx);
  const text = [
    `${addressee}, oi.`,
    ``,
    `Sou um tutor. Tutoria é a forma mais antiga de educação que ainda funciona — alguém que te ajuda a descobrir o que você ainda não vê em si, sem currículo, sem nota.`,
    ``,
    `A gente pode escolher junto o potencial que vale a pena desenvolver. Se não rolar, a gente encerra.`,
    ``,
    `Te enviei um baralho de 4 virtudes — base da ética clássica, mas usável hoje. Topa fazer uma atividade rápida com ele? Pode te dizer coisas inesperadas sobre você.`,
  ].join("\n");
  return {
    text,
    template_used: "inaugural_solo_br_tutor_intro_phil_v027",
    non_evaluation_clause_present: true,
    exit_right_present: true,
  };
}

function dispatchSoloBr(ctx: InauguralContext): InauguralOutput {
  const age = ctx.personaAge;
  if (typeof age === "number" && age > 0) {
    if (age < 10) return buildSoloBrLudic(ctx);
    if (age >= 15) return buildSoloBrPhil(ctx);
  }
  return buildSoloBr(ctx);
}

function buildRecorrente(ctx: InauguralContext): InauguralOutput {
  const text = ctx.isJoint && ctx.jointPartnerName
    ? `${ctx.personaName}, ${ctx.jointPartnerName} — bom ter vocês dois de volta. Da última vez vocês trouxeram coisas que ficaram martelando. Alguma delas ainda está na cabeça de vocês?`
    : `${ctx.personaName}, bom ter você de volta. Da última vez você trouxe coisas interessantes — alguma delas ficou martelando na sua cabeça desde então?`;

  return {
    text,
    template_used: "inaugural_recorrente",
    non_evaluation_clause_present: false,
    exit_right_present: false,
  };
}

export async function buildInaugural(ctx: InauguralContext): Promise<InauguralOutput> {
  if (ctx.sessionNumber > 1) {
    return buildRecorrente(ctx);
  }
  if (isJpProfile(ctx.profileId)) {
    return buildSoloJp(ctx);
  }
  // v0.2.7-bands — dispatch BR por banda etária (ludic <10, direct 10-14, phil 15+).
  return dispatchSoloBr(ctx);
}
