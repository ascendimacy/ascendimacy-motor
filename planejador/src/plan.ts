/**
 * Planejador — deixa de nomear playbook-ação-unitária.
 * Agora: scora o pool (via scoreItem de @ascendimacy/shared) e devolve top 1-5.
 *
 * LLM é consultada APENAS para strategicRationale e contextHints
 * (detecção de língua + ajuste tonal). O scoring é determinístico.
 *
 * Bloco 2b adiciona: composição de `instruction_addition` via
 * `withGardnerProgram` se programa ativo e assessment pronto.
 *
 * Spec: docs/handoffs/2026-04-24-cc-bloco2-plan.md §2.A v2 + Bloco 2b.
 */

import type {
  PlanTurnInput,
  PlanTurnOutput,
  ScoredContentItem,
  GardnerAssessment,
  GardnerProgramState,
  ParentalProfile,
  ContentItem,
  EventEntry,
  TutorialContext,
  TutorialMove,
  TutorialMoveAlternative,
} from "@ascendimacy/shared";
import {
  scorePool,
  allGates,
  pickFocusDimension,
  caselTargetsFor,
  defaultMatrix,
  composeInstructionAddition,
  isAssessmentReady,
  pairForWeek,
  shouldPauseProgram,
  isParentalProfileMinimal,
  triageForParents,
  logDebugEvent,
  shouldUseMockLlm,
  computeChallengeCost,
  computeTrustRatio,
  deriveOutcomeSignal,
  isItemAllowedUnderBudgetExhaustion,
  extractPersonaSensitivity,
  isExhausted,
} from "@ascendimacy/shared";
import { callLlm, callLlmMock, callHaiku, type LlmCallResult } from "./llm-client.js";
import { generateDiscoveryOptions } from "./discovery-agent.js";
import { generateInventoryProbeQuestions } from "./inventory-probe-agent.js";
import { composePlaybook } from "./strategist/playbook-composer.js";
import type { SubjectInventory, EmergentVirtueTarget } from "@ascendimacy/shared";
import { detectMilestone } from "./milestone-detector.js";
import type { LlmTraceCollector, PlanejadorTrace } from "@ascendimacy/shared";

export interface PlanTurnOpts {
  /** TV2-3 (spec ops#1136): coletor pra LLM call + trace section. */
  collector?: LlmTraceCollector;
}
import { loadSeedPool, buildPool, slicePoolForDrota } from "./pool-builder.js";
import {
  deserializeDrillProposal,
  drillProposalToScoredItem,
} from "@ascendimacy/shared";
import {
  evaluateAllTransitions,
  collectRecentSignals,
  collectRecentSignalsPerTurn,
  enrichWithClosedLoopActions,
} from "./trigger-evaluator.js";
import { detectCritical } from "./critical-detector.js";
import { personaToChildProfile } from "./child-profile.js";
import { lookupActionMenu } from "./strategist/menu-lookup.js";
import {
  activeCycleProgress,
  assessCycleExtension,
  computeEvolutionAssessment,
  cycleProgress,
  detectCadenceTriggers,
} from "./strategist/helix-engine.js";
import {
  countInquiriesInSession,
  extractProfileConfig,
  extractRepetitionCounts,
  shouldAskRepetitionInquiry,
  turnsSinceLastInquiry,
} from "./strategist/repetition-inquiry.js";

/** Quantos items do pool passamos ao drota (top-K). */
export const TOP_K_POOL = 5;

/** Caminho do seed pode ser sobrescrito via env para testes. */
function seedPath(): string | undefined {
  return process.env["CONTENT_SEED_PATH"];
}

/**
 * Exported pra consumo por PoC scripts (ops#1069 follow-up) que precisam
 * reproduzir prompt do planejador sem passar pelo MCP handler completo.
 * Sem mudança de comportamento — só visibility.
 *
 * BUG-PL-01 Sprint 5: agora injeta SINAIS DETECTADOS NO TURNO ATUAL
 * (vindos do caller via `input.contextHints["extracted_signals"]`) +
 * bloco DEFLECTION ATIVO quando `deflection_thematic` / `exit_marker_*`
 * estão presentes.
 *
 * Antes deste fix, signal-extractor rodava upstream mas o output ficava
 * só no event_log — planejador nunca via signals, então strategicRationale
 * + contextHints ignoravam deflections (bot insistia no tema por 3 turns).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-05-bugfix-materializer-content-anchor.md
 */
/**
 * Sprint Pedagógico P1.1: detecta pergunta direta na incomingMessage.
 *
 * Heurística inicial conservadora:
 *  - ? em qualquer posição (mais comum)
 *  - palavras-pergunta pt-br: "por que", "o que", "como", "quando", "onde",
 *    "qual", "quem", "será que", "tipo, ..."
 *  - linguagem informal Kei/Ryo: "tipo... X?", "vc tá Y?"
 *
 * Bug evidência: Kei smoke 2026-05-25 turn 3 — "Você não respondeu nada
 * que eu perguntei". Bot emitiu Fact ignorando question explícita do sujeito.
 * Fix: planejador injeta question_detected pra materializer priorizar resp.
 */
export function detectQuestionInMessage(message: string | undefined): {
  has_question: boolean;
  question_text?: string;
} {
  if (!message || typeof message !== "string") {
    return { has_question: false };
  }
  const normalized = message.toLowerCase().trim();
  if (normalized.length === 0) return { has_question: false };

  const hasQuestionMark = /\?/.test(message);
  const questionWords = [
    "por que",
    "porque ",
    "pq ",
    "o que ",
    "oq ",
    "como ",
    "quando ",
    "onde ",
    "qual ",
    "quais ",
    "quem ",
    "será que",
    "sera que",
  ];
  const hasQuestionWord = questionWords.some((w) => normalized.includes(w));

  if (hasQuestionMark || hasQuestionWord) {
    return { has_question: true, question_text: message.trim() };
  }
  return { has_question: false };
}

/**
  * Tutor Clássico v0.1 — emissão do contrato de movimento tutorial.
  *
  * Esta é a implementação mínima para fazer o contrato circular pelo pipeline.
  * O objetivo atual (Itens 1 e 2 do Lote 1) é apenas garantir que:
  * - O contrato é emitido
  * - O contrato chega até o materializer
  *
  * A lógica inteligente de decisão de `move_type` será feita no Item 6 (Lote 1, CP4).
  */
