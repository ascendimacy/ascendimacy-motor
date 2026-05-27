/**
 * Speaker (S4) — gera a fala dado uma `TacticDecision`.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-s4-separacao-decide-gera-v0.md
 *
 * Filosofia:
 *   - Tactician já decidiu jogada/angle/constraints. Speaker apenas executa.
 *   - 1 template de overlay por jogada (placeholders), injetado no
 *     userMessage dinâmico. STABLE_MATERIALIZER_PREFIX permanece imutável
 *     (cache prefix hit ~70% intra-sessão).
 *   - Mesma sanitização defensiva final do constrained-materializer.
 *   - Se chamada falha por parse/exception, retry com `fallback_jogada`
 *     (1 vez). Se também falha, retorna texto neutro fallback.
 */

import { callGateway, callGatewayWithTracing } from "@ascendimacy/shared";
import type {
  EngagementLevel,
  LlmTraceCollector,
  ScoredContentItem,
  SpeakerTrace,
  TacticDecision,
  Jogada,
} from "@ascendimacy/shared";
import { createHash } from "node:crypto";
import { sanitizeMaterialization } from "./select.js";
import { STABLE_MATERIALIZER_PREFIX } from "./constrained-materializer.js";

// ─────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────

export interface SpeakerContext {
  /** Decisão já tomada pelo Tactician. */
  decision: TacticDecision;
  /** Item ScoredContentItem associado ao decision.selected_item_id. */
  action: ScoredContentItem;
  /** Nome do sujeito (forma adequada). */
  subjectNameForm: string;
  /** Mood 1-10 do unified-assessor. */
  mood: number;
  /** Engagement. */
  engagement: EngagementLevel;
  /** Turn atual. */
  turnCount: number;
  /** Budget remaining. */
  budgetRemaining: number;
  /** Jurisdição ativa. */
  jurisdictionActive: "br" | "jp" | "ch";
  /** Última mensagem do sujeito (pode estar vazio em turn inaugural). */
  incomingMessage?: string;
  /** Janela curta de history (últimos pares user/assistant). */
  recentTurns?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Profile block pré-formatado (vai pro cacheable prefix junto). */
  personaProfileBlock?: string;
  /** Run id pra trace. */
  run_id?: string;
  /** Override do step (default "drota"). */
  llmStep?: string;
  /** Override max tokens. */
  maxTokens?: number;
}

export interface SpeakerOpts {
  collector?: LlmTraceCollector;
}

export interface SpeakerResult {
  text: string;
  model_used: string;
  /** True quando o LLM retornou FALLBACK: prefix ou erro. */
  fallback_triggered: boolean;
  /** True quando precisou retry com `fallback_jogada`. */
  retried_with_fallback: boolean;
  latency_ms: number;
  token_count: number;
  sanitization_applied: boolean;
  _trace?: SpeakerTrace;
}

// ─────────────────────────────────────────────────────────────────────────
// Templates por jogada — placeholders {{name}} {{angle}} {{must_include}}
// ─────────────────────────────────────────────────────────────────────────

const FALLBACK_PREFIX = "FALLBACK:";

interface TemplateContext {
  name: string;
  angle: string;
  register: string;
  must_include?: string;
  max_length_chars?: number;
  avoid: string[];
}

function jogadaInstruction(jogada: Jogada, ctx: TemplateContext): string {
  const avoidLine =
    ctx.avoid.length > 0
      ? `AVOID (não tematizar, não responder): ${ctx.avoid.join(", ")}.`
      : "";
  const mustLine = ctx.must_include
    ? `ANCHOR (incluir literalmente ou em paráfrase próxima): "${ctx.must_include}".`
    : "";
  const lengthLine = ctx.max_length_chars
    ? `LIMITE: ≤${ctx.max_length_chars} caracteres.`
    : "";
  const registerLine = `REGISTER: ${ctx.register}.`;
  const angleLine = `ÂNGULO DE ENTRADA: ${ctx.angle}`;
  const common = [registerLine, angleLine, mustLine, avoidLine, lengthLine]
    .filter((l) => l.length > 0)
    .join("\n");
  const specific = (() => {
    switch (jogada) {
      case "bridge":
        return `JOGADA: BRIDGE — amarre a mensagem de ${ctx.name} ao Fact disponível. A ponte deve nascer do que ${ctx.name} disse; o Fact vem DEPOIS, não antes.`;
      case "espelho":
        return `JOGADA: ESPELHO — reflita o que ${ctx.name} trouxe em até 1 frase. Sem propor avanço, sem perguntar. Apenas valida o conteúdo trazido.`;
      case "canal":
        return `JOGADA: CANAL — abra o canal latente que ${ctx.name} apenas tangenciou. Pergunte sobre o adjacente, não sobre o central. Mantém o tema vivo.`;
      case "diamante":
        return `JOGADA: DIAMANTE — amplifique a síntese que ${ctx.name} expressou. Mostre que você viu a conexão; não reduza ao didático.`;
      case "arena":
        return `JOGADA: ARENA — entre firme no contraponto. Não invalide ${ctx.name}; ofereça argumento alternativo claro, em até 2 frases.`;
      case "recovery":
        return `JOGADA: RECOVERY — recue. Reconheça em 1 frase curta sem fazer pergunta. ${ctx.name} precisa de espaço, não de avanço.`;
    }
  })();
  return `${specific}\n${common}`;
}

