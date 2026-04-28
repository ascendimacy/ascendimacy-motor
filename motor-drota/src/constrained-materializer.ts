/**
 * Constrained Materializer — substitui Linguistic Materializer + Post-Processor
 * F1-F5 (motor-drota-v1 §2.4 + §2.5) com constraints embutidas no system prompt.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-28-motor-simplificacao-llm-spec-v1.md §5
 *
 * Filosofia (DS-03, DS-05):
 *   - Constraints de segurança ficam no system prompt (não em filtros separados)
 *   - Modelo retorna FALLBACK: <texto seguro> quando seria forçado a violar
 *   - SEM loop de re-tentativa — fallback é o output (não falha)
 *   - sanitizeMaterialization mantida como camada final defensiva
 *
 * DT-SIM-05 (Jun, 28-abr): voice_profile.materializer.model proposto na spec
 * (default "qwen") usa string que não está no LlmStep enum atual. Solução v0:
 * usar step "drota" existente (que já roteia para Kimi via Infomaniak por
 * default e respeita override per-callsite via DROTA_PROVIDER/DROTA_MODEL env).
 * Quando voice profile ganhar tipo formal (DT-SIM-02), refatorar pra ler
 * model dali.
 */

import { callGateway } from "@ascendimacy/shared";
import type { ScoredContentItem, EngagementLevel } from "@ascendimacy/shared";
import { sanitizeMaterialization } from "./select.js";

// ─────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────

export interface MaterializerContext {
  /** Item selecionado pelo Pragmatic Selector. */
  action: ScoredContentItem;
  /** Nome do sujeito (forma adequada — sem honorífico por padrão JP). */
  subjectNameForm: string;
  /** Mood atual 1-10. */
  mood: number;
  /** Engajamento. */
  engagement: EngagementLevel;
  /** Turno atual da sessão. */
  turnCount: number;
  /** Budget remaining após deduct (do SelectionResult). */
  budgetRemaining: number;
  /** Jurisdição ativa pra constraints. */
  jurisdictionActive: "br" | "jp" | "ch";
  /** Run id pra trace. */
  run_id?: string;
  /** Override do step LLM (default "drota"). DT-SIM-05. */
  llmStep?: string;
  /** Max tokens (default 300 — Kids respostas curtas). */
  maxTokens?: number;
}

