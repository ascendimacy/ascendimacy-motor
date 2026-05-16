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

function buildSoloBr(ctx: InauguralContext): InauguralOutput {
  const addressee = ctx.isJoint && ctx.jointPartnerName
    ? `${ctx.personaName} e ${ctx.jointPartnerName}`
    : ctx.personaName;

  const text = [
    `${addressee}, bom te conhecer.`,
    ``,
    `Quero deixar claro logo de cara: não estou aqui pra te avaliar. Sem provas, sem julgamentos — o que você trouxer aqui, fica aqui.`,
    ``,
    `Se quiser parar em qualquer momento, é só me falar. Sem problema nenhum.`,
    ``,
    `Tem alguma coisa que te interesse muito ultimamente, ${ctx.personaName}? Pode ser qualquer coisa — algo que você faz, aprende, ou que fica na sua cabeça mesmo sem querer.`,
  ].join("\n");

  return {
    text,
    template_used: "inaugural_solo_br",
    non_evaluation_clause_present: true,
    exit_right_present: true,
  };
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
  return buildSoloBr(ctx);
}
