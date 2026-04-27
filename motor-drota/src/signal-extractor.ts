/**
 * Signal Extractor — captura signals semânticos do user message (motor#25).
 *
 * Spec: docs/handoffs/2026-04-26-cc-motor-pre-piloto-strategic-gaps.md §motor#25.
 * Roda ANTES do Environment Assessor — read-only, não ajusta comportamento ainda.
 *
 * Filosofia: capturar PRIMEIRO, ajustar comportamento DEPOIS. Os signals
 * alimentam (a) Trigger Evaluator (função de transição) e (b) MotorOps batch
 * agg (pós-piloto), NÃO rerankam scoring runtime.
 *
 * Default provider: Infomaniak/mistral3 (não-reasoning, ~5s/call). Justificativa:
 * tarefa é classificação de signals em texto curto, não exige reasoning chain.
 */

import {
  SEMANTIC_SIGNALS,
  SIGNAL_DESCRIPTIONS,
  isSemanticSignal,
  callGateway,
  getProviderForStep,
  getModelForStep,
  type SemanticSignal,
  type SignalExtractionResult,
} from "@ascendimacy/shared";

/**
 * Constrói o prompt do Signal Extractor.
 * Estável (15 signals + descrições) + dinâmico (user message + history tail).
 */
function buildSignalExtractorPrompt(args: {
  userMessage: string;
  conversationHistoryTail: Array<{ role: "user" | "assistant"; content: string }>;
  personaName: string;
  personaAge: number;
  trustLevel: number;
}): string {
  const signalsList = SEMANTIC_SIGNALS.map(
    (s) => `- ${s}: ${SIGNAL_DESCRIPTIONS[s]}`,
  ).join("\n");
  const historyFmt = args.conversationHistoryTail.length
    ? args.conversationHistoryTail
        .map((m) => `${m.role === "user" ? args.personaName : "Bot"}: ${m.content}`)
        .join("\n")
    : "(turn 0 — sem histórico)";

  return `Você é um listener semântico. Sua tarefa é detectar signals em mensagem de criança/adolescente respondendo a um bot educacional.

**Importante**: você só CAPTURA, não interpreta nem corrige. Output: lista de signals da taxonomia abaixo presentes na mensagem do sujeito (ou na progressão history → mensagem).

[Sujeito]
nome: ${args.personaName}
idade: ${args.personaAge}
trust_level atual: ${args.trustLevel.toFixed(2)} (0-1)

[História recente (últimas 3 trocas)]
${historyFmt}

[Mensagem do sujeito agora]
${args.userMessage}

[Taxonomia de signals — 15 categorias]
${signalsList}

**Regras**:
1. Só liste signals com evidência clara na mensagem ou progressão. **Quando em dúvida, omita.**
2. Não faça mais de 1 signal por categoria.
3. Considere a história: signals como mood_drift_up/down ou voluntary_topic_deepening exigem comparação com turns anteriores.
4. Se nenhum signal claro, retorne lista vazia.

**Regras CRÍTICAS de formato JSON**:
- Cada \`evidence\` value DEVE ser uma string entre aspas, SEM parêntesis ou texto fora das aspas.
- ❌ ERRADO: \`"frame_rejection": "trecho..." (rejeição implícita)\`
- ✅ CORRETO: \`"frame_rejection": "trecho... (rejeição implícita ao frame X)"\`
- Coloque QUALQUER explicação adicional DENTRO das aspas, não fora.
- Não use markdown fence (\`\`\`json\`\`\`) — JSON puro.

[Few-shot examples]

EXAMPLE 1 (signals presentes):
Input: "não preciso ser borboleta, só melhorar o que tem"
Output:
{"signals":["philosophical_self_acceptance","frame_rejection"],"evidence":{"philosophical_self_acceptance":"'não preciso ser X' explicita auto-aceitação do estado atual","frame_rejection":"rejeita o frame da transformação oferecido pelo bot"},"overall_confidence":0.8}

EXAMPLE 2 (sem signals claros):
Input: "ok"
Output:
{"signals":[],"overall_confidence":0.1}

[Output schema]
Retorne APENAS JSON válido, sem markdown fence:
{
  "signals": ["signal_name_1", "signal_name_2", ...],
  "evidence": {
    "signal_name_1": "string única entre aspas — qualquer explicação DENTRO das aspas",
    ...
  },
  "overall_confidence": 0.7
}`;
}

/**
 * Extrai signals de uma mensagem do sujeito. Retorna SignalExtractionResult.
 *
 * Em caso de:
 * - LLM throw → retorna result vazio com overall_confidence=0
 * - Parse fail → retorna result vazio com overall_confidence=0
 * - Mock mode (USE_MOCK_LLM=true) → retorna []
 *
 * Read-only: não muta state, só retorna observações.
 */