function computeBasicTutorialContext(
  input: PlanTurnInput,
  topItem?: ContentItem | null,
): TutorialContext | null {
  // CP4 / Itens 6+7 — decisão determinística baseada em sinais e estado.
  // Sem LLM. Ordem de prioridade: close > correct > recall > explain.

  const signals = Array.isArray(input.contextHints?.["extracted_signals"])
    ? (input.contextHints!["extracted_signals"] as string[])
    : [];

  const eventLog = Array.isArray(input.state?.eventLog) ? input.state.eventLog : [];

  const hasExitSignal = signals.some(
    (s) => s === "exit_marker_explicit" || s === "exit_marker_implicit",
  );
  const hasConfusionSignal = signals.some(
    (s) => s === "confusion" || s === "distress" || s === "frustration",
  );

  // CP_discovery_gate (v0.2.6) — durante journey_stage="discovery_only" ou
  // session_phase="ice_breaker", suprime entrega de conteúdo e emite
  // move_type="discover". Tutor para de empurrar ensino enquanto a conversa
  // ainda está mapeando interesse do sujeito.
  // Spec: 2026-05-25-session-phases-journey-stages-strategist.md
  const stateAsRecord = input.state as unknown as Record<string, unknown> | undefined;
  const journeyStage =
    stateAsRecord?.["journey_stage"] ??
    input.contextHints?.["journey_stage"];
  const sessionPhase =
    stateAsRecord?.["sessionPhase"] ??
    input.contextHints?.["sessionPhase"] ??
    input.contextHints?.["session_phase"];
  const isDiscoveryStage =
    journeyStage === "discovery_only" || sessionPhase === "ice_breaker";

  // Último item efetivamente apresentado em turn anterior.
  // O scorer evita re-emitir items used_in_session, então comparar com
  // topItem.id seria estruturalmente impossível. Usamos o eventLog direto.
  // eventLog vem em ordem DESC (newest first); iteramos do índice 0 e
  // a primeira match é o playbook_executed MAIS RECENTE.
  let lastExecutedId: string | null = null;
  for (let i = 0; i < eventLog.length; i++) {
    const ev = eventLog[i] as { type?: string; data?: { selectedContentId?: unknown } };
    if (
      ev?.type === "playbook_executed" &&
      typeof ev?.data?.selectedContentId === "string" &&
      ev.data.selectedContentId.length > 0
    ) {
      lastExecutedId = ev.data.selectedContentId;
      break;
    }
  }

  // recall dispara quando há item recentemente apresentado E o scorer
  // rotacionou para outro (situação "rotacionou sem consolidar").
  // CP-recall-cooldown (v0.2.5): bloqueia recall nos primeiros RECALL_COOLDOWN_TURNS
  // turns pra evitar "recall imediato no T2" — STS realista mostrou que isso
  // gera bot retomando coisa que mal foi apresentada. Cooldown se aplica APENAS
  // a recall; close/correct continuam ativos no T1/T2 quando há signal.
  const RECALL_COOLDOWN_TURNS = 2;
  const currentTurn = typeof input.state?.turn === "number" ? input.state.turn : 0;
  const recallCooldownActive = currentTurn < RECALL_COOLDOWN_TURNS;
  const shouldRecall =
    !recallCooldownActive && lastExecutedId != null && topItem?.id !== lastExecutedId;

  // Fatia 4 (physical_world_playbook spec §5 — emergent composition):
  // Console parental seta `contextHints.compose_playbook_request=true`
  // depois de aprovar um piloto de desafio físico real. Highest priority
  // — sobrepõe close/discover/etc. Default ausente → comportamento atual.
  const composePlaybookRequested =
    input.contextHints?.["compose_playbook_request"] === true;

  let moveType: TutorialMove = "explain";
  let goal = input.incomingMessage
    ? "Trabalhar a mensagem atual do sujeito"
    : "Avançar no objetivo formativo da sessão";

  if (composePlaybookRequested) {
    moveType = "compose_playbook";
    goal = "Coletar inventário + compor desafio físico real para o sujeito";
  } else if (hasExitSignal) {
    moveType = "close";
    goal = "Fechar respeitando sinal de saída do sujeito";
  } else if (isDiscoveryStage) {
    moveType = "discover";
    goal = "Descobrir interesse via pergunta aberta sobre o sujeito";
  } else if (hasConfusionSignal) {
    moveType = "correct";
    goal = "Reformular ou simplificar — sujeito sinalizou confusão";
  } else if (shouldRecall) {
    moveType = "recall";
    goal = "Resgatar conceito já apresentado para consolidar";
  }

  const ctx: TutorialContext = {
    teaching_goal: goal.slice(0, 80),
    move_type: moveType,
  };

  // mastery_ref:
  // - recall → ancorado no item sendo recordado (lastExecutedId)
  // - outros → ancorado no top scored item (CP3 / Item 5)
  // kind="item" sempre em v0.2; "concept"/"axis" virão no Lote 2.
  // discover (v0.2.6) NÃO ancora em content_item — descoberta vem da conversa,
  // não de pool estático. mastery_ref ausente sinaliza "ainda não temos
  // sobre o quê ensinar" pro materializer + replay UI.
  const masteryTargetId =
    moveType === "discover"
      ? null
      : moveType === "recall" && lastExecutedId
        ? lastExecutedId
        : (typeof topItem?.id === "string" && topItem.id.length > 0 ? topItem.id : null);

  if (masteryTargetId) {
    ctx.mastery_ref = { kind: "item", id: masteryTargetId };
  }

  // CP6 / Items 9 + 11 — policies determinísticas por move_type.
  // advance_policy: hold_until_correct para correct/check; can_move_on
  // para recall/close (movimentos leves); hold_until_attempted para
  // explain/apply (espera tentativa antes de avançar).
  // failure_policy: simplify pra correct; re_explain pra recall/apply;
  // recheck_later pra check; undefined pra explain/close (sem falha esperada).
  // must_revisit_by_turn: turn atual + 3 quando failure_policy === recheck_later.
  // Cast widens the narrowed control-flow type back to TutorialMove para
  // permitir cases pra check/apply (que serão emitidos em v0.3).
  switch (moveType as TutorialMove) {
    case "discover":
      ctx.advance_policy = "can_move_on";
      break;
    case "explain":
      ctx.advance_policy = "hold_until_attempted";
      break;
    case "check":
      ctx.advance_policy = "hold_until_correct";
      ctx.failure_policy = "recheck_later";
      break;
    case "correct":
      ctx.advance_policy = "hold_until_correct";
      ctx.failure_policy = "simplify";
      break;
    case "apply":
      ctx.advance_policy = "hold_until_attempted";
      ctx.failure_policy = "re_explain";
      break;
    case "recall":
      ctx.advance_policy = "can_move_on";
      ctx.failure_policy = "re_explain";
      break;
    case "close":
      ctx.advance_policy = "can_move_on";
      break;
    case "compose_playbook":
      // Pode avançar sem requerer correct/attempted — a decisão de seguir
      // pra próximo step do playbook é responsabilidade do PendingChallenge
      // state machine (fatia futura), não do tutorial flow.
      ctx.advance_policy = "can_move_on";
      break;
  }

  if (ctx.failure_policy === "recheck_later") {
    const currentTurn = typeof input.state?.turn === "number" ? input.state.turn : 0;
    ctx.must_revisit_by_turn = currentTurn + 3;
  }

  // CP6 / move_alternatives — observabilidade da decisão.
  // Registra outros move_types cujas condições estavam satisfeitas mas
  // perderam por prioridade. Lê hasExitSignal/hasConfusionSignal/shouldRecall
  // computados no início desta função.
  const alternatives: TutorialMoveAlternative[] = [];
  if (moveType !== "close" && hasExitSignal) {
    alternatives.push({
      move_type: "close",
      reason: "extracted_signals contém exit_marker_*",
    });
  }
  if (moveType !== "correct" && hasConfusionSignal) {
    alternatives.push({
      move_type: "correct",
      reason: "extracted_signals contém confusion/distress/frustration",
    });
  }
  if (moveType !== "recall" && shouldRecall) {
    alternatives.push({
      move_type: "recall",
      reason: "eventLog tem playbook_executed; scorer rotacionou",
    });
  }
  if (alternatives.length > 0) {
    ctx.move_alternatives = alternatives;
  }

  return ctx;
}

/**
 * CP5 / Item 8 — linha curta por `move_type` que vai entrar em `instruction_addition`.
 *
 * O materializer já renderiza `instruction_addition` dentro do bloco
 * <instruction_addition>...</instruction_addition> do prompt (ver
 * motor-drota/src/server.ts:buildDrotaPrompt). A reação ao `move_type` é
 * implementada via esse canal — sem mudar o template estável do materializer,
 * sem invalidar o prefix caching do prompt.
 *
 * Cada linha começa com "MOVIMENTO: <verbo>." pra ser reconhecível em
 * smoke/trace/replay UI.
 */
/**
 * v0.2.7 — Tutor self-introduction modulada por idade.
 * Spec base: 2026-05-25-session-phases-journey-stages-strategist.md
 *            + decisão Alexa 2026-05-28 "primeira jogada do bot é se apresentar como tutor".
 *
 * Estrutura comum (qualquer banda):
 *  1. Identidade — "Sou um tutor"
 *  2. Diferenciação — não professor / não terapeuta / não amigo casual
 *  3. Artefato — baralho com 4 virtudes
 *  4. Convite à atividade — "vamos tentar?"
 *  5. Consent gate — "se não curtir, a gente para"
 *  6. Partnership — "escolher junto que potencial desenvolver"
 *
 * Banda etária define vocabulário + densidade, não estrutura.
 */
