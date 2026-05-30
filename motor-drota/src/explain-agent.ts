/**
 * Explain Agent v0.3-B — gera opções de framing explicativo para um item
 * pedagógico já selecionado.
 *
 * Padrão mirrored do Discovery Agent, mas roda em motor-drota DEPOIS do
 * Pragmatic Selector picar o item (porque precisa do item específico).
 * Saída vai pra explain-option-selector que escolhe um framing baseado
 * em signals e o materializer é curto-circuitado.
 *
 * Diferente de discover, aqui geramos CONTEÚDO PEDAGÓGICO (não pergunta
 * aberta) ancorado em fact/bridge/quest do item já validado. O LLM faz
 * reformulação, NÃO invenção — anti-hallucination via anchor explícito
 * no prompt.
 *
 * 4 kinds:
 *   concrete_example  — caso específico, narrativa curta
 *   metaphor          — ponte analógica
 *   contrast          — o que NÃO é, anti-exemplo
 *   lineage_anchor    — referência à tradição/cultura do item
 *
 * Mock mode + fallback determinístico: deriva 4 framings do item sem LLM.
 */

import { callGateway, shouldUseMockLlm } from "@ascendimacy/shared";
import type { ExplainOption } from "./explain-option-selector.js";

export interface ExplainAgentItem {
  id: string;
  fact?: string;
  bridge?: string;
  quest?: string;
  keywords?: readonly string[];
  /** "tradicao/complemento" — ex: "estoica/dicotomia_controle" */
  lineage_anchor?: string;
}

export interface ExplainAgentInput {
  item: ExplainAgentItem;
  recentTurns: Array<{ role: "user" | "assistant"; content: string }>;
  subjectName: string;
  signals: string[];
  /** run_id pra trace correlation. */
  runId?: string;
}

const FALLBACK_LINEAGE = "tradição";

function deriveAnchor(item: ExplainAgentItem): string {
  return (
    item.keywords?.[0] ??
    item.lineage_anchor ??
    item.id
  );
}

function buildFallbackOptions(input: ExplainAgentInput): ExplainOption[] {
  const it = input.item;
  const anchor = deriveAnchor(it);
  const factOrId = it.fact ?? it.id;
  const lineage = it.lineage_anchor?.split("/")[0] ?? FALLBACK_LINEAGE;

  return [
    {
      kind: "concrete_example",
      text: `${input.subjectName}, ${factOrId}. Pensa numa vez em que você viu isso acontecer.`,
      anchor,
    },
    {
      kind: "metaphor",
      text: `É como se ${anchor} fosse a chave de uma porta que você ainda não tinha visto.`,
      anchor,
    },
    {
      kind: "contrast",
      text: `O contrário disso é ignorar ${anchor} — e a maioria faz exatamente isso.`,
      anchor,
    },
    {
      kind: "lineage_anchor",
      text: `Na ${lineage}, isso era visto como um dos princípios essenciais.`,
      anchor,
    },
  ];
}

function parseExplainOptions(raw: string): ExplainOption[] | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  const candidate = arrayMatch ? arrayMatch[0] : cleaned;
  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return null;
    const out: ExplainOption[] = [];
    for (const x of parsed) {
      if (
        typeof x?.kind === "string" &&
        typeof x?.text === "string" &&
        typeof x?.anchor === "string"
      ) {
        out.push({ kind: x.kind, text: x.text, anchor: x.anchor });
      }
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function buildSystemPrompt(input: ExplainAgentInput): string {
  const it = input.item;
  const anchorFact = it.fact ?? `(sem fato textual — use id "${it.id}")`;
  const lineage = it.lineage_anchor ?? "(nenhuma)";
  const keywords = it.keywords?.join(", ") ?? "(nenhuma)";

  return `Você é o Explain Agent do Ascendimacy. Seu papel: gerar 4 FRAMINGS de explicação curta (1-2 frases cada) para um conceito pedagógico já validado.

ITEM A EXPLICAR (use estes ÂNCORAS — não invente fatos novos):
- id: ${it.id}
- fato: ${anchorFact}
- bridge: ${it.bridge ?? "(nenhum)"}
- quest: ${it.quest ?? "(nenhum)"}
- linhagem: ${lineage}
- palavras-chave: ${keywords}

REGRAS ABSOLUTAS:
- Cada framing tem 1-2 frases (curto, falável)
- NÃO invente fatos — reformule o âncora acima
- NÃO faça pergunta — explain ensina, não pergunta
- 4 kinds OBRIGATÓRIOS, um por opção:
  * concrete_example: caso/narrativa específica
  * metaphor: ponte analógica
  * contrast: o que NÃO é (anti-exemplo)
  * lineage_anchor: referência à tradição/cultura do item

CONTEXTO:
Sujeito: ${input.subjectName}
Signals: ${input.signals.length > 0 ? input.signals.join(", ") : "(nenhum)"}

OUTPUT — RETORNE APENAS JSON ARRAY com 4 opções nessa ORDEM:
[
  { "kind": "concrete_example", "text": "...", "anchor": "..." },
  { "kind": "metaphor", "text": "...", "anchor": "..." },
  { "kind": "contrast", "text": "...", "anchor": "..." },
  { "kind": "lineage_anchor", "text": "...", "anchor": "..." }
]`;
}

export async function generateExplainOptions(
  input: ExplainAgentInput,
): Promise<ExplainOption[]> {
  if (shouldUseMockLlm("drota")) {
    return buildFallbackOptions(input);
  }

  const systemPrompt = buildSystemPrompt(input);
  const userMessage = `Gere 4 framings de explicação, em JSON array.`;

  try {
    const result = await callGateway({
      step: "drota",
      systemPrompt,
      userMessage,
      maxTokens: 600,
      ...(input.runId ? { run_id: input.runId } : {}),
    });
    const parsed = parseExplainOptions(result.content);
    if (parsed && parsed.length >= 2) {
      return parsed;
    }
    return buildFallbackOptions(input);
  } catch {
    return buildFallbackOptions(input);
  }
}
