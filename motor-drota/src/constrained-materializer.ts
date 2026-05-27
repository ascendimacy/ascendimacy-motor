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

import { callGateway, callGatewayWithTracing } from "@ascendimacy/shared";
import type {
  EngagementLevel,
  LlmTraceCollector,
  MaterializerTrace,
  ScoredContentItem,
} from "@ascendimacy/shared";
import { createHash } from "node:crypto";
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
  /** motor#69 H4: Helix phase ("solo" / "retrieval" / "boss"). */
  helixPhase?: "solo" | "retrieval" | "boss";
  /** motor#69 H4: dim CASEL ativa do meta-ciclo Helix. */
  caselFocusDim?: string;
  /** motor#69 H4: dim CASEL anterior (retrieval) — só se phase != solo. */
  caselRetrievalDim?: string;
  /**
   * 2026-05-05 (sts-realista): janela curta de history (últimos 3 pares
   * user/assistant). Motor é semi-stateless: estratégia (helix, status,
   * gardner) vem de state; awareness conversacional vem daqui pra evitar
   * loops + permitir continuidade temática. NÃO vai pro PREFIX cacheável —
   * é dinâmico turn-a-turn, fica em userMessage.
   */
  recentTurns?: Array<{ role: "user" | "assistant"; content: string }>;
  /**
   * 2026-05-07 Phase 2 memory (#476): bloco de perfil acumulado pré-formatado
   * por profile-store. Vazio = primeira sessão / perfil indisponível. Vai pro
   * userMessage (varia por persona, raro hit cross-persona).
   */
  personaProfileBlock?: string;
  /**
   * Fase 8 PR — Recall check candidate (spec 2026-05-25 §4.5).
   * Quando presente, materializer anexa o `suggested_framing` ao final do
   * texto materializado (Fact + " " + framing). Pipeline registra
   * recall_check_attempt no ledger no turn seguinte, baseado na resposta.
   */
  recallCheckCandidate?: {
    concept_id: string;
    suggested_framing: string;
  };
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
  /**
   * Fase 8 PR — quando recallCheckCandidate foi anexado ao texto.
   * Pipeline usa pra registrar tentativa de checagem; resposta da
   * persona no turn seguinte resolve em positive/negative/ambiguous.
   */
  recall_check_emitted?: {
    concept_id: string;
    framing_used: string;
  };
  /**
   * TV2-3 (spec ops#1136): trace section opcional. Presente quando
   * caller passou `opts.collector`. Inclui stable_prefix_hash, user
   * message construído, raw response, final_text + llm_call_ref.
   */
  _trace?: MaterializerTrace;
}

