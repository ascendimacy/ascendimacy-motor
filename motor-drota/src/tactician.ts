/**
 * Tactician (S4) — decide a jogada dentro do Motor Drota.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-s4-separacao-decide-gera-v0.md
 *
 * Pipeline híbrido (default da spec):
 *   1. Heurísticas rule-based cobrem ~50% dos turns (distress / question +
 *      card / frame_synthesis / arena keywords no strategicRationale).
 *   2. Haiku 1-shot fallback nos turns ambíguos (JSON estruturado, vocab
 *      restrito a 6 jogadas).
 *   3. Fallback degradado se Haiku falha: bridge se houver card no pool,
 *      espelho caso contrário.
 *
 * Saída sempre satisfaz `TacticDecisionSchema` (Zod). Speaker pode confiar.
 *
 * Re-uso de "step" no llm-router: usamos "unified-assessor" pra rotear
 * pra Haiku Anthropic. Step dedicado pode ser adicionado quando o
 * Tactician estabilizar.
 */

import {
  callGateway,
  callGatewayWithTracing,
  JOGADA_VALUES,
  parseTacticDecision,
} from "@ascendimacy/shared";
import type {
  EngagementLevel,
  LlmTraceCollector,
  ScoredContentItem,
  TacticDecision,
  TacticianTrace,
  Jogada,
  Register,
} from "@ascendimacy/shared";

// ─────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────

export interface TacticianInput {
  contentPool: ScoredContentItem[];
  contextHints: Record<string, unknown>;
  strategicRationale: string;
  candidateSetEntropy?: number;
  /** Signals canônicos do unified-assessor (pode conter "distress_marker_*",
   *  "frame_synthesis", "deflection_*", etc.). Caller passa diretamente
   *  pra evitar duplo unpack do contextHints. */
  signals: string[];
  /** Mood 1-10 do unified-assessor. */
  mood: number;
  /** Engagement do unified-assessor — usado pra derivar register. */
  engagement?: EngagementLevel;
  /** Run id pra trace. */
  run_id?: string;
}

export interface TacticianOpts {
  collector?: LlmTraceCollector;
}

export interface TacticianResult {
  decision: TacticDecision;
  method: "rule" | "llm" | "fallback";
  latency_ms: number;
  /** Trace section opcional — populada quando opts.collector presente. */
  _trace?: TacticianTrace;
}

// ─────────────────────────────────────────────────────────────────────────
// Heurísticas determinísticas
// ─────────────────────────────────────────────────────────────────────────

const ARENA_KEYWORDS = /\b(confront|pol[êe]mic|debate|disput)/i;
const QUESTION_SIGNAL = "question_detected";

function deriveRegister(mood: number, engagement?: EngagementLevel): Register {
  if (mood <= 3) return "acolhedor";
  if (engagement === "disengaging") return "acolhedor";
  if (mood >= 8) return "lúdico";
  if (engagement === "high") return "lúdico";
  return "neutro";
}

function deriveMaxLength(item: ScoredContentItem["item"] | undefined): number {
  if (!item) return 280;
  // type-based cap conservador
  if (item.type === "curiosity_hook") return 240;
  if (item.type === "card_catalog") return 280;
  return 320;
}

function buildConstraints(
  input: TacticianInput,
  item: ScoredContentItem["item"] | undefined,
  jogada: Jogada,
): TacticDecision["constraints"] {
  const avoidHint = input.contextHints["avoid"];
  const avoid: string[] = Array.isArray(avoidHint)
    ? (avoidHint as unknown[]).map((x) => String(x))
    : typeof avoidHint === "string"
      ? [avoidHint]
      : [];
  const register = deriveRegister(input.mood, input.engagement);
  // recovery força tom acolhedor independente de mood/engagement
  const finalRegister: Register = jogada === "recovery" ? "acolhedor" : register;
  return {
    avoid,
    register: finalRegister,
    max_length_chars: deriveMaxLength(item),
  };
}

function firstItemId(pool: ScoredContentItem[]): string {
  return pool[0]?.item.id ?? "__empty_pool__";
}