export interface MaterializationResult {
  /** Texto final pronto pra Bridge (já sanitizado). */
  text: string;
  /** Modelo usado (provedor:nome). */
  model_used: string;
  /** True se LLM retornou FALLBACK: prefix (constraint violado em prompt). */
  fallback_triggered: boolean;
  /** Latência da chamada LLM em ms. */
  latency_ms: number;
  /** Token count estimado (out tokens). */
  token_count: number;
  /** True se sanitizeMaterialization removeu palavras (defensiva final). */
  sanitization_applied: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// System prompt (Kids — perfil neutro-respeitoso JP/BR)
// ─────────────────────────────────────────────────────────────────────────

const FALLBACK_PREFIX = "FALLBACK:";

function buildSystemPrompt(ctx: MaterializerContext): string {
  const moodLowGuidance =
    ctx.mood <= 3
      ? "\n- IMPORTANTE: mood ≤ 3 → SEM perguntas abertas. Apenas reconhecimento factual curto."
      : "";

  const disengagingGuidance =
    ctx.engagement === "disengaging"
      ? "\n- IMPORTANTE: engagement=disengaging → 1 frase, tom leve, sem pressão."
      : "";

  const lengthGuidance =
    ctx.turnCount <= 3
      ? "Comprimento: 1-2 frases (turn inicial)."
      : "Comprimento: pode expandir conforme engajamento, mas sem prolixidade.";

  return `Você é um acompanhante pedagógico de crianças. Seu nome não importa — você é uma voz, não um personagem.

CONTEXTO DO SUJEITO:
- Nome: ${ctx.subjectNameForm} (use sem honorífico salvo orientação contrária)
- Mood atual: ${ctx.mood}/10
- Engajamento: ${ctx.engagement}
- Turn #${ctx.turnCount} desta sessão
- Budget de sacrifício restante: ${ctx.budgetRemaining}

AÇÃO A MATERIALIZAR:
- ID: ${ctx.action.item.id}
- Tipo: ${ctx.action.item.type}
- Domínio: ${ctx.action.item.domain}
- Fact (referência): ${(ctx.action.item as { fact?: string }).fact ?? "(sem fact)"}
- Bridge: ${(ctx.action.item as { bridge?: string }).bridge ?? "(sem bridge)"}
- Quest: ${(ctx.action.item as { quest?: string }).quest ?? "(sem quest)"}

CONTRATO DE VOZ (obrigatório):
- Tom: neutro-respeitoso. Zero infantilização.
- Zero diminutivos não-solicitados.
- Zero elogios automáticos ("que legal!", "incrível!", "muito bem!", "que bonitinho!").
- Zero jargão pedagógico ("dimensão", "CASEL", "Dreyfus", "score", "playbook").
- Zero falsa simetria ("eu também adoro X").
- Zero terapia-esqueléstica ("como você está se sentindo com isso?").
- Zero "Como posso te ajudar?" — você não é assistente genérico.${moodLowGuidance}${disengagingGuidance}
- ${lengthGuidance}

CONSTRAINTS DE SEGURANÇA (violação = retornar FALLBACK):
- NUNCA induza o sujeito a compartilhar dados sensíveis (localização, escola, informações de terceiros).
- NUNCA mencione dados de outros sujeitos por nome (ex: não mencione Kei em sessão de Ryo).
- NUNCA contradiga restrições de jurisdição ativas (${ctx.jurisdictionActive}).
- Se a ação especificada exige violar qualquer constraint acima:
  retorne EXATAMENTE: ${FALLBACK_PREFIX} <reconhecimento neutro de 1 frase sem conteúdo da ação>

INSTRUÇÕES FINAIS:
Retorne apenas o texto a ser enviado ao sujeito. Sem explicação, sem metadados, sem markdown.
Se retornar FALLBACK, use exatamente o formato acima.`;
}

function buildUserMessage(ctx: MaterializerContext): string {
  return `Materialize a ação especificada acima como mensagem ao sujeito ${ctx.subjectNameForm}. Respeite o contrato de voz.`;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Materializa o texto final. Sempre retorna MaterializationResult válido,
 * nunca lança.
 *
 * Pipeline:
 *   1. Build system prompt com slots dinâmicos
 *   2. callGateway(step="drota") com constraints embutidas
 *   3. Parse output: se começar com FALLBACK:, extrai texto seguro
 *   4. sanitizeMaterialization defensiva final (FORBIDDEN_WORDS)
 *
 * Em caso de erro do LLM: retorna texto fallback hardcoded conservador.
 */
export async function materialize(
  ctx: MaterializerContext,
): Promise<MaterializationResult> {
  const t0 = Date.now();
  const systemPrompt = buildSystemPrompt(ctx);
  const userMessage = buildUserMessage(ctx);

  let rawText: string;
  let modelUsed = "unknown";
  let outTokens = 0;

  try {
    const out = await callGateway({
      step: ctx.llmStep ?? "drota",
      systemPrompt,
      userMessage,
      maxTokens: ctx.maxTokens ?? 300,
      run_id: ctx.run_id,
    });
    rawText = out.content;
    modelUsed = `${out.provider}:${out.model}`;
    outTokens = out.tokens.out;
  } catch {
    // LLM error → texto neutro fallback hardcoded
    return {
      text: "Tô por aqui. Quando quiser me contar mais, conta.",
      model_used: "fallback_hardcoded",
      fallback_triggered: true,
      latency_ms: Date.now() - t0,
      token_count: 0,
      sanitization_applied: false,
    };
  }

  // Detect FALLBACK: prefix
  const fallbackTriggered = rawText.trimStart().startsWith(FALLBACK_PREFIX);
  let textBeforeSanitize: string;
  if (fallbackTriggered) {
    const idx = rawText.indexOf(FALLBACK_PREFIX);
    textBeforeSanitize = rawText.slice(idx + FALLBACK_PREFIX.length).trim();
  } else {
    textBeforeSanitize = rawText.trim();
  }

  // Sanitização defensiva final
  const sanitized = sanitizeMaterialization(textBeforeSanitize);
  const sanitizationApplied = sanitized !== textBeforeSanitize;

  return {
    text: sanitized,
    model_used: modelUsed,
    fallback_triggered: fallbackTriggered,
    latency_ms: Date.now() - t0,
    token_count: outTokens,
    sanitization_applied: sanitizationApplied,
  };
}