export interface MaterializeOpts {
  collector?: LlmTraceCollector;
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

CONTRATO DE VOZ (obrigatório, sem exceção):
- Tom: neutro-respeitoso. Zero infantilização.
- Zero diminutivos não-solicitados.
- Zero elogios automáticos. PROIBIDO usar (mesmo prefixados em meio à frase): "que legal!", "legal!", "incrível!", "muito bem!", "ótimo!", "isso é ótimo", "parece legal", "parece divertido", "que bonitinho!", "Que bom!", "isso é bom para…".
- Zero jargão pedagógico ("dimensão", "CASEL", "Dreyfus", "score", "playbook").
- Zero falsa simetria. PROIBIDO dizer "eu também", "tô X também", "também adoro/curto/treino/jogo X". Você não tem hobbies, gostos, treino próprio — você acompanha o sujeito.
- Zero terapia-esqueléstica ("como você está se sentindo com isso?").
- Zero "Como posso te ajudar?" — você não é assistente genérico.

ANTI-LOOP (importante, sob risco de soar artificial):
- Se o sujeito repete a mesma resposta entre turns (ex: "tô treinando tênis" 3x seguidas), NÃO insista no mesmo enquadramento. Reconheça brevemente (1 cláusula) e MUDE o ângulo: pergunte sobre algo adjacente, ou recue ("ok, tô por aqui quando quiser").
- Não escale com elogios cumulativos ("legal!" → "muito legal!" → "que demais!") — isso soa falso e o contrato proíbe.
- Se o sujeito desviou de um tema (mudou de assunto explicitamente), NÃO retorne a esse tema na mesma resposta. O contextHints.avoid indica o tema a evitar — respeite-o literalmente.

CONTEÚDO PEDAGÓGICO (regra obrigatória):
O Fact abaixo FOI SELECIONADO para este sujeito neste momento. Você DEVE
usá-lo — a questão é COMO, não SE.

Regra de ancoragem:
1. Reconheça o tema do sujeito em 1 frase curta (sem elogio, sem eco excessivo).
2. Introduza o Fact com uma ponte NATURAL ao que ele disse.
   - Se o tema do sujeito conecta diretamente ao Domínio → traga o Fact diretamente.
   - Se o tema do sujeito não conecta diretamente → use o Fact como ângulo lateral.
     Exemplo: sujeito falou de tênis, Fact é sobre golfinhos com nome → bridge:
     "Golfinhos chamam uns aos outros pelo nome. Quando você tá em jogo, como
     chama a atenção do parceiro?"
3. Bridge e Quest entram DEPOIS do Fact, reformulados dentro do contexto do sujeito.
4. Exceção única: se o sujeito enviou sinal EXPLÍCITO de saída ("tchau", "preciso ir",
   "para") OU se o Fact exigiria violar CONSTRAINTS DE SEGURANÇA → ignore o Fact e
   reconheça brevemente a saída ou retorne FALLBACK.

NUNCA gere resposta genérica ignorando o Fact. Se não encontrar ângulo, crie um.

REGRAS CONDICIONAIS (texto fixo; aplicar conforme situação dinâmica abaixo):
- Se mood ≤ 3 → SEM perguntas abertas. Apenas reconhecimento factual curto.
- Se engagement = disengaging → 1 frase, tom leve, sem pressão.
- Se turn ≤ 3 → 1-2 frases (turn inicial). Prioridade contextual acima vale duplo.
- Se turn > 3 → pode expandir conforme engajamento, mas sem prolixidade.
- Se MENSAGEM DO SUJEITO está marcada como vazia/vaga (turn inaugural, "oi", mensagem ≤ 3 palavras sem tema) → NÃO use Fact/Bridge/Quest. Abra com apresentação curta do que vão fazer juntos + 1 pergunta sobre o sujeito.
- Se HELIX_PHASE = boss (Double Helix integrador) → quest/desafio integra os DOIS domínios CASEL (CASEL_FOCUS_DIM + CASEL_RETRIEVAL_DIM) numa única atividade concreta, não em quests separadas. Ex: SOC ativo + SA retrieval → "como sua autoconsciência muda quando está com outras pessoas?" (não duas perguntas).
- Se HELIX_PHASE = retrieval → mencionar CASEL_RETRIEVAL_DIM sutilmente como ponte (re-visita), sem forçar.

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

  // motor#69 H4: helix block (omit quando phase=undefined / fora do helix path).
  const helixBlock = ctx.helixPhase
    ? `\nHELIX_PHASE: ${ctx.helixPhase}${ctx.caselFocusDim ? ` | CASEL_FOCUS_DIM: ${ctx.caselFocusDim}` : ""}${ctx.caselRetrievalDim ? ` | CASEL_RETRIEVAL_DIM: ${ctx.caselRetrievalDim}` : ""}\n`
    : "";

  // 2026-05-05 (sts-realista): janela curta de history pra anti-loop awareness.
  // Excluímos o turn atual do sujeito (já está em subjectBlock).
  const turns = ctx.recentTurns ?? [];
  const tail = turns.slice(-6); // último ~3 pares
  const botRecent = tail.filter((t) => t.role === "assistant").slice(-3);
  const userRecent = tail.filter((t) => t.role === "user").slice(-3);
  const formatLines = (arr: typeof botRecent): string =>
    arr.length === 0
      ? "(nenhum)"
      : arr.map((t, i) => `[${i + 1}] "${t.content.slice(0, 240).replace(/\n/g, " ")}"`).join("\n");
  const historyBlock = tail.length > 0
    ? `

VOCÊ JÁ DISSE (não repita verbatim — varie ângulo, vocabulário, abertura):
${formatLines(botRecent)}

SUJEITO JÁ DISSE (continue o que está em aberto, não recomece zero):
${formatLines(userRecent)}`
    : "";

  // 2026-05-07 Nível A: profile NÃO entra mais no userMessage — vai pro
  // cacheableSystemPrefix em materialize(). Aqui apenas garantimos que
  // o resto do dynamic body fica intacto.

  return `SUJEITO: ${ctx.subjectNameForm}
MOOD: ${ctx.mood}/10 | ENGAJAMENTO: ${ctx.engagement} | TURN: ${ctx.turnCount}
BUDGET: ${ctx.budgetRemaining}
JURISDIÇÃO: ${ctx.jurisdictionActive}
${helixBlock}
${subjectBlock}${historyBlock}

AÇÃO LATENTE (use só se houver ponte natural com a mensagem do sujeito acima):
- ID: ${ctx.action.item.id}
- Tipo: ${ctx.action.item.type}
- Domínio: ${ctx.action.item.domain}
- Fact: ${fact}
- Bridge: ${bridge}
- Quest: ${quest}

Aplique a PRIORIDADE CONTEXTUAL do contrato. Se houver ponte → traga Fact/Bridge/Quest dentro do tema do sujeito. Se não houver tema/ponte → reconheça e abra com 1 pergunta sobre o que ele trouxe (ou como ele está, se mensagem vazia). Respeite contrato de voz + regras condicionais. ANTI-LOOP: se algo da sua lista "VOCÊ JÁ DISSE" está sendo replicado mentalmente, MUDE de ângulo agora.`;
}