function buildTutorSelfIntro(age: number | undefined): string {
  const ageBand = typeof age === "number" && age > 0 ? (age < 10 ? "ludic" : age <= 14 ? "direct" : "philosophical") : "direct";

  switch (ageBand) {
    case "ludic":
      return "MOVIMENTO INAUGURAL: tutor se apresenta lúdico. Estrutura OBRIGATÓRIA (1) 'Sou um tutor — tipo um amigo que ajuda você a descobrir coisas que você é bom e que ninguém viu ainda'; (2) baralho de 4 super-poderes (virtudes); (3) convite a um JOGO com ele pra descobrir os super-poderes do sujeito; (4) 'topa tentar? se for chato a gente para'. NÃO introduza nenhum outro conceito além de tutor + baralho. Sem moralização.";
    case "philosophical":
      return "MOVIMENTO INAUGURAL: tutor se apresenta filosófico. Estrutura OBRIGATÓRIA (1) 'Sou um tutor. Tutoria é a forma mais antiga de educação que ainda funciona — alguém que te ajuda a descobrir o que você ainda não vê em si, sem currículo, sem nota'; (2) baralho de 4 virtudes — base da ética clássica, usável hoje; (3) 'a gente pode escolher junto o potencial que vale a pena desenvolver'; (4) 'topa fazer uma atividade rápida com ele? se não rolar a gente encerra'. NÃO empurre conteúdo além da auto-apresentação. Sem TED Talk.";
    case "direct":
    default:
      return "MOVIMENTO INAUGURAL: tutor se apresenta direto. Estrutura OBRIGATÓRIA (1) 'Sou um tutor. Diferente de professor: não tenho matéria pra cobrir. Diferente de terapeuta: não vou ficar te perguntando como você se sente'; (2) 'O que faço é a gente escolher junto que potencial seu vale a pena desenvolver'; (3) 'Te mandaram um baralho com 4 virtudes — tem uma atividade rápida com ele que pode mostrar onde você quer começar'; (4) 'Vamos tentar? Se você não curtir a gente para'. NÃO introduza nenhum conceito de conteúdo (animais, ciência, metáforas). Sem moralização.";
  }
}

function buildTutorialInstructionLine(tutorial: TutorialContext, ctx?: { isInaugural?: boolean; age?: number }): string {
  // v0.2.7 — quando inaugural + discover, emite self-introduction modulada por idade
  // ao invés da linha genérica de descobrir. O materializer recebe template forte
  // pra realmente fazer a apresentação correta na primeira jogada do bot.
  if (ctx?.isInaugural === true && tutorial.move_type === "discover") {
    return buildTutorSelfIntro(ctx.age);
  }
  switch (tutorial.move_type) {
    case "discover":
      return "MOVIMENTO: descobrir. NÃO introduza conteúdo novo. Faça UMA pergunta aberta sobre algo que o sujeito acabou de mencionar (ou interesse declarado). Aceite deflection sem insistir. Sem framing terapêutico.";
    case "explain":
      return "MOVIMENTO: explicar. Introduza UM conceito novo com 1 reconhecimento curto, 1 explicação ancorada e 1 pergunta de compreensão.";
    case "check":
      return "MOVIMENTO: verificar. Faça UMA pergunta curta e precisa sobre o que acabou de ser apresentado. Não introduza tema novo.";
    case "correct":
      return "MOVIMENTO: corrigir. Reformule de forma mais simples. Convide o sujeito a tentar de novo, sem pressão.";
    case "apply":
      return "MOVIMENTO: aplicar. Conecte o conceito a um caso concreto do sujeito. Pergunta de uso, exemplo ou decisão.";
    case "recall":
      return "MOVIMENTO: retomar. Resgate brevemente o conceito anterior. Cheque lembrança, sem reabrir a explicação.";
    case "close":
      return "MOVIMENTO: fechar. Uma linha do que foi trabalhado + uma linha do próximo passo. Sem reabrir tema.";
    default:
      return "";
  }
}

export function buildSystemPrompt(input: PlanTurnInput): string {
  const { persona, state, incomingMessage, contextHints } = input;

  const extractedSignals = Array.isArray(contextHints?.["extracted_signals"])
    ? (contextHints["extracted_signals"] as string[])
    : [];

  const signalsBlock = extractedSignals.length > 0
    ? `\nSINAIS DETECTADOS NO TURNO ATUAL: ${extractedSignals.join(", ")}`
    : "";

  const deflectionActive = extractedSignals.some(
    (s) =>
      s === "deflection_thematic" ||
      s === "exit_marker_implicit" ||
      s === "exit_marker_explicit",
  );
  const deflectionBlock = deflectionActive
    ? `\n⚠️ DEFLECTION ATIVO: o sujeito desviou do tema anterior. O strategicRationale DEVE reconhecer o desvio e propor tema diferente. NÃO retorne ao tema que o sujeito evitou. Em contextHints, adicione:\n  "avoid": "não retornar ao tema que o sujeito acabou de desviar",\n  "tone": "leve, sem pressão".`
    : "";

  // Sprint Pedagógico P1.1: detecta question + flagga pra planejador
  // gerar rationale ciente de que materializer DEVE responder antes de Fact.
  const questionInfo = detectQuestionInMessage(incomingMessage);
  const questionBlock = questionInfo.has_question
    ? `\n❓ PERGUNTA DIRETA DETECTADA: o sujeito fez uma pergunta. O strategicRationale DEVE prever que a resposta-bot precisa RESPONDER a pergunta (antes de qualquer Fact/Bridge). Em contextHints, adicione:\n  "question_detected": true,\n  "respond_to_question_first": true.`
    : "";

  return `Você é o Planejador do motor Ascendimacy. Seu papel é AUXILIAR de compositor:
o scoring de content items é determinístico (feito no código). Você só emite:

1. strategicRationale (≤80 chars) — 1 frase sobre o momento da sessão.
2. contextHints — dicas de composição (language, tom, avoid, etc).

SUJEITO: ${persona.name}, ${persona.age} anos.
Perfil: ${JSON.stringify(persona.profile, null, 2)}
Estado: trust=${state.trustLevel.toFixed(2)}, turn=${state.turn}, budget=${state.budgetRemaining}
Mensagem: "${incomingMessage}"${signalsBlock}${deflectionBlock}${questionBlock}

Detecte a língua do sujeito (ex: 'pt-br', 'pt-br limitado', 'pt-br basico', 'ja', 'en'). Se o perfil indica falante não-nativo (ex: japonês aprendendo pt-br), use 'pt-br limitado'.

Responda APENAS JSON COMPACTO:
{"strategicRationale":"string ≤80 chars","contextHints":{"language":"pt-br","mood":"receptive","urgency":"low"}}`;
}

interface LlmRationale {
  strategicRationale: string;
  contextHints: Record<string, unknown>;
}

function parseRationale(raw: string): LlmRationale {
  const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as {
      strategicRationale?: string;
      contextHints?: Record<string, unknown>;
    };
    return {
      strategicRationale: parsed.strategicRationale ?? "",
      contextHints: parsed.contextHints ?? {},
    };
  } catch {
    return { strategicRationale: "", contextHints: { language: "pt-br" } };
  }
}

/**
 * Se há programa ativo + assessment pronto + matrix não-pausável,
 * compõe a string instruction_addition que vai pro drota.
 * Retorna string vazia caso contrário.
 */