function buildSpeakerUserMessage(
  ctx: SpeakerContext,
  jogada: Jogada,
): { userMessage: string; jogadaBlock: string } {
  const item = ctx.action.item as {
    id: string;
    type: string;
    domain: string;
    fact?: string;
    bridge?: string;
    quest?: string;
  };
  const fact = item.fact ?? "(sem fact)";
  const bridge = item.bridge ?? "(sem bridge)";
  const quest = item.quest ?? "(sem quest)";

  const incoming = ctx.incomingMessage?.trim() ?? "";
  const subjectBlock =
    incoming.length > 0
      ? `MENSAGEM DO SUJEITO (use como tema, se houver):\n"${incoming}"`
      : `MENSAGEM DO SUJEITO: (vazia / vaga — não há tema concreto pra puxar)`;

  const turns = ctx.recentTurns ?? [];
  const tail = turns.slice(-6);
  const botRecent = tail.filter((t) => t.role === "assistant").slice(-3);
  const userRecent = tail.filter((t) => t.role === "user").slice(-3);
  const formatLines = (arr: typeof botRecent): string =>
    arr.length === 0
      ? "(nenhum)"
      : arr
          .map(
            (t, i) =>
              `[${i + 1}] "${t.content.slice(0, 240).replace(/\n/g, " ")}"`,
          )
          .join("\n");
  const historyBlock =
    tail.length > 0
      ? `

VOCÊ JÁ DISSE (não repita verbatim — varie ângulo, vocabulário, abertura):
${formatLines(botRecent)}

SUJEITO JÁ DISSE (continue o que está em aberto, não recomece zero):
${formatLines(userRecent)}`
      : "";

  const jogadaBlock = jogadaInstruction(jogada, {
    name: ctx.subjectNameForm,
    angle: ctx.decision.angle,
    register: ctx.decision.constraints.register,
    avoid: ctx.decision.constraints.avoid,
    ...(ctx.decision.constraints.must_include
      ? { must_include: ctx.decision.constraints.must_include }
      : {}),
    ...(ctx.decision.constraints.max_length_chars
      ? { max_length_chars: ctx.decision.constraints.max_length_chars }
      : {}),
  });

  const userMessage = `SUJEITO: ${ctx.subjectNameForm}
MOOD: ${ctx.mood}/10 | ENGAJAMENTO: ${ctx.engagement} | TURN: ${ctx.turnCount}
BUDGET: ${ctx.budgetRemaining}
JURISDIÇÃO: ${ctx.jurisdictionActive}

${subjectBlock}${historyBlock}

AÇÃO LATENTE (use conforme jogada decidida):
- ID: ${item.id}
- Tipo: ${item.type}
- Domínio: ${item.domain}
- Fact: ${fact}
- Bridge: ${bridge}
- Quest: ${quest}

DECISÃO TÁTICA (TOMADA — execute em fala):
${jogadaBlock}

Retorne APENAS o texto pra enviar ao sujeito. Sem explicação, sem markdown.
Se a jogada exigir violar CONSTRAINTS DE SEGURANÇA do prefixo, retorne ${FALLBACK_PREFIX} <texto seguro de 1 frase>.`;

  return { userMessage, jogadaBlock };
}

function hashCacheablePrefix(prefix: string): string {
  return (
    "sha256:" + createHash("sha256").update(prefix).digest("hex").slice(0, 16)
  );
}

interface SpeakerCallResult {
  rawText: string;
  modelUsed: string;
  outTokens: number;
  llmCallId?: string;
  cacheablePrefixUsed: string;
  ok: boolean;
}

async function callSpeakerLlm(
  ctx: SpeakerContext,
  userMessage: string,
  collector?: LlmTraceCollector,
): Promise<SpeakerCallResult> {
  const profileBlock = (ctx.personaProfileBlock ?? "").trim();
  const cacheablePrefixUsed =
    profileBlock.length > 0
      ? `${STABLE_MATERIALIZER_PREFIX}\n\n${profileBlock}`
      : STABLE_MATERIALIZER_PREFIX;
  try {
    const req = {
      step: ctx.llmStep ?? "drota",
      systemPrompt: "",
      cacheableSystemPrefix: cacheablePrefixUsed,
      userMessage,
      maxTokens:
        ctx.maxTokens ??
        (ctx.decision.constraints.max_length_chars
          ? Math.max(
              160,
              Math.ceil(ctx.decision.constraints.max_length_chars / 1.5),
            )
          : 400),
      run_id: ctx.run_id,
    };
    const beforeSize = collector?.size() ?? 0;
    const out = collector
      ? await callGatewayWithTracing(req, "speaker", collector)
      : await callGateway(req);
    return {
      rawText: out.content,
      modelUsed: `${out.provider}:${out.model}`,
      outTokens: out.tokens.out,
      llmCallId: collector?.peek()[beforeSize]?.id,
      cacheablePrefixUsed,
      ok: true,
    };
  } catch {
    return {
      rawText: "",
      modelUsed: "fallback_hardcoded",
      outTokens: 0,
      cacheablePrefixUsed,
      ok: false,
    };
  }
}