/**
 * 2026-05-07 Otimização #2: max_tokens adaptativo.
 *
 * Heurística:
 *  - mood ≤ 3 OU engagement=disengaging → 200 (apenas reconhecimento factual)
 *  - turnCount ≤ 3 → 350 (rapport curto)
 *  - engagement=high E turnCount ≥ 4 → 600 (deepening permite expansão)
 *  - default → 400
 *
 * Reduz gen time em ~30-50% nos turns "duros" mantendo headroom em turns ricos.
 */
function adaptiveMaxTokens(
  turnCount: number,
  engagement: EngagementLevel,
  mood: number,
): number {
  if (mood <= 3 || engagement === "disengaging") return 200;
  if (turnCount <= 3) return 350;
  if (engagement === "high") return 600;
  return 400;
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
/**
 * B2 (Drilling) — short-circuit determinístico para items `drill_vocab`.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md §5.
 *
 * Drill é pedagogia atômica — LLM não inventa pergunta, só varia. v0
 * usa template fixo por language tag; v1 abre pra prompt template via
 * voice_profile.
 */
export function materializeDrillVocab(item: {
  prompt: string;
  hint?: string;
  source_language?: string;
}): string {
  const promptForm = item.prompt.trim();
  const hint = item.hint?.trim();
  const hintSuffix = hint && hint.length > 0 ? ` (dica: ${hint})` : "";
  // Source japonês: usa partícula clássica "em português"; outros: mantém
  // pt-br como destino, agnóstico ao source.
  const lang = item.source_language ?? "unknown";
  if (lang === "jp") {
    return `Como se diz **${promptForm}** em português?${hintSuffix}`;
  }
  return `O que significa **${promptForm}**?${hintSuffix}`;
}

export async function materialize(
  ctx: MaterializerContext,
  opts?: MaterializeOpts,
): Promise<MaterializationResult> {
  const t0 = Date.now();

  // B2 short-circuit: drill_vocab nunca chama LLM — pergunta determinística.
  // Sanitizer continua aplicado (defesa em profundidade), mas sem fallback.
  const selectedItem = ctx.action.item as {
    type?: string;
    prompt?: string;
    hint?: string;
    source_language?: string;
  };
  if (selectedItem.type === "drill_vocab" && typeof selectedItem.prompt === "string") {
    const drillText = materializeDrillVocab({
      prompt: selectedItem.prompt,
      ...(selectedItem.hint !== undefined ? { hint: selectedItem.hint } : {}),
      ...(selectedItem.source_language !== undefined
        ? { source_language: selectedItem.source_language }
        : {}),
    });
    const sanitized = sanitizeMaterialization(drillText);
    return {
      text: sanitized,
      model_used: "drill_template_v0",
      fallback_triggered: false,
      latency_ms: Date.now() - t0,
      token_count: 0,
      sanitization_applied: sanitized !== drillText,
    };
  }

  const userMessage = buildUserMessage(ctx);
  const collector = opts?.collector;
  if (process.env["ASC_DEBUG_MATERIALIZER"] === "true") {
    // eslint-disable-next-line no-console
    console.error(
      `[materialize] turn=${ctx.turnCount} recentTurns=${(ctx.recentTurns ?? []).length} userMsgLen=${userMessage.length}\n--- USER MSG START ---\n${userMessage}\n--- USER MSG END ---`,
    );
  }

  let rawText: string;
  let modelUsed = "unknown";
  let outTokens = 0;
  let llmCallId: string | undefined;
  let cacheablePrefixUsed: string = STABLE_MATERIALIZER_PREFIX;

  try {
    // 2026-05-07 Nível A (#476 Phase 2): profile vai pro cacheableSystemPrefix
    // pra cache hit cross-turn dentro da sessão (profile constante por 6 turns
    // entre compressões). llama-server prefix caching pega automaticamente.
    const profileBlock = (ctx.personaProfileBlock ?? "").trim();
    cacheablePrefixUsed =
      profileBlock.length > 0
        ? `${STABLE_MATERIALIZER_PREFIX}\n\n${profileBlock}`
        : STABLE_MATERIALIZER_PREFIX;

    const req = {
      step: ctx.llmStep ?? "drota",
      // systemPrompt vazio: tudo fixo está em cacheableSystemPrefix.
      // Preserva prefix caching no vLLM (Step 8 do handoff).
      systemPrompt: "",
      cacheableSystemPrefix: cacheablePrefixUsed,
      userMessage,
      // 2026-05-05 (sts-realista): turn 1-3 mantém 300 (rapport curto).
      // turn 4+ permite 600 — abre espaço pra profundidade quando há contexto
      // estabelecido. Override explícito via ctx.maxTokens vence a heurística.
      // 2026-05-07 Otimização #2: max_tokens adaptativo por engagement+mood.
      // Rationale: turns "duros" (mood baixo, disengaging) merecem reconhecimento
      // curto (~200), não monólogo. Receptivo/deepening permite expansão.
      // Override explícito via ctx.maxTokens vence.
      maxTokens: ctx.maxTokens ?? adaptiveMaxTokens(ctx.turnCount, ctx.engagement, ctx.mood),
      run_id: ctx.run_id,
    };
    const beforeSize = collector?.size() ?? 0;
    const out = collector
      ? await callGatewayWithTracing(req, "materializer", collector)
      : await callGateway(req);
    rawText = out.content;
    modelUsed = `${out.provider}:${out.model}`;
    outTokens = out.tokens.out;
    llmCallId = collector?.peek()[beforeSize]?.id;
  } catch {
    // LLM error → texto neutro fallback hardcoded
    const fallbackText = "Tô por aqui. Quando quiser me contar mais, conta.";
    return {
      text: fallbackText,
      model_used: "fallback_hardcoded",
      fallback_triggered: true,
      latency_ms: Date.now() - t0,
      token_count: 0,
      sanitization_applied: false,
      ...(collector
        ? {
            _trace: {
              inputs: {
                selected_item_id: ctx.action.item.id,
                user_message: userMessage,
              },
              stable_prefix_hash: hashCacheablePrefix(cacheablePrefixUsed),
              user_message_constructed: userMessage,
              outputs: { raw_response: "", final_text: fallbackText },
              llm_call_ref: collector.peek()[collector.size() - 1]?.id ?? "",
              duration_ms: Date.now() - t0,
            } satisfies MaterializerTrace,
          }
        : {}),
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

  // Fase 8 PR — Anexa recall check framing quando candidate foi passado.
  // Skip em fallback_triggered (não polui texto de erro).
  const recallEmission = fallbackTriggered
    ? { text: sanitized }
    : applyRecallCheckFraming(sanitized, ctx.recallCheckCandidate);

  return {
    text: recallEmission.text,
    model_used: modelUsed,
    fallback_triggered: fallbackTriggered,
    latency_ms: Date.now() - t0,
    token_count: outTokens,
    sanitization_applied: sanitizationApplied,
    ...(recallEmission.emitted ? { recall_check_emitted: recallEmission.emitted } : {}),
    ...(collector
      ? {
          _trace: {
            inputs: {
              selected_item_id: ctx.action.item.id,
              user_message: userMessage,
            },
            stable_prefix_hash: hashCacheablePrefix(cacheablePrefixUsed),
            user_message_constructed: userMessage,
            outputs: { raw_response: rawText, final_text: recallEmission.text },
            llm_call_ref: llmCallId ?? "",
            duration_ms: Date.now() - t0,
          } satisfies MaterializerTrace,
        }
      : {}),
  };
}

/**
 * Hash sha256 (first 16 chars) do cacheable prefix — pra debug do prefix
 * caching cross-turn. Mesmo hash entre turns = cache hit no vLLM/llama-server.
 */
function hashCacheablePrefix(prefix: string): string {
  return (
    "sha256:" +
    createHash("sha256").update(prefix).digest("hex").slice(0, 16)
  );
}

/**
 * Função pura: anexa suggested_framing ao final do texto materializado.
 * Exportada pra testes (e reuso futuro).
 *
 * Comportamento:
 *  - candidate undefined / framing vazio → retorna texto original sem `emitted`
 *  - texto vazio → retorna vazio sem `emitted` (preserva sinal de erro)
 *  - separador adapta-se: " " quando texto termina em pontuação, " — " caso contrário
 */
export function applyRecallCheckFraming(
  text: string,
  candidate?: { concept_id: string; suggested_framing: string },
): { text: string; emitted?: { concept_id: string; framing_used: string } } {
  if (!candidate || text.length === 0) return { text };
  const framing = candidate.suggested_framing.trim();
  if (framing.length === 0) return { text };
  const sep = /[.!?…]$/.test(text) ? " " : " — ";
  return {
    text: `${text}${sep}${framing}`,
    emitted: {
      concept_id: candidate.concept_id,
      framing_used: framing,
    },
  };
}
