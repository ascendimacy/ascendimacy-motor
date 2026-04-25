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
  getProviderForStep,
} from "@ascendimacy/shared";
import { callLlm, callLlmMock, callHaiku } from "./llm-client.js";
import { loadSeedPool, buildPool } from "./pool-builder.js";
import { personaToChildProfile } from "./child-profile.js";

/** Quantos items do pool passamos ao drota (top-K). */
export const TOP_K_POOL = 5;

/** Caminho do seed pode ser sobrescrito via env para testes. */
function seedPath(): string | undefined {
  return process.env["CONTENT_SEED_PATH"];
}

function buildSystemPrompt(input: PlanTurnInput): string {
  const { persona, state, incomingMessage } = input;
  return `Você é o Planejador do motor Ascendimacy. Seu papel é AUXILIAR de compositor:
o scoring de content items é determinístico (feito no código). Você só emite:

1. strategicRationale (≤80 chars) — 1 frase sobre o momento da sessão.
2. contextHints — dicas de composição (language, tom, avoid, etc).

SUJEITO: ${persona.name}, ${persona.age} anos.
Perfil: ${JSON.stringify(persona.profile, null, 2)}
Estado: trust=${state.trustLevel.toFixed(2)}, turn=${state.turn}, budget=${state.budgetRemaining}
Mensagem: "${incomingMessage}"

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

export async function planTurn(input: PlanTurnInput): Promise<PlanTurnOutput> {
  const sessionMode = input.state.sessionMode ?? "solo";
  // 1. Scoring determinístico do pool.
  const rawPool = loadSeedPool(seedPath());
  const withPinnedMarks = applyPinnedDecisions(rawPool, input.persona);
  const eligible = buildPool(withPinnedMarks, {
    age: input.persona.age,
    // Bloco 6: joint filtra por group_compatible (campo já existe desde 2a A.1.1)
    sessionMode: sessionMode === "joint" ? "joint" : "1v1",
  });
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
  const scored = scorePool(eligible, child, {
    now: new Date().toISOString(),
    casel_focus: caselTargets[0] as ScoredContentItem["item"]["casel_target"][number] | undefined,
    used_in_session: usedInSession,
  });
  let topK = scored.slice(0, TOP_K_POOL);

  // 2. Triagem parental (Bloco 4 #17, paper §6 camada 2).
  //    Se persona.profile.parental_profile existir E estiver mínimo,
  //    passa topK pelo triageForParents (rule-based ou Haiku).
  // motor#22: provider-aware mock detection — antes era hardcoded
  // !ANTHROPIC_API_KEY (legacy pré-router motor#21). Agora checa a key
  // do provider efetivamente configurado pra este step.
  const planejadorProvider = getProviderForStep("planejador");
  const planejadorKeyMissing = planejadorProvider === "anthropic"
    ? !process.env["ANTHROPIC_API_KEY"]
    : !process.env["INFOMANIAK_API_KEY"];
  const useMockLlm =
    process.env["USE_MOCK_LLM"] === "true" || planejadorKeyMissing;
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
  const systemPrompt = buildSystemPrompt(input);
  const userMessage = `Emita o JSON com rationale + hints.`;
  const t0 = Date.now();
  const llmResult = useMockLlm
    ? await callLlmMock(systemPrompt, userMessage)
    : await callLlm(systemPrompt, userMessage);
  const llmLatency = Date.now() - t0;
  const rationale = parseRationale(llmResult.content);

  // motor#19: debug log (no-op se ASC_DEBUG_MODE off)
  logDebugEvent({
    side: "motor",
    step: "planejador",
    user_id: input.persona.id,
    session_id: input.sessionId,
    turn_number: input.state.turn,
    model: process.env["PLANEJADOR_MODEL"] ?? "claude-sonnet-4-6",
    provider: "anthropic",
    tokens: llmResult.tokens,
    latency_ms: llmLatency,
    prompt: systemPrompt + "\n\n[USER]\n" + userMessage,
    response: llmResult.content,
    reasoning: llmResult.reasoning,
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
  const contextHints: Record<string, unknown> = {
    ...rationale.contextHints,
    status_gates: allGates(statusMatrix),
  };
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

  return {
    strategicRationale: rationale.strategicRationale,
    contentPool: topK,
    contextHints,
    instruction_addition: gardnerInstruction.text,
  };
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