function buildGardnerInstruction(input: PlanTurnInput): {
  text: string;
  pauseReason?: string;
  active: boolean;
} {
  const program = input.state.gardnerProgram;
  if (!program || program.current_week === null || program.current_phase === null) {
    return { text: "", active: false };
  }
  if (program.paused) {
    return { text: "", active: false, pauseReason: program.paused_reason ?? "paused" };
  }

  // Assessment vem via persona.profile.gardner_assessment em v1 (fixture pattern).
  const profile = (input.persona.profile ?? {}) as Record<string, unknown>;
  const rawAssessment = profile["gardner_assessment"] as GardnerAssessment | undefined;
  if (!isAssessmentReady(rawAssessment)) {
    return { text: "", active: false, pauseReason: "assessment_not_ready" };
  }

  // Pausa automática se matrix sinaliza brejo afetivo.
  const matrix = input.state.statusMatrix ?? defaultMatrix();
  const pause = shouldPauseProgram(matrix);
  if (pause.paused) {
    return { text: "", active: false, pauseReason: pause.reason };
  }

  // Bloco 6: se joint, brejo UNILATERAL (parceiro) também pausa.
  if (input.state.sessionMode === "joint" && input.state.partnerStatusMatrix) {
    const partnerPause = shouldPauseProgram(input.state.partnerStatusMatrix);
    if (partnerPause.paused) {
      return { text: "", active: false, pauseReason: `partner_${partnerPause.reason}` };
    }
  }

  const pair = pairForWeek(program.current_week, rawAssessment!);
  if (!pair) return { text: "", active: false, pauseReason: "no_pair" };

  const text = composeInstructionAddition({
    week_number: program.current_week,
    day_in_week: program.current_day,
    strength_channel: pair.strength,
    weakness_channel: pair.weakness,
    phase: program.current_phase,
    multi_channel: pair.multi_channel,
  });
  return { text, active: true };
}

/**
 * Aplica parent_pinned dinâmico — se persona.profile.parent_pinned_ids incluir
 * o id do item, marca parent_pinned=true antes de scorar. Assim o scorer (Bloco 1)
 * já respeita (PARENT_PINNED_SCORE=1000 vence tudo). Plan Bloco 4 requisito (c).
 */
function applyPinnedDecisions(pool: ContentItem[], persona: PlanTurnInput["persona"]): ContentItem[] {
  const profile = (persona.profile ?? {}) as Record<string, unknown>;
  const pinnedIds = Array.isArray(profile["parent_pinned_ids"])
    ? new Set(profile["parent_pinned_ids"] as string[])
    : null;
  const rejectedIds = Array.isArray(profile["parent_rejected_ids"])
    ? new Set(profile["parent_rejected_ids"] as string[])
    : null;
  if (!pinnedIds && !rejectedIds) return pool;
  return pool
    .filter((item) => !(rejectedIds?.has(item.id)))
    .map((item) => {
      if (pinnedIds?.has(item.id)) {
        return { ...item, parent_pinned: true, pinned_until: item.pinned_until ?? null };
      }
      return item;
    });
}

