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
  /** Última mensagem do sujeito — necessária pra "prioridade contextual". */
  incomingMessage?: string;
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
// Prompts (Kids — perfil neutro-respeitoso JP/BR)
//
// Step 8 do handoff vLLM: separação STABLE_MATERIALIZER_PREFIX (cacheável)
// vs userMessage (dinâmico) pra prefix caching funcionar.
// vLLM faz hash do system message; campos volatéis lá quebram cache hit.
// ─────────────────────────────────────────────────────────────────────────

const FALLBACK_PREFIX = "FALLBACK:";

/**
 * Prefixo IMUTÁVEL na sessão — vai pra cacheableSystemPrefix.
 * Inclui contrato de voz + regras condicionais (texto fixo) + constraints
 * de segurança. Nada que muda turn-a-turn.
 */
export const STABLE_MATERIALIZER_PREFIX = `/no_think
Você é um acompanhante pedagógico de crianças. Seu nome não importa — você é uma voz, não um personagem.

CONTRATO DE VOZ (obrigatório):
- Tom: neutro-respeitoso. Zero infantilização.
- Zero diminutivos não-solicitados.
- Zero elogios automáticos ("que legal!", "incrível!", "muito bem!", "que bonitinho!").
- Zero jargão pedagógico ("dimensão", "CASEL", "Dreyfus", "score", "playbook").
- Zero falsa simetria ("eu também adoro X").
- Zero terapia-esqueléstica ("como você está se sentindo com isso?").
- Zero "Como posso te ajudar?" — você não é assistente genérico.

PRIORIDADE CONTEXTUAL (regra geral, vale antes das outras):
- A ação abaixo é uma POSSIBILIDADE LATENTE, não obrigação. Use-a SÓ se houver ponte natural com o que o sujeito acabou de dizer.
- O sujeito trouxe um tema concreto na mensagem (objeto, lugar, sentimento, fato dele)? Reconheça PRIMEIRO o tema dele em 1 frase. SE o Domínio/Fact da ação conectar de forma honesta com o tema dele → traga Fact e/ou Bridge/Quest reformulados DENTRO desse tema. SE NÃO conectar → ignore Fact/Bridge/Quest e faça 1 pergunta aberta sobre o tema dele.
- O sujeito NÃO trouxe tema concreto (turn inaugural, "oi", "tudo bem?", silêncio, mensagem vaga)? → NÃO materialize Fact/Bridge/Quest. Abra com 1 frase curta + 1 pergunta aberta sobre como ele está hoje. Deixa ele puxar o tema.
- Quest e Bridge entram SEMPRE dentro do contexto que o sujeito puxou — nunca como pergunta solta.

REGRAS CONDICIONAIS (texto fixo; aplicar conforme situação dinâmica abaixo):
- Se mood ≤ 3 → SEM perguntas abertas. Apenas reconhecimento factual curto.
- Se engagement = disengaging → 1 frase, tom leve, sem pressão.
- Se turn ≤ 3 → 1-2 frases (turn inicial). Prioridade contextual acima vale duplo.
- Se turn > 3 → pode expandir conforme engajamento, mas sem prolixidade.

CONSTRAINTS DE SEGURANÇA (violação = retornar FALLBACK):
- NUNCA induza o sujeito a compartilhar dados sensíveis (localização, escola, informações de terceiros).
- NUNCA mencione dados de outros sujeitos por nome.
- NUNCA contradiga restrições de jurisdição ativa.
- Se a ação especificada exige violar qualquer constraint acima:
  retorne EXATAMENTE: ${FALLBACK_PREFIX} <reconhecimento neutro de 1 frase sem conteúdo da ação>

INSTRUÇÕES FINAIS:
Retorne apenas o texto a ser enviado ao sujeito. Sem explicação, sem metadados, sem markdown.
Se retornar FALLBACK, use exatamente o formato acima.`;

/**
 * userMessage — DINÂMICO turn-a-turn. Inclui SUJEITO/MOOD/ENGAJAMENTO/TURN/
 * BUDGET/AÇÃO. NÃO vai pro cacheableSystemPrefix — varia a cada turn.
 */
function buildUserMessage(ctx: MaterializerContext): string {
  const fact = (ctx.action.item as { fact?: string }).fact ?? "(sem fact)";
  const bridge = (ctx.action.item as { bridge?: string }).bridge ?? "(sem bridge)";
  const quest = (ctx.action.item as { quest?: string }).quest ?? "(sem quest)";

  const incoming = ctx.incomingMessage?.trim() ?? "";
  const subjectBlock = incoming.length > 0
    ? `MENSAGEM DO SUJEITO (use como tema, se houver):\n"${incoming}"`
    : `MENSAGEM DO SUJEITO: (vazia / vaga — não há tema concreto pra puxar)`;

  return `SUJEITO: ${ctx.subjectNameForm}
MOOD: ${ctx.mood}/10 | ENGAJAMENTO: ${ctx.engagement} | TURN: ${ctx.turnCount}
BUDGET: ${ctx.budgetRemaining}
JURISDIÇÃO: ${ctx.jurisdictionActive}

${subjectBlock}

AÇÃO LATENTE (use só se houver ponte natural com a mensagem do sujeito acima):
- ID: ${ctx.action.item.id}
- Tipo: ${ctx.action.item.type}
- Domínio: ${ctx.action.item.domain}
- Fact: ${fact}
- Bridge: ${bridge}
- Quest: ${quest}

Aplique a PRIORIDADE CONTEXTUAL do contrato. Se houver ponte → traga Fact/Bridge/Quest dentro do tema do sujeito. Se não houver tema/ponte → reconheça e abra com 1 pergunta sobre o que ele trouxe (ou como ele está, se mensagem vazia). Respeite contrato de voz + regras condicionais.`;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Materializa o texto final. Sempre retorna MaterializationResult válido,
 * nunca lança.
 *
 * Pipeline:
 *   1. STABLE_MATERIALIZER_PREFIX (cacheável) + userMessage (dinâmico)
 *   2. callGateway(step="drota") — vLLM prefix caching opera sobre prefix
 *   3. Parse output: se começar com FALLBACK:, extrai texto seguro
 *   4. sanitizeMaterialization defensiva final (FORBIDDEN_WORDS)
 *
 * Em caso de erro do LLM: retorna texto fallback hardcoded conservador.
 */
export async function materialize(
  ctx: MaterializerContext,
): Promise<MaterializationResult> {
  const t0 = Date.now();
  const userMessage = buildUserMessage(ctx);

  let rawText: string;
  let modelUsed = "unknown";
  let outTokens = 0;

  try {
    const out = await callGateway({
      step: ctx.llmStep ?? "drota",
      // systemPrompt vazio: tudo fixo está em cacheableSystemPrefix.
      // Preserva prefix caching no vLLM (Step 8 do handoff).
      systemPrompt: "",
      cacheableSystemPrefix: STABLE_MATERIALIZER_PREFIX,
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
