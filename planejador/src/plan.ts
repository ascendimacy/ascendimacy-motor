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
} from "@ascendimacy/shared";
import { callLlm, callLlmMock } from "./llm-client.js";
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

export async function planTurn(input: PlanTurnInput): Promise<PlanTurnOutput> {
  // 1. Scoring determinístico do pool.
  const rawPool = loadSeedPool(seedPath());
  const eligible = buildPool(rawPool, {
    age: input.persona.age,
    sessionMode: "1v1", // Bloco 6 adotará 'joint' para dyad
  });
  const child = personaToChildProfile(input.persona, input.state);
  const statusMatrix = input.state.statusMatrix ?? defaultMatrix();
  const focusDim = pickFocusDimension(statusMatrix);
  const caselTargets = focusDim ? caselTargetsFor(focusDim) : [];
  const scored = scorePool(eligible, child, {
    now: new Date().toISOString(),
    casel_focus: caselTargets[0] as ScoredContentItem["item"]["casel_target"][number] | undefined,
  });
  const topK = scored.slice(0, TOP_K_POOL);

  // 2. LLM consulta para rationale + contextHints.
  const useMock =
    process.env["USE_MOCK_LLM"] === "true" ||
    !process.env["ANTHROPIC_API_KEY"];
  const systemPrompt = buildSystemPrompt(input);
  const userMessage = `Emita o JSON com rationale + hints.`;
  const raw = useMock
    ? await callLlmMock(systemPrompt, userMessage)
    : await callLlm(systemPrompt, userMessage);
  const rationale = parseRationale(raw);

  // 3. Composição do mixin withGardnerProgram se ativo.
  const gardnerInstruction = buildGardnerInstruction(input);

  // 4. Injeta status_gates + casel_focus + gardner meta em contextHints.
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

  return {
    strategicRationale: rationale.strategicRationale,
    contentPool: topK,
    contextHints,
    instruction_addition: gardnerInstruction.text,
  };
}

/** Exposto para testes. */
export { buildGardnerInstruction };