function targetAxisFromItem(
  item: ScoredContentItem["item"] | undefined,
): string | undefined {
  if (!item) return undefined;
  const casel = item.casel_target;
  if (Array.isArray(casel) && casel.length > 0) return casel[0];
  return undefined;
}

interface RuleResult {
  jogada: Jogada;
  selected_item_id: string;
  angle: string;
  rationale: string;
  target_axis?: string;
  fallback_jogada?: Jogada;
}

/**
 * Aplica heurísticas determinísticas. Retorna null quando nenhuma regra
 * dispara (caller usa LLM ou fallback).
 */
export function tacticianByRules(input: TacticianInput): RuleResult | null {
  const pool = input.contentPool;
  const head = pool[0]?.item;
  const signals = input.signals;
  const sigHasDistress = signals.some((s) => s.includes("distress"));

  // 1. Distress / mood crítico → recovery
  if (sigHasDistress || input.mood <= 2) {
    return {
      jogada: "recovery",
      selected_item_id: firstItemId(pool),
      angle: "reconhece sem perguntar; abre espaço pra silêncio.",
      rationale: "rule: signal/mood indica distress — recuar sem pressão.",
      ...(head ? { target_axis: targetAxisFromItem(head) ?? undefined } : {}),
      fallback_jogada: "espelho",
    };
  }

  // 2. Question detected + card → bridge
  // ContentItem.type "card_catalog" é o card pedagógico canônico do pool.
  if (signals.includes(QUESTION_SIGNAL) && head?.type === "card_catalog") {
    return {
      jogada: "bridge",
      selected_item_id: head.id,
      angle: "pega a pergunta dele e leva ao card como ponte.",
      rationale: "rule: pergunta explícita + card disponível → bridge.",
      ...(targetAxisFromItem(head) ? { target_axis: targetAxisFromItem(head)! } : {}),
      fallback_jogada: "espelho",
    };
  }

  // 3. Frame synthesis → diamante
  if (signals.includes("frame_synthesis")) {
    return {
      jogada: "diamante",
      selected_item_id: firstItemId(pool),
      angle: "amplifica a síntese do sujeito sem reduzir ao didático.",
      rationale: "rule: frame_synthesis presente — momento de diamante.",
      ...(head && targetAxisFromItem(head)
        ? { target_axis: targetAxisFromItem(head)! }
        : {}),
      fallback_jogada: "espelho",
    };
  }

  // 4. Confronto/polemica no strategicRationale → arena
  if (ARENA_KEYWORDS.test(input.strategicRationale)) {
    return {
      jogada: "arena",
      selected_item_id: firstItemId(pool),
      angle: "entra firme no contraponto sem invalidar.",
      rationale: "rule: strategicRationale sinaliza arena/polêmica.",
      ...(head && targetAxisFromItem(head)
        ? { target_axis: targetAxisFromItem(head)! }
        : {}),
      fallback_jogada: "espelho",
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// LLM fallback (Haiku via gateway, step "unified-assessor")
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você decide a JOGADA tática para um turn de acompanhamento pedagógico.
Retorne APENAS JSON válido, sem markdown, sem explicação.

Vocabulário fixo de jogadas (use EXATAMENTE uma):
- bridge: amarra mensagem do sujeito ao conteúdo escolhido.
- espelho: reflete sem propor; valida.
- canal: abre canal latente do sujeito sem fechar tema.
- diamante: amplifica síntese/insight do sujeito.
- arena: entra firme em contraponto/polêmica.
- recovery: recua, acolhe, sem perguntar.

Schema obrigatório:
{
  "jogada": "<bridge|espelho|canal|diamante|arena|recovery>",
  "selected_item_id": "<id de um item do pool>",
  "target_axis": "<opcional, virtude/CASEL/helix em foco>",
  "angle": "<≤80 chars, como o speaker entra>",
  "constraints": {
    "avoid": [<lista de strings>],
    "must_include": "<opcional>",
    "register": "<neutro|lúdico|firme|acolhedor>",
    "max_length_chars": <int>
  },
  "rationale": "<≤140 chars, por que essa jogada agora>",
  "fallback_jogada": "<opcional, jogada alternativa se speaker falhar>"
}

Regras:
- Se mood ≤ 3 ou signals contêm distress → jogada=recovery, register=acolhedor.
- Sempre escolha um selected_item_id que EXISTE no pool fornecido.
- rationale ≤ 140 chars. angle ≤ 80 chars.`;

interface LlmJsonOutput {
  jogada: string;
  selected_item_id: string;
  target_axis?: string;
  angle?: string;
  constraints?: {
    avoid?: unknown;
    must_include?: string;
    register?: string;
    max_length_chars?: number;
  };
  rationale?: string;
  fallback_jogada?: string;
}

function buildLlmUserMessage(input: TacticianInput): string {
  const poolLines = input.contentPool.slice(0, 5).map((c) => {
    const i = c.item as { id: string; type: string; domain: string; fact?: string };
    const fact = (i.fact ?? "").slice(0, 80);
    return `- id=${i.id} | type=${i.type} | domain=${i.domain}${fact ? ` | fact="${fact}"` : ""}`;
  });
  return `MOOD: ${input.mood}/10
ENGAGEMENT: ${input.engagement ?? "medium"}
SIGNALS: ${input.signals.join(", ") || "(nenhum)"}
STRATEGIC_RATIONALE: ${input.strategicRationale.slice(0, 200)}

POOL (top ${poolLines.length}):
${poolLines.join("\n") || "(vazio)"}

Responda em JSON.`;
}

function parseJsonResponse(text: string): LlmJsonOutput | null {
  try {
    const cleaned = text
      .replace(/```(?:json)?\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as LlmJsonOutput;
  } catch {
    return null;
  }
}

async function tacticianByLlm(
  input: TacticianInput,
  collector?: LlmTraceCollector,
): Promise<{ decision: TacticDecision; latency_ms: number; llmCallId?: string } | null> {
  const t0 = Date.now();
  try {
    const req = {
      step: "unified-assessor",
      systemPrompt: SYSTEM_PROMPT,
      userMessage: buildLlmUserMessage(input),
      maxTokens: 256,
      run_id: input.run_id,
    };
    const beforeSize = collector?.size() ?? 0;
    const out = collector
      ? await callGatewayWithTracing(req, "tactician", collector)
      : await callGateway(req);
    const parsed = parseJsonResponse(out.content);
    if (!parsed) return null;

    // Sanitize: jogada deve estar no vocabulário; selected_item_id deve estar
    // no pool (se não, força para head).
    const jogada = (JOGADA_VALUES as readonly string[]).includes(parsed.jogada)
      ? (parsed.jogada as Jogada)
      : "espelho";
    const poolIds = new Set(input.contentPool.map((c) => c.item.id));
    const selected_item_id = poolIds.has(parsed.selected_item_id)
      ? parsed.selected_item_id
      : firstItemId(input.contentPool);
    const headItem = input.contentPool.find((c) => c.item.id === selected_item_id)?.item;

    // Constraints com fallbacks
    const llmConstraints = parsed.constraints ?? {};
    const llmAvoid = Array.isArray(llmConstraints.avoid)
      ? (llmConstraints.avoid as unknown[]).map((x) => String(x))
      : [];
    const baseConstraints = buildConstraints(input, headItem, jogada);
    const register: Register = ([
      "neutro",
      "lúdico",
      "firme",
      "acolhedor",
    ] as const).includes(llmConstraints.register as Register)
      ? (llmConstraints.register as Register)
      : baseConstraints.register;

    const draft: TacticDecision = {
      jogada,
      selected_item_id,
      ...(parsed.target_axis ? { target_axis: parsed.target_axis } : {}),
      angle: (parsed.angle ?? "entrada natural a partir do tema do sujeito.").slice(0, 80),
      constraints: {
        avoid: llmAvoid.length > 0 ? llmAvoid : baseConstraints.avoid,
        register,
        max_length_chars:
          typeof llmConstraints.max_length_chars === "number"
            ? llmConstraints.max_length_chars
            : (baseConstraints.max_length_chars ?? 280),
        ...(llmConstraints.must_include
          ? { must_include: llmConstraints.must_include }
          : {}),
      },
      rationale: (parsed.rationale ?? "llm: decisão sem rationale.").slice(0, 140),
      ...(parsed.fallback_jogada &&
      (JOGADA_VALUES as readonly string[]).includes(parsed.fallback_jogada)
        ? { fallback_jogada: parsed.fallback_jogada as Jogada }
        : {}),
    };

    const validated = parseTacticDecision(draft);
    if (!validated) return null;

    const llmCallId = collector?.peek()[beforeSize]?.id;
    return { decision: validated, latency_ms: Date.now() - t0, llmCallId };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Fallback degradado (sem LLM)
// ─────────────────────────────────────────────────────────────────────────

function fallbackDecision(input: TacticianInput): TacticDecision {
  const head = input.contentPool[0]?.item;
  const jogada: Jogada = head?.type === "card_catalog" ? "bridge" : "espelho";
  return {
    jogada,
    selected_item_id: firstItemId(input.contentPool),
    ...(head && targetAxisFromItem(head) ? { target_axis: targetAxisFromItem(head)! } : {}),
    angle:
      jogada === "bridge"
        ? "amarra a fala do sujeito ao card disponível."
        : "reflete o que ele trouxe; aguarda.",
    constraints: buildConstraints(input, head, jogada),
    rationale: "fallback: rule-based ambíguo + LLM indisponível.",
    fallback_jogada: "recovery",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Decide jogada. Sempre retorna `TacticianResult` válido — nunca lança.
 */
export async function tactician(
  input: TacticianInput,
  opts?: TacticianOpts,
): Promise<TacticianResult> {
  const t0 = Date.now();
  const buildTrace = (
    method: "rule" | "llm" | "fallback",
    decision: TacticDecision,
    llmCallRef?: string,
  ): TacticianTrace => ({
    inputs: {
      pool_size: input.contentPool.length,
      strategic_rationale: input.strategicRationale.slice(0, 200),
      signals: input.signals,
      mood: input.mood,
      ...(typeof input.candidateSetEntropy === "number"
        ? { candidate_set_entropy: input.candidateSetEntropy }
        : {}),
    },
    outputs: {
      jogada: decision.jogada,
      selected_item_id: decision.selected_item_id,
      angle: decision.angle,
      rationale: decision.rationale,
    },
    method,
    duration_ms: Date.now() - t0,
    ...(llmCallRef !== undefined ? { llm_call_ref: llmCallRef } : {}),
  });

  // Step 1 — heurísticas
  const rule = tacticianByRules(input);
  if (rule) {
    const head = input.contentPool.find(
      (c) => c.item.id === rule.selected_item_id,
    )?.item;
    const decision: TacticDecision = {
      jogada: rule.jogada,
      selected_item_id: rule.selected_item_id,
      ...(rule.target_axis ? { target_axis: rule.target_axis } : {}),
      angle: rule.angle.slice(0, 80),
      constraints: buildConstraints(input, head, rule.jogada),
      rationale: rule.rationale.slice(0, 140),
      ...(rule.fallback_jogada ? { fallback_jogada: rule.fallback_jogada } : {}),
    };
    const validated = parseTacticDecision(decision) ?? decision;
    return {
      decision: validated,
      method: "rule",
      latency_ms: Date.now() - t0,
      ...(opts?.collector ? { _trace: buildTrace("rule", validated) } : {}),
    };
  }

  // Step 2 — Haiku
  const llm = await tacticianByLlm(input, opts?.collector);
  if (llm) {
    return {
      decision: llm.decision,
      method: "llm",
      latency_ms: llm.latency_ms,
      ...(opts?.collector
        ? { _trace: buildTrace("llm", llm.decision, llm.llmCallId) }
        : {}),
    };
  }

  // Step 3 — fallback degradado
  const fb = fallbackDecision(input);
  return {
    decision: fb,
    method: "fallback",
    latency_ms: Date.now() - t0,
    ...(opts?.collector ? { _trace: buildTrace("fallback", fb) } : {}),
  };
}