/**
 * Executa a TacticDecision em fala. Sempre retorna SpeakerResult válido.
 *
 * Pipeline:
 *   1. Constrói userMessage parametrizado pela jogada.
 *   2. Call LLM (step "drota" por default).
 *   3. Detecta FALLBACK: prefix.
 *   4. sanitizeMaterialization defensiva.
 *   5. Em caso de erro / fallback gerado pelo modelo → retry com
 *      `decision.fallback_jogada` (se houver), uma única vez.
 */
export async function speak(
  ctx: SpeakerContext,
  opts?: SpeakerOpts,
): Promise<SpeakerResult> {
  const t0 = Date.now();
  const collector = opts?.collector;

  const { userMessage } = buildSpeakerUserMessage(ctx, ctx.decision.jogada);

  let call = await callSpeakerLlm(ctx, userMessage, collector);
  let fallbackTriggered =
    !call.ok || call.rawText.trimStart().startsWith(FALLBACK_PREFIX);
  let retriedWithFallback = false;
  let lastUserMessage = userMessage;

  // Retry once com fallback_jogada se LLM falhou OU model retornou FALLBACK.
  if (fallbackTriggered && ctx.decision.fallback_jogada) {
    retriedWithFallback = true;
    const { userMessage: retryMsg } = buildSpeakerUserMessage(
      ctx,
      ctx.decision.fallback_jogada,
    );
    lastUserMessage = retryMsg;
    const retry = await callSpeakerLlm(ctx, retryMsg, collector);
    if (
      retry.ok &&
      !retry.rawText.trimStart().startsWith(FALLBACK_PREFIX)
    ) {
      call = retry;
      fallbackTriggered = false;
    } else {
      call = retry.ok ? retry : call;
    }
  }

  if (!call.ok && !retriedWithFallback) {
    // LLM totalmente indisponível e sem fallback_jogada — texto neutro.
    const fb = "Tô por aqui. Quando quiser me contar mais, conta.";
    return {
      text: fb,
      model_used: "fallback_hardcoded",
      fallback_triggered: true,
      retried_with_fallback: false,
      latency_ms: Date.now() - t0,
      token_count: 0,
      sanitization_applied: false,
      ...(collector
        ? {
            _trace: {
              inputs: {
                jogada: ctx.decision.jogada,
                selected_item_id: ctx.decision.selected_item_id,
                user_message: userMessage,
              },
              stable_prefix_hash: hashCacheablePrefix(call.cacheablePrefixUsed),
              user_message_constructed: userMessage,
              outputs: { raw_response: "", final_text: fb },
              retried_with_fallback: false,
              llm_call_ref: collector.peek()[collector.size() - 1]?.id ?? "",
              duration_ms: Date.now() - t0,
            } satisfies SpeakerTrace,
          }
        : {}),
    };
  }

  // Detect FALLBACK: prefix (caso o modelo tenha retornado mesmo após retry).
  const rawText = call.rawText;
  const stillFallback = rawText.trimStart().startsWith(FALLBACK_PREFIX);
  let textBeforeSanitize: string;
  if (stillFallback) {
    const idx = rawText.indexOf(FALLBACK_PREFIX);
    textBeforeSanitize = rawText.slice(idx + FALLBACK_PREFIX.length).trim();
    fallbackTriggered = true;
  } else if (!call.ok) {
    // Retry também falhou (call.ok=false após retriedWithFallback).
    // Mantém fallback_triggered=true e usa texto neutro hardcoded.
    textBeforeSanitize = "Tô por aqui. Quando quiser me contar mais, conta.";
    fallbackTriggered = true;
  } else {
    textBeforeSanitize = rawText.trim();
    fallbackTriggered = false;
  }

  // Sanitização final
  const sanitized = sanitizeMaterialization(textBeforeSanitize);
  const sanitizationApplied = sanitized !== textBeforeSanitize;

  return {
    text: sanitized.length > 0 ? sanitized : "Tô por aqui.",
    model_used: call.modelUsed,
    fallback_triggered: fallbackTriggered,
    retried_with_fallback: retriedWithFallback,
    latency_ms: Date.now() - t0,
    token_count: call.outTokens,
    sanitization_applied: sanitizationApplied,
    ...(collector
      ? {
          _trace: {
            inputs: {
              jogada: ctx.decision.jogada,
              selected_item_id: ctx.decision.selected_item_id,
              user_message: lastUserMessage,
            },
            stable_prefix_hash: hashCacheablePrefix(call.cacheablePrefixUsed),
            user_message_constructed: lastUserMessage,
            outputs: { raw_response: rawText, final_text: sanitized },
            retried_with_fallback: retriedWithFallback,
            llm_call_ref: call.llmCallId ?? "",
            duration_ms: Date.now() - t0,
          } satisfies SpeakerTrace,
        }
      : {}),
  };
}