export async function planTurn(
  input: PlanTurnInput,
  opts?: PlanTurnOpts,
): Promise<PlanTurnOutput> {
  const planT0 = Date.now();
  const sessionMode = input.state.sessionMode ?? "solo";

  // G-22 pool-builder integration (ops#1093) — hidratação de sacrifice context
  // ANTES de buildPool/scorePool pra que:
  //  (a) buildPool aplique HARD GATE quando budget exhausted (sub-decisão 2)
  //  (b) scorePool receba sacrifice_cost_by_id pra penalty/boost por item
  //
  // Mantém pool-builder/scorer puros — toda I/O e derivação fica no orchestrator.
  const budgetExhausted = isExhausted(input.state);
  const personaSensitivity = extractPersonaSensitivity(
    input.persona.profile as Record<string, unknown> | undefined,
  );
  const outcomeSignal = deriveOutcomeSignal(input.state.eventLog ?? []);
  const weekday = new Date().getDay();
  const cycleDay = input.state.kidsHelixState?.current_day;
  const recentUsageMap = input.state.recentContentUsage ?? {};

  // 1. Scoring determinístico do pool.
  const rawPool = loadSeedPool(seedPath());
  const withPinnedMarks = applyPinnedDecisions(rawPool, input.persona);
  const eligible = buildPool(withPinnedMarks, {
    age: input.persona.age,
    // Bloco 6: joint filtra por group_compatible (campo já existe desde 2a A.1.1)
    sessionMode: sessionMode === "joint" ? "joint" : "1v1",
    // G-22 (ops#1093 sub-decisão 2): HARD GATE em exhaustion — items com
    // sacrifice > 7 caem fora ANTES de chegar no drota. Single source of truth
    // pro threshold em sacrifice-budget.BUDGET_EXHAUSTED_MAX_SACRIFICE.
    budgetExhaustedGate: budgetExhausted,
  });

  // G-22 (ops#1093 sub-decisão 1): pre-compute sacrifice cost per eligible item
  // pra alimentar scorer. Usa contexto completo (sensitivity + outcome + weekday
  // + cycleDay + recentUsageMap) — fórmula completa motor#130. Items sem
  // sacrifice_amount caem em BASE_EFFORT_DEFAULT (mirror sacrifice-budget#358).
  const sacrificeCostById: Record<string, number> = {};
  for (const item of eligible) {
    const cost = computeChallengeCost({
      item,
      personaSensitivity,
      recentUsageCount: recentUsageMap[item.id] ?? 0,
      outcomeSignal,
      weekday,
      cycleDay,
    });
    sacrificeCostById[item.id] = cost.total;
  }

  const child = personaToChildProfile(input.persona, input.state);
  const statusMatrix = input.state.statusMatrix ?? defaultMatrix();
  const focusDim = pickFocusDimension(statusMatrix);
  const caselTargets = focusDim ? caselTargetsFor(focusDim) : [];
  // motor#23: extrai items já consumidos nesta sessão do event_log pra
  // penalizar reuso e forçar rotação (descoberta no smoke-3d-bumped onde
  // 12 calls drota selecionaram o mesmo item).
  const usedInSession: string[] = (input.state.eventLog ?? [])
    .filter((e) => e.type === "playbook_executed")
    .map((e) => {
      const data = e.data as { selectedContentId?: string | null } | undefined;
      return data?.selectedContentId;
    })
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  // C-T-10-01 (ops#999): se ASC_USE_ACTION_MENU=true, tenta lookup
  // determinístico no menu persistido ANTES de scoring. Fallback to
  // scoring se menu ausente/stale/sem items elegíveis.
  // Decay multiplicativo aplicado em items expirados (Jun 2026-05-14).
  const useActionMenu = process.env["ASC_USE_ACTION_MENU"] === "true";
  let topK: ScoredContentItem[] | null = null;
  // S-T-10-08 (ops#1069): captura source.strategic_rationale + context_hints
  // do menu pra possível skip do LLM rationale call (sub §3 abaixo).
  let menuSource: { trust_level: number; strategic_rationale?: string | null; context_hints?: Record<string, unknown> | null } | null = null;
  if (useActionMenu) {
    const menuBaseDir =
      process.env["ASC_ACTION_MENU_BASE_DIR"] ?? "fixtures/profiles";
    const menuResult = await lookupActionMenu(input.persona.id, menuBaseDir, {
      usedInSession,
      topK: TOP_K_POOL,
    });
    try {
      logDebugEvent({
        side: "motor",
        step: "plan_turn_menu_lookup",
        user_id: input.persona.id,
        motor_target: "planejador-strategist",
        session_id: input.sessionId,
        outcome: menuResult.outcome === "ok" ? "ok" : "skip",
      });
    } catch {
      // Telemetry não bloqueia.
    }
    if (menuResult.outcome === "ok" && menuResult.items.length > 0) {
      topK = menuResult.items;
      menuSource = menuResult.source ?? null;
    }
    // Fallback to scoring se menuResult.outcome !== "ok"
  }

  if (topK === null) {
    const scored = scorePool(eligible, child, {
      now: new Date().toISOString(),
      casel_focus: caselTargets[0] as ScoredContentItem["item"]["casel_target"][number] | undefined,
      used_in_session: usedInSession,
      // G-22 (ops#1093): inject sacrifice cost map → scorer aplica
      // SACRIFICE_SCORE_WEIGHT × (BASE_EFFORT - cost) per item.
      sacrifice_cost_by_id: sacrificeCostById,
    });
    topK = scored.slice(0, TOP_K_POOL);
  }

  // B2 — Drilling integration (spec 2026-05-26-b2-drilling-primer-v0.md).
  //
  // Orchestrator pre-load (drill_list_due + drill_load_bank + proposeDrillItem)
  // serializa proposal em `contextHints.drill_proposal`. Aqui só consumimos:
  // se proposal válida → inject como ScoredContentItem no topo do pool, com
  // score baseado em SR urgency (overdue dias).
  //
  // S3 ainda decide via score se cabe — drill compete no mesmo ranking, mas
  // overdue alto + DRILL_BASE_SCORE garante seleção quando o motor não tem
  // candidato mais relevante.
  const drillProposalRaw = input.contextHints?.["drill_proposal"];
  const drillProposal = drillProposalRaw
    ? deserializeDrillProposal(drillProposalRaw)
    : null;
  if (drillProposal) {
    const drillScored = drillProposalToScoredItem(
      drillProposal,
      input.persona.age,
      new Date().toISOString(),
    );
    topK = [drillScored, ...topK];
  }

  // 2. Triagem parental (Bloco 4 #17, paper §6 camada 2).
  //    Se persona.profile.parental_profile existir E estiver mínimo,
  //    passa topK pelo triageForParents (rule-based ou Haiku).
  // motor#22 + D-3-PROV (ops#1055) follow-up: gate provider-aware,
  // openai-compat (LLM local) não exige API key. Helper centralizado
  // em shared/llm-router.ts pra evitar duplicação com motor-drota.
  const useMockLlm = shouldUseMockLlm("planejador");
  const parentalProfile = extractParentalProfile(input.persona);
  let triageMode: "rule_based" | "haiku" | "skipped" = "skipped";
  let triageRejectedIds: string[] = [];
  if (isParentalProfileMinimal(parentalProfile)) {
    // motor#19: callHaiku retorna LlmCallResult; HaikuCaller espera string.
    // Wrap pra extrair só content (reasoning não é logado em Haiku hoje).
    const haikuCaller = useMockLlm
      ? undefined
      : async (sys: string, user: string) => (await callHaiku(sys, user)).content;
    const triageResult = await triageForParents(
      { pool: topK, profile: parentalProfile!, max_approved: TOP_K_POOL },
      haikuCaller,
    );
    topK = triageResult.approved;
    triageMode = triageResult.triage_mode;
    triageRejectedIds = triageResult.rejected.map((r) => r.item.id);
  }

  // 3. LLM consulta para rationale + contextHints.
  //
  // S-T-10-08 (ops#1069): se menu_hit + rationale pré-bakeado presente E
  // NÃO há brejo afetivo, SKIP do LLM call. Brejo é override absoluto —
  // context bakeado pode estar errado sobre estado emocional CORRENTE.
  //
  // Defaults Jun 2026-05-16:
  //  - Schema: source.strategic_rationale + source.context_hints opcionais
  //  - Staleness: reusa menu valid_until (sem TTL próprio)
  //  - Fallback: degrada pra LLM call original se rationale ausente
  //  - Override: brejo afetivo (shouldPauseProgram.paused) → SEMPRE LLM fresh
  const brejoActive = shouldPauseProgram(statusMatrix).paused;
  const canSkipLlmRationale =
    topK !== null &&
    menuSource?.strategic_rationale != null &&
    menuSource.strategic_rationale.length > 0 &&
    !brejoActive;

  const systemPrompt = buildSystemPrompt(input);
  const userMessage = `Emita o JSON com rationale + hints.`;
  const t0 = Date.now();
  let llmResult: LlmCallResult | null = null;
  let llmLatency = 0;
  let llmCallId: string | undefined;
  let rationale: { strategicRationale: string; contextHints: Record<string, unknown> };
  if (canSkipLlmRationale) {
    rationale = {
      strategicRationale: menuSource!.strategic_rationale!,
      contextHints: (menuSource!.context_hints ?? { language: "pt-br" }) as Record<string, unknown>,
    };
    try {
      logDebugEvent({
        side: "motor",
        step: "planejador_rationale_skipped",
        user_id: input.persona.id,
        session_id: input.sessionId,
        motor_target: "planejador-strategist",
        outcome: "ok",
      });
    } catch {
      // Telemetry não bloqueia.
    }
  } else {
    const beforeSize = opts?.collector?.size() ?? 0;
    llmResult = useMockLlm
      ? await callLlmMock(systemPrompt, userMessage)
      : await callLlm(systemPrompt, userMessage, opts);
    llmLatency = Date.now() - t0;
    // Captura llm_call_ref pro trace (se collector ativo + não-mock).
    if (opts?.collector && !useMockLlm) {
      llmCallId = opts.collector.peek()[beforeSize]?.id;
    }
    rationale = parseRationale(llmResult.content);

    // Bypass para testes/smokes quando USE_MOCK_LLM=true:
    // o mock sempre injeta {language, mood, urgency}, que sobrescreve
    // contextHints arbitrários passados pelo caller (ex: infra smokes).
    // Com o bypass, input.contextHints manda, e só injetamos o que o código
    // explicitamente adiciona depois (tutorial, helix, budget, etc).
    if (useMockLlm) {
      rationale = {
        ...rationale,
        contextHints: {},
      };
    }

    if (topK !== null && menuSource?.strategic_rationale == null) {
      // Menu hit mas rationale ausente → fallback to LLM. Log pra observability.
      try {
        logDebugEvent({
          side: "motor",
          step: "planejador_rationale_fallback",
          user_id: input.persona.id,
          session_id: input.sessionId,
          motor_target: "planejador-strategist",
          outcome: "skip",
        });
      } catch {
        // Telemetry não bloqueia.
      }
    }
  }

  // motor#19: debug log (no-op se ASC_DEBUG_MODE off)
  logDebugEvent({
    side: "motor",
    step: "planejador",
    user_id: input.persona.id,
    session_id: input.sessionId,
    turn_number: input.state.turn,
    model: process.env["PLANEJADOR_MODEL"] ?? "claude-sonnet-4-6",
    provider: "anthropic",
    tokens: llmResult?.tokens,
    latency_ms: llmLatency,
    prompt: systemPrompt + "\n\n[USER]\n" + userMessage,
    response: llmResult?.content ?? "[skipped_via_menu]",
    reasoning: llmResult?.reasoning,
    snapshots_pre: {
      planejador: {
        persona_age: input.persona.age,
        pool_pre_filter_size: rawPool.length,
        pool_post_eligibility_size: eligible.length,
        triage_mode: triageMode,
        triage_rejected_ids: triageRejectedIds,
        gardner_active: !!input.state.gardnerProgram?.current_week,
      },
    },
    snapshots_post: {
      planejador: {
        rationale: rationale.strategicRationale,
        context_hints_keys: Object.keys(rationale.contextHints),
        top_k_pool_ids: topK.slice(0, 5).map((s) => s.item.id),
      },
    },
    outcome: "ok",
  });

  // 4. Composição do mixin withGardnerProgram se ativo.
  const gardnerInstruction = buildGardnerInstruction(input);

  // 5. Injeta status_gates + casel_focus + gardner meta + triage meta em contextHints.
  // BUG-PL-01 Sprint 5: upstream hints (extracted_signals etc) têm prioridade.
  // Spread inicial preserva input.contextHints; LLM rationale e status_gates
  // layer-by-layer em cima sem sobrescrever silenciosamente.
  const contextHints: Record<string, unknown> = {
    ...(input.contextHints ?? {}),
    ...rationale.contextHints,
    status_gates: allGates(statusMatrix),
  };
  // Re-aplica keys upstream pra garantir que rationale.contextHints
  // (LLM-generated) não sobrescreva sinais do caller.
  if (input.contextHints?.["extracted_signals"]) {
    contextHints["extracted_signals"] = input.contextHints["extracted_signals"];
  }
  if (input.contextHints?.["last_user_message"]) {
    contextHints["last_user_message"] = input.contextHints["last_user_message"];
  }
  if (input.contextHints?.["recent_turns"]) {
    contextHints["recent_turns"] = input.contextHints["recent_turns"];
  }
  // Sprint Pedagógico P1.1: detecta pergunta + propaga pra materializer
  // ler em contextHints.question_detected/respond_to_question_first.
  // LLM rationale pode ter respondido também — esse re-apply é defensivo:
  // garante que a flag não some se LLM gerou hints sem question_detected.
  const questionDetect = detectQuestionInMessage(input.incomingMessage);
  if (questionDetect.has_question) {
    contextHints["question_detected"] = true;
    contextHints["question_text"] = questionDetect.question_text;
    contextHints["respond_to_question_first"] = true;
  }

  // Tutor Clássico v0.1 — contrato mínimo de movimento tutorial
  // (ver docs/specs/2026-05-28-loop-tutorial-v0.md)
  const tutorial = computeBasicTutorialContext(input, topK?.[0]?.item ?? null);
  if (tutorial) {
    contextHints["tutorial"] = tutorial;
  }

  // v0.2.8 (Discovery-Specific Pool) — quando move_type=discover, chama o
  // Discovery Agent (LLM extra) pra gerar 5 opções de pergunta aberta
  // ancoradas em sinais + tópicos mencionados + necessidades latentes.
  // Opções vão pra contextHints.discovery_options; motor-drota's pipeline
  // detecta + usa esse pool em vez do contentPool estático quando discover.
  // Cobra +1 LLM call apenas em discover turns.
  if (tutorial?.move_type === "discover") {
    const discoveryInput = {
      recentTurns: Array.isArray(input.contextHints?.["recent_turns"])
        ? (input.contextHints["recent_turns"] as Array<{ role: "user" | "assistant"; content: string }>)
        : [],
      extractedSignals: Array.isArray(input.contextHints?.["extracted_signals"])
        ? (input.contextHints["extracted_signals"] as string[])
        : [],
      latentNeeds: Array.isArray(child?.latent_needs)
        ? (child.latent_needs as string[])
        : [],
      topicMentions: Array.isArray(input.contextHints?.["topic_mentions"])
        ? (input.contextHints["topic_mentions"] as string[])
        : [],
      incomingMessage: typeof input.incomingMessage === "string" ? input.incomingMessage : undefined,
      subjectName: input.persona?.name ?? "amigo",
    };
    try {
      const discoveryOptions = await generateDiscoveryOptions(discoveryInput);
      if (discoveryOptions.length > 0) {
        contextHints["discovery_options"] = discoveryOptions;
      }
    } catch {
      // Telemetry: discovery failure não bloqueia turn — segue sem discovery_options
      // (fallback determinístico já cobre LLM crashes dentro do agent).
    }
  }

  // Fatia 4 (physical_world_playbook §5.1+5.2) — quando move_type=compose_playbook,
  // roda probe (questões de inventário) E composer (gera EmergentPlaybook) em
  // sequência. Probe primeiro: se inventário já completo, retorna [] e composer
  // usa o que tem; senão, composer roda com fallback determinístico (bolo template).
  //
  // Outputs em contextHints:
  //   - inventory_probe_options: questões que faltam perguntar
  //   - emergent_playbook: instância composta (presente sempre quando flag setado)
  //
  // Motor-drota não consome ainda (integração materializer = fatia futura). Por
  // ora é apenas wiring planejador-side validado por testes de planTurn.
  if (tutorial?.move_type === "compose_playbook") {
    const partialInventory = input.contextHints?.["subject_inventory"] as
      | Partial<SubjectInventory>
      | undefined;
    const recentTurns = Array.isArray(input.contextHints?.["recent_turns"])
      ? (input.contextHints!["recent_turns"] as Array<{ role: "user" | "assistant"; content: string }>)
      : [];
    const subjectName = input.persona?.name ?? "amigo";
    const subjectAge = typeof input.persona?.age === "number" ? input.persona.age : undefined;

    try {
      const probeInput: Parameters<typeof generateInventoryProbeQuestions>[0] = {
        recentTurns,
        subjectName,
      };
      if (subjectAge !== undefined) probeInput.subjectAge = subjectAge;
      if (partialInventory) probeInput.partial_inventory = partialInventory;
      const probeOptions = await generateInventoryProbeQuestions(probeInput);
      if (probeOptions.length > 0) {
        contextHints["inventory_probe_options"] = probeOptions;
      }
    } catch {
      // Probe failure não bloqueia composer abaixo.
    }

    try {
      // Inventário pra composer: completa partial com defaults razoáveis pra
      // permitir fallback determinístico. v0 não exige inventário completo;
      // fatia futura adiciona gate "só compõe se confidence >= 2".
      const inventoryForCompose: SubjectInventory = {
        collected_at: partialInventory?.collected_at ?? new Date().toISOString(),
        available_materials: partialInventory?.available_materials ?? [],
        available_time_minutes: partialInventory?.available_time_minutes ?? 0,
        available_budget_cents: partialInventory?.available_budget_cents ?? 0,
        family_present: partialInventory?.family_present ?? [],
        aspirational_wishlist: partialInventory?.aspirational_wishlist ?? [],
        confidence: partialInventory?.confidence ?? 0,
      };
      const currentObjectives = Array.isArray(input.contextHints?.["playbook_objectives"])
        ? (input.contextHints!["playbook_objectives"] as readonly EmergentVirtueTarget[])
        : [];
      const playbookInput: Parameters<typeof composePlaybook>[0] = {
        inventory: inventoryForCompose,
        active_axes: Array.isArray(input.contextHints?.["axes_active"])
          ? (input.contextHints!["axes_active"] as readonly string[])
          : [],
        current_objectives: currentObjectives,
        subject_name: subjectName,
      };
      if (subjectAge !== undefined) playbookInput.subject_age = subjectAge;
      const playbook = await composePlaybook(playbookInput);
      contextHints["emergent_playbook"] = playbook;
    } catch {
      // Composer failure não bloqueia turn — segue sem playbook.
    }
  }

  // CP5 / Item 8 — instruction_addition recebe linha curta por move_type.
  // Materializer já consome instruction_addition; muda comportamento sem
  // tocar no template do prompt nem no prefix cache.
  // v0.2.7 — isInaugural = state.turn === 0 (primeiro turn da sessão).
  // age vem do persona pra modulação dos templates de auto-apresentação.
  const tutorialInstructionLine = tutorial
    ? buildTutorialInstructionLine(tutorial, {
        isInaugural: typeof input.state?.turn === "number" && input.state.turn === 0,
        age: typeof input.persona?.age === "number" ? input.persona.age : undefined,
      })
    : "";
  const instructionAddition = [gardnerInstruction.text, tutorialInstructionLine]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
  if (focusDim) {
    contextHints["casel_focus_dimension"] = focusDim;
    contextHints["casel_focus_targets"] = caselTargets;
  }
  if (input.state.gardnerProgram?.current_week) {
    contextHints["gardner_program_active"] = gardnerInstruction.active;
    contextHints["gardner_current_week"] = input.state.gardnerProgram.current_week;
    if (gardnerInstruction.pauseReason) {
      contextHints["gardner_pause_reason"] = gardnerInstruction.pauseReason;
    }
  }

  // G-05 (ops#1091) — Double Helix cycle context.
  // Injeta active_pair + cycle_progress + previous_pair pro drota
  // entender em qual par de dims CASEL ancorar. Também serve ops#1020 G-07
  // downstream (50%/100% triggers consomem cycle_progress).
  //
  // Hidratação é responsabilidade de motor-execucao (kids_helix_state repo).
  // Se persona não tem state ainda (bootstrap pendente), helix block ausente
  // — drota usa fallback CASEL via casel_focus_dimension (gate antigo).
  const helixState = input.state.kidsHelixState;
  if (helixState) {
    contextHints["helix_active_pair"] = [...helixState.active_pair];
    contextHints["helix_cycle_progress"] = cycleProgress(helixState);
    contextHints["helix_cycle_day"] = helixState.current_day;
    contextHints["helix_mode"] = helixState.mode;
    contextHints["helix_cycles_completed"] = helixState.cycles_completed;
    if (helixState.previous_pair) {
      contextHints["helix_previous_pair"] = [...helixState.previous_pair];
    }
    if (helixState.mode === "vacation" && helixState.vacation_trigger) {
      contextHints["helix_vacation_trigger"] = helixState.vacation_trigger;
    }
    if (helixState.deferred.length > 0) {
      contextHints["helix_deferred_dims"] = [...helixState.deferred];
    }

    // G-07 (ops#1020, ratified GO C 2026-05-16) — Cadência 18d triggers.
    //
    // - `helix_active_cycle_progress` (0..1 over 14d active phase) — semântica
    //   pedagógica do canon CLAUDE_6 §5.2. `helix_cycle_progress` (total 18d)
    //   acima fica preservado pra audit/UI.
    // - `helix_pending_triggers` — drota sabe se deve emitir retrieval/boss-fight
    //   neste turn. Orchestrator é quem chama `markTriggerFired` após observar.
    // - `helix_midcycle_assessment` — quando midcycle_assessment_7 pendente,
    //   injeta evolution_percentage + extension_recommendation pra parent layer.
    //
    // NÃO mutamos state aqui (plan é puro read); markTriggerFired é
    // responsabilidade do orchestrator pós-turn. Este bloco apenas SURFACE
    // sinais — gap honesto que orchestrator wire-up vem em G-06 downstream.
    contextHints["helix_active_cycle_progress"] = activeCycleProgress(helixState);

    const pendingTriggers = detectCadenceTriggers(helixState);
    if (pendingTriggers.length > 0) {
      contextHints["helix_pending_triggers"] = pendingTriggers;

      if (pendingTriggers.includes("midcycle_assessment_7")) {
        const evolution = computeEvolutionAssessment({
          state: helixState,
          statusMatrix: input.state.statusMatrix as
            | Record<string, string>
            | undefined,
          // Dreyfus baseline/observed hooks ficam pra G-21 (sprint review)
          // ou child-profile expansion downstream — gap honesto F0.
        });
        const extension = assessCycleExtension({
          state: helixState,
          evolutionPercentage: evolution,
          statusMatrix: input.state.statusMatrix as
            | Record<string, string>
            | undefined,
        });
        contextHints["helix_midcycle_assessment"] = {
          evolution_percentage: Number(evolution.toFixed(4)),
          extension_recommendation: extension.recommendation,
          reasons: extension.reasons,
        };
      }
    }
  }

  if (triageMode !== "skipped") {
    contextHints["parental_triage_mode"] = triageMode;
    if (triageRejectedIds.length > 0) {
      contextHints["parental_triage_rejected_ids"] = triageRejectedIds;
    }
  }

  // Bloco 6: joint-mode hints + brejo unilateral pause signal.
  if (sessionMode === "joint") {
    contextHints["session_mode"] = "joint";
    if (input.state.jointPartnerName) {
      contextHints["joint_partner_name"] = input.state.jointPartnerName;
    }
    if (input.state.jointPartnerChildId) {
      contextHints["joint_partner_child_id"] = input.state.jointPartnerChildId;
    }
    if (input.state.partnerStatusMatrix) {
      const partnerPause = shouldPauseProgram(input.state.partnerStatusMatrix);
      if (partnerPause.paused) {
        contextHints["joint_unilateral_brejo"] = true;
        contextHints["joint_pause_reason"] = `partner_${partnerPause.reason}`;
      }
      contextHints["partner_status_gates"] = allGates(input.state.partnerStatusMatrix);
    }
  }

  // G-22 (ops#1033) — sacrifice fórmula COMPLETA pós Jun ratify B + remaining
  // gaps (5+6+7+10). CC defaults inline aguardando ratify.
  //
  // - Gap 1+2+3+4 (motor#124): base × consumption × sensitivity × challenge
  // - Gap 5 (motor#130): outcome_mult derivado de eventLog (feedback_signal)
  // - Gap 6 (motor#130): weekly_mult via Date.getDay() canon onda semanal
  // - Gap 7 (motor#130): cycle_mult via kidsHelixState.current_day canon onda ciclo
  // - Gap 8 (motor#124): budget exhaustion soft degrade
  // - Gap 9 (motor#124): trust ratio prazer/sacrifice
  // - Gap 10 (motor#130): clamp [MIN_SINGLE_ITEM_COST, MAX_SINGLE_ITEM_COST]
  //
  // ops#1093 (este PR) — pool-builder loop:
  //   * personaSensitivity / outcomeSignal / weekday / cycleDay /
  //     recentUsageMap / budgetExhausted JÁ derivados no topo (linhas 197-211)
  //     pra alimentar buildPool (hard gate) + scorePool (cost penalty).
  //   * Re-uso aqui é só pra observability hints — mesmas refs.
  const trustRatio = computeTrustRatio(input.state.trustLevel);
  contextHints["prazer_sacrifice_ratio"] = {
    prazer_quota: Number(trustRatio.prazerQuota.toFixed(4)),
    sacrifice_quota: Number(trustRatio.sacrificeQuota.toFixed(4)),
  };

  if (budgetExhausted) {
    // Pós ops#1093 hard gate em buildPool, todo item que chegou no topK já
    // passou o filtro `isItemAllowedUnderBudgetExhaustion`. Mantém allowedIds
    // pra backward compat com consumers que leem contextHints diretamente
    // (drota fallback signal — defesa em profundidade).
    const allowedIds = topK
      .filter((s) => isItemAllowedUnderBudgetExhaustion(s.item))
      .map((s) => s.item.id);
    contextHints["budget_state"] = "exhausted_soft_degrade";
    contextHints["budget_exhausted_allowed_ids"] = allowedIds;
    contextHints["budget_exhausted_gate_applied"] = true;
    try {
      logDebugEvent({
        side: "motor",
        step: "budget_exhausted_soft_degrade",
        user_id: input.persona.id,
        session_id: input.sessionId,
        motor_target: "planejador-strategist",
        outcome: "ok",
        snapshots_post: {
          budget: {
            budget_remaining: input.state.budgetRemaining,
            allowed_ids_count: allowedIds.length,
            top_k_count: topK.length,
            // ops#1093: registra que o gate foi aplicado em buildPool.
            gate_applied_at: "pool-builder",
          },
        },
      });
    } catch {
      // Telemetry não bloqueia.
    }
  } else {
    contextHints["budget_state"] = "ok";
  }

  // G-22 breakdown completo — top-K cost preview (observability; não modifica scoring).
  // ops#1093: reusa sacrificeCostById quando possível pra economizar chamada;
  // mas isaLabels.intensity (de ActionMenu) altera o cost pra alguns items,
  // então faz re-compute pro top-K pra capturar intensity quando presente.
  const sacrificeBreakdown = topK.slice(0, 5).map((s) => {
    const cost = computeChallengeCost({
      item: s.item,
      personaSensitivity,
      intensity: s.isaLabels?.intensity,
      recentUsageCount: recentUsageMap[s.item.id] ?? 0,
      outcomeSignal,
      weekday,
      cycleDay,
    });
    return {
      id: s.item.id,
      base_effort: cost.baseEffort,
      consumption_mult: Number(cost.consumptionMult.toFixed(4)),
      sensitivity_mult: cost.sensitivityMult,
      challenge_mult: cost.challengeMult,
      outcome_mult: cost.outcomeMult,
      weekly_mult: cost.weeklyMult,
      cycle_mult: cost.cycleMult,
      raw_total: Number(cost.rawTotal.toFixed(4)),
      total: Number(cost.total.toFixed(4)),
      bounded: cost.bounded,
    };
  });
  contextHints["sacrifice_breakdown"] = sacrificeBreakdown;
  contextHints["persona_sensitivity"] = personaSensitivity;
  contextHints["sacrifice_context"] = {
    outcome_signal: outcomeSignal,
    weekday,
    cycle_day: cycleDay ?? null,
    recent_usage_keys: Object.keys(recentUsageMap).length,
  };

  // motor#25 (handoff #24 Tarefa 1): slim pool antes do drota.
  // Filtra used_in_session (score≤0) + char budget 2000.
  const slimPool = slicePoolForDrota(topK, {
    maxItems: 7,
    maxTotalChars: 2000,
    excludeUsedInSession: true,
  });

  // ops#1068 — repetition_inquiry decision (Jun ratificado 2026-05-14).
  // Conjunção (i)-(vii); drota só pergunta quando todas valem.
  // Brejo afetivo é override absoluto (sub-decisão 8 §vi).
  //
  // eligiblePoolIds usa `eligible` (post-age/joint filter, PRÉ-scoring/slim).
  // slimPool exclui items used-in-session via score≤0 — exatamente os items
  // que faria sentido perguntar "quer de novo?". Paradoxo descoberto em smoke
  // E2E (ops#1068 follow-up #4): sem eligible, candidate_ids ficava sempre
  // vazio e contextHints.repetition_inquiry nunca era injetado.
  // Sub-decisão 6 ("expirados fora de (a)") cobre cooldown_expired separadamente.
  const inquiryEventLog = (input.state.eventLog ?? []) as ReadonlyArray<EventEntry>;
  const inquiryProfileConfig = extractProfileConfig(
    input.persona.profile as Record<string, unknown> | undefined,
  );
  const inquiryRepetitionCounts = extractRepetitionCounts(inquiryEventLog);
  const inquiryBrejoActive = shouldPauseProgram(statusMatrix).paused;
  const inquiryDecision = shouldAskRepetitionInquiry({
    profileConfig: inquiryProfileConfig,
    repetitionCounts: inquiryRepetitionCounts,
    turn: input.state.turn ?? 0,
    sessionMode,
    brejoActive: inquiryBrejoActive,
    inquiriesThisSession: countInquiriesInSession(inquiryEventLog),
    turnsSinceLastInquiry: turnsSinceLastInquiry(inquiryEventLog),
    eligiblePoolIds: eligible.map((item) => item.id),
  });
  if (inquiryDecision.ask) {
    contextHints["repetition_inquiry"] = {
      candidate_ids: inquiryDecision.candidateIds,
      threshold_used: inquiryDecision.thresholdUsed,
      default_on_skip: inquiryDecision.defaultOnSkip,
    };
  } else if (inquiryDecision.suppressedReason) {
    contextHints["repetition_inquiry_suppressed"] = inquiryDecision.suppressedReason;
  }

  // motor#25 (handoff #25 B4): Trigger Evaluator — avalia transitions.yaml
  // contra signals capturados nos últimos 5 turns.
  // v0 (flag OFF): orchestrator só loga events transition_evaluated.
  // v1 (flag ON, ARCHITECTURE.md §S5): resultados fired ganham
  //   `closed_loop_action` declarativo; orchestrator chama
  //   `apply_status_transition` em motor-execucao pra mover statusMatrix.
  const profileId = inferProfileId(input.persona);
  const eventLog = (input.state.eventLog ?? []) as Array<{
    type: string;
    data: Record<string, unknown>;
  }>;
  const recentSignals = collectRecentSignals(eventLog, 5);
  const recentSignalsPerTurn = collectRecentSignalsPerTurn(eventLog, 5);
  const turnsSinceLastTransition = countTurnsSinceLastTransition(eventLog);
  const rawTransitionEvaluations =
    recentSignals.length > 0
      ? evaluateAllTransitions(
          profileId,
          recentSignals,
          turnsSinceLastTransition,
          recentSignalsPerTurn,
        )
      : [];
  const transitionEvaluations = enrichWithClosedLoopActions(
    rawTransitionEvaluations,
    focusDim,
  );
  const criticalDetection = detectCritical(recentSignals);

  // Fase 8 PR — Strategist context (sub-PR pós tracer bullet):
  // Propaga subject_proposed + latent_needs do ChildScoringProfile pro
  // contextHints, pra motor-drota's composeStrategyPlan consumir quando
  // journey_stage = applied_double_helix. Sem isso, Strategist v1 retorna
  // null e ponte tripla não tem norte.
  if (child.subject_proposed) {
    contextHints["subject_proposed"] = child.subject_proposed;
  }
  if (child.latent_needs && child.latent_needs.length > 0) {
    contextHints["latent_needs"] = child.latent_needs;
  }

  // ops#1152 S1: milestone detector V0 rule-based (sem LLM).
  // Detecta no incomingMessage + recentSignals; propaga via contextHints
  // pra executor.ts logar como "milestone_detected" event no event_log.
  const milestone = detectMilestone(input.incomingMessage, recentSignals, input.persona.id);
  if (milestone) {
    contextHints["milestone_detected"] = milestone;
  }

  // motor#25 (handoff #25 B5): Shannon entropy do candidate set antes de retornar.
  const candidateSetEntropy = shannonEntropy(slimPool.map((s) => s.item.id));

  const planTrace: PlanejadorTrace | undefined = opts?.collector
    ? {
        inputs: {},
        outputs: {
          contentPool: slimPool.map((s) => ({
            item: { id: s.item.id, type: s.item.type, domain: s.item.domain },
            score: s.score,
            reasons: s.reasons,
          })),
          contextHints,
          instruction_addition: instructionAddition,
          strategicRationale: rationale.strategicRationale,
          candidateSetEntropy,
        },
        ...(llmCallId !== undefined ? { llm_call_ref: llmCallId } : {}),
        duration_ms: Date.now() - planT0,
      }
    : undefined;

  return {
    strategicRationale: rationale.strategicRationale,
    contentPool: slimPool,
    contextHints,
    instruction_addition: instructionAddition,
    transitionEvaluations: transitionEvaluations.length > 0 ? transitionEvaluations : undefined,
    candidateSetEntropy,
    is_critical: criticalDetection.is_critical,
    ...(criticalDetection.critical_reason ? { critical_reason: criticalDetection.critical_reason } : {}),
    ...(planTrace ? { _trace: planTrace } : {}),
  };
}