export async function extractSignals(args: {
  userMessage: string;
  conversationHistoryTail: Array<{ role: "user" | "assistant"; content: string }>;
  personaName: string;
  personaAge: number;
  trustLevel: number;
}): Promise<SignalExtractionResult> {
  if (process.env["USE_MOCK_LLM"] === "true") {
    return { signals: [], overall_confidence: 0 };
  }

  const provider = getProviderForStep("signal-extractor");
  const model = getModelForStep("signal-extractor", provider);
  const prompt = buildSignalExtractorPrompt(args);

  // Gate A fix (b): max_tokens 512→2048 (cobre reasoning models + non-reasoning).
  // Mistral3 + Haiku: 99-200 tokens output, sobra abundante.
  // Kimi K2.5: reasoning chain ~500-1500 + content ~150 = total ~1500-2000.
  const maxTokens = 2048;

  // motor#28b: chama via gateway. systemPrompt vazio + userMessage = prompt
  // (signal-extractor envia prompt único como user, sem system separado).
  let raw: string;
  let llmError: unknown = null;
  try {
    const out = await callGateway({
      step: "signal-extractor",
      provider,
      model,
      systemPrompt: "",
      userMessage: prompt,
      maxTokens,
      run_id: process.env["ASC_DEBUG_RUN_ID"],
    });
    raw = out.content;
  } catch (err) {
    llmError = err;
    raw = "";
  }

  const parsed = parseExtractorResponse(raw);

  // Gate A fix (c): debug log captura raw response sempre — diferencia
  // "modelo retornou vazio" vs "parser engoliu output malformado".
  // Não-blocking: erro de log não trava extração.
  try {
    const { logDebugEvent } = await import("@ascendimacy/shared");
    logDebugEvent({
      side: "motor",
      step: "signal-extractor",
      user_id: args.personaName,
      model,
      provider,
      response: raw,
      snapshots_pre: {
        drota: {
          extractor_input_user_message: args.userMessage.slice(0, 200),
          extractor_input_history_length: args.conversationHistoryTail.length,
          extractor_input_trust_level: args.trustLevel,
          max_tokens_budget: maxTokens,
        },
      },
      snapshots_post: {
        drota: {
          signals_detected: parsed.signals,
          overall_confidence: parsed.overall_confidence ?? 0,
          parse_fallback_taken: raw.length > 0 && parsed.signals.length === 0 && /\{/.test(raw),
          llm_error_class: llmError ? String((llmError as Error).message ?? llmError).slice(0, 80) : null,
        },
      },
      outcome: llmError ? "error" : parsed.signals.length > 0 ? "ok" : "skip",
      error_class: llmError ? String((llmError as Error).message ?? llmError).slice(0, 80) : null,
    });
  } catch {
    /* debug log fail é silencioso — extração já tem o resultado */
  }

  // Fail-soft retro: se houve LLM error, retorna vazio (comportamento prévio).
  if (llmError) return { signals: [], overall_confidence: 0 };
  return parsed;
}

/**
 * Parse defensivo da resposta do extractor. Função pura — testável.
 *
 * 3 camadas (mesma estratégia do parseDrotaOutput):
 * 1. JSON.parse direto
 * 2. Regex extract `\{[\s\S]*\}`
 * 3. Fallback {signals: []} se nada salvar
 */
export function parseExtractorResponse(raw: string): SignalExtractionResult {
  const tryParse = (s: string): SignalExtractionResult | null => {
    try {
      const obj = JSON.parse(s) as {
        signals?: unknown;
        evidence?: Record<string, unknown>;
        overall_confidence?: number;
      };
      if (!Array.isArray(obj.signals)) return null;
      const signals: SemanticSignal[] = obj.signals.filter(
        (x): x is SemanticSignal => typeof x === "string" && isSemanticSignal(x),
      );
      const evidence: Partial<Record<SemanticSignal, string>> = {};
      if (obj.evidence && typeof obj.evidence === "object") {
        for (const [k, v] of Object.entries(obj.evidence)) {
          if (isSemanticSignal(k) && typeof v === "string") evidence[k] = v;
        }
      }
      return {
        signals,
        evidence: Object.keys(evidence).length > 0 ? evidence : undefined,
        overall_confidence: typeof obj.overall_confidence === "number"
          ? obj.overall_confidence
          : undefined,
      };
    } catch {
      return null;
    }
  };

  const direct = tryParse(raw);
  if (direct) return direct;
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    const extracted = tryParse(match[0]);
    if (extracted) return extracted;
  }
  return { signals: [], overall_confidence: 0 };
}