/**
 * motor#25 — infere profileId pra Trigger Evaluator carregar transitions.yaml.
 * v0: hard-coded "kids" (único perfil com transitions.yaml committed).
 * Pós-piloto: persona.profile pode ter campo `profile_id` explícito.
 */
function inferProfileId(persona: PlanTurnInput["persona"]): string {
  const profile = (persona.profile ?? {}) as Record<string, unknown>;
  const explicit = profile["profile_id"];
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  return "kids";
}

/**
 * motor#25 — conta turns desde último transition_evaluated event tipo "fired".
 * Se nenhum, retorna o total de turns (assume estado inicial).
 */
function countTurnsSinceLastTransition(
  eventLog: Array<{ type: string; data: Record<string, unknown> }>,
): number {
  let count = 0;
  for (let i = eventLog.length - 1; i >= 0; i--) {
    const ev = eventLog[i]!;
    if (ev.type === "transition_evaluated") {
      const data = ev.data as { fired?: boolean };
      if (data.fired) return count;
    }
    if (ev.type === "playbook_executed") count++;
  }
  return count;
}

/**
 * motor#25 (handoff #25 B5) — Shannon entropy de uma lista de strings.
 * H(X) = -Σ p(x) * log2(p(x)). 0 = todos iguais; max = log2(n) com tudo único.
 *
 * Usado pra detectar "carrossel": se entropy baixa nos turns sucessivos =
 * pool repetitivo. Read-only — só registra em event pra MotorOps.
 */
export function shannonEntropy(values: string[]): number {
  if (values.length <= 1) return 0;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const total = values.length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Extrai `parental_profile` da persona (fixture pattern v1). */
function extractParentalProfile(persona: PlanTurnInput["persona"]): ParentalProfile | undefined {
  const profile = (persona.profile ?? {}) as Record<string, unknown>;
  const raw = profile["parental_profile"];
  if (!raw || typeof raw !== "object") return undefined;
  return raw as ParentalProfile;
}

/** Exposto para testes. */
export { buildGardnerInstruction, extractParentalProfile };
