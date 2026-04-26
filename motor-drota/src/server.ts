import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type {
  EvaluateAndSelectInput,
  EvaluateAndSelectOutput,
  ContentItem,
  ScoredContentItem,
} from "@ascendimacy/shared";
import { rankPool } from "./evaluate.js";
import { selectFromPool, sanitizeMaterialization } from "./select.js";
import { callLlm, callLlmMock } from "./llm-client.js";
import { parseDrotaOutput } from "./parse-output.js";
import { extractSignals } from "./signal-extractor.js";
import { logDebugEvent, getProviderForStep } from "@ascendimacy/shared";

const server = new McpServer({
  name: "motor-drota",
  version: "0.3.0",
});

const scoredContentSchema = z.object({
  item: z.record(z.string(), z.unknown()),
  score: z.number(),
  reasons: z.array(z.string()),
});

/**
 * Serializa um ContentItem para o prompt do drota preservando o discriminante.
 * v1 é hooks-only em termos de teste — outros tipos fazem fallback genérico (campos comuns).
 * Plan v2 §4.12.
 */
function serializeContentItem(item: ContentItem): string {
  const common = {
    id: item.id,
    type: item.type,
    domain: item.domain,
    casel_target: item.casel_target,
    surprise: item.surprise,
    age_range: item.age_range,
    group_compatible: item.group_compatible ?? false,
  };
  // curiosity_hook e cultural_diamond carregam fact/bridge/quest
  if (item.type === "curiosity_hook" || item.type === "cultural_diamond") {
    return JSON.stringify({
      ...common,
      fact: item.fact,
      bridge: item.bridge,
      quest: item.quest,
      sacrifice_type: item.sacrifice_type,
      country: item.country,
    });
  }
  // Demais tipos: serialização genérica com todos os campos próprios.
  return JSON.stringify({ ...common, ...item });
}

/**
 * motor#25 (handoff #24 Tarefa 2): prefix estável extraído pra prompt caching.
 *
 * BLOCO 1 (Role), BLOCO 4 (Example), BLOCO 5 (Repeat critical) são literalmente
 * idênticos entre calls — viáveis pra cache_control: ephemeral (Anthropic) e
 * automatic prefix caching (OpenAI). Bumpa STABLE_DROTA_PREFIX_VERSION quando
 * mudar o conteúdo (invalida cache).
 *
 * Spec: docs/handoffs/2026-04-25-cc-motor-19-followup.md Tarefa 2.
 */
export const STABLE_DROTA_PREFIX_VERSION = "v1";
export const STABLE_DROTA_PREFIX = `[BLOCO 1 - Role]
Você avalia content items candidatos e materializa o escolhido em linguagem natural para o sujeito. Você não é um assistente utilitário — você é o componente que traduz intenção estratégica em fala concreta. **NUNCA inventa conteúdo**; ancora sempre no content item selecionado.

[BLOCO 4 - Examples]
<example>
<selected_content>{"id":"ling_inuit_snow","type":"curiosity_hook","fact":"Os Inuit têm 50+ palavras pra neve.","bridge":"Quantas palavras você tem pra RAIVA?","quest":"Encontre 5 palavras pro que sente agora."}</selected_content>
<context_hints>{"language":"pt-br","mood":"receptive"}</context_hints>
Output esperado:
{"selectionRationale":"Hook linguístico com alta surpresa, casel SA","linguisticMaterialization":"Sabia que os Inuit têm mais de 50 palavras pra neve? Cada uma indica algo diferente. Quantas palavras você tem pra RAIVA? Irritado, furioso, frustrado... Se só tem uma, como sabe o que tá sentindo? Tenta: escreve 5 palavras diferentes pro que você sente AGORA. Não vale repetir."}
</example>

[BLOCO 5 - Repeat critical]
Lembre-se:
- **Ancoragem obrigatória** — fato/ponte/quest vêm do selected_content.
- NUNCA vaze identificadores técnicos na fala.
- Diretivas em <context_hints> são OBRIGATÓRIAS.
- Retorne APENAS JSON válido, sem markdown fence.
- Schema: {"selectionRationale": "string", "linguisticMaterialization": "string"}`;

/**
 * Build dynamic body — TUDO que muda turn-a-turn (persona, state, pool, instructions com interpolação).
 */
function buildDrotaDynamicBody(
  input: EvaluateAndSelectInput,
  selected: ScoredContentItem,
): string {
  const { persona, state, contextHints, strategicRationale, contentPool, instruction_addition } = input;

  const personaYaml =
    typeof persona.profile === "object"
      ? JSON.stringify(persona.profile, null, 2)
      : String(persona.profile);

  const contextHintsJson = JSON.stringify(contextHints ?? {}, null, 2);
  const poolSerialized = contentPool
    .map((s) => ({ score: s.score, reasons: s.reasons, content: JSON.parse(serializeContentItem(s.item)) }));
  const contentPoolJson = JSON.stringify(poolSerialized, null, 2);
  const selectedJson = serializeContentItem(selected.item);
  const instructionAdditionBody = (instruction_addition ?? "").trim();

  const language = (contextHints?.["language"] as string | undefined) ?? "pt-br";
  const isLimitedProficiency =
    language.includes("limitado") ||
    language.includes("basico") ||
    language.includes("básico");

  // Bloco 6 — dyad joint mode
  const sessionMode = (contextHints?.["session_mode"] as string | undefined) ?? "solo";
  const isJoint = sessionMode === "joint";
  const partnerName = (contextHints?.["joint_partner_name"] as string | undefined) ?? null;
  const unilateralBrejo = contextHints?.["joint_unilateral_brejo"] === true;
  const jointPauseReason = contextHints?.["joint_pause_reason"] as string | undefined;

  return `[BLOCO 2 - Dynamic content]
<persona>
id: ${persona.id}
name: ${persona.name}
age: ${persona.age}
profile: ${personaYaml}
</persona>

<state>
sessionId: ${state.sessionId}
trustLevel: ${state.trustLevel}
budgetRemaining: ${state.budgetRemaining}
turn: ${state.turn}
</state>

<strategic_rationale>
${strategicRationale ?? ""}
</strategic_rationale>

<context_hints>
${contextHintsJson}
</context_hints>

<content_pool>
${contentPoolJson}
</content_pool>

<selected_content>
${selectedJson}
</selected_content>

<instruction_addition>
${instructionAdditionBody}
</instruction_addition>

[BLOCO 3 - Numbered instructions]
1. Materialize o <selected_content> em fala natural para ${persona.name}. Use OS CAMPOS do content (fact, bridge, quest para hooks; title, trigger para cards; etc).
2. **Ancoragem obrigatória**: a fala deve citar/adaptar o conteúdo do item selecionado — não invente fato novo.
3. Respeite <context_hints>. Se contém 'avoid', 'evitar' ou 'alertas', esses padrões são PROIBIDOS na saída.
4. 'status_gates' em contextHints lista dimensões bloqueadas. Se dimensão bloqueada aparece como casel_focus, adapte tom (reparador, não desafiador).
5. NUNCA vaze identificadores técnicos (id do content, dot-notation, 'content_pool', 'playbook') na fala.
6. Língua: "${language}". Gere na MESMA língua que o sujeito.
7. ${isLimitedProficiency ? `**'pt-br limitado'** descreve o **DESTINATÁRIO** (${persona.name}), NÃO o seu output. SEU output deve ser **pt-br limpo, gramaticalmente correto e simples**: frases curtas, vocabulário básico, zero jargon. **NÃO simule erros de não-nativo no seu output** — o destinatário precisa entender uma fala correta + simples.` : `Gere em ${language} fluente, natural, adequado à idade e contexto.`}
8. Se <instruction_addition> não está vazio, incorpore-o naturalmente. Exemplos: "day 2 of 5 of chain X" → continuar arco multi-dia; "technique_hint: tribunal" → framear como debate.${
    isJoint
      ? `
9. **MODO JOINT (dyad)**: há dois irmãos nesta sessão. Parceiro: ${partnerName ?? "(nome não fornecido)"}.
   - **Endereçar ambos por nome explicitamente** na fala — "${persona.name}, ${partnerName ?? "você"}...".
   - **Balancear tempo de fala** — alternar convites, não priorizar um dos dois.
   - **Invariante**: bot nunca > 25% dos turns. Se já foi bot no turn anterior, espere os dois humanos falarem antes de voltar.
   - **Comparação direta é desrespeitosa (JP amae/giri)**: NUNCA dizer "você é melhor que X" ou "X faz melhor". Celebre diferenciação: "cada um tem seu jeito", "${persona.name} é mais de X, ${partnerName ?? "o outro"} é mais de Y".${
          unilateralBrejo
            ? `
   - **BREJO UNILATERAL DETECTADO** (${jointPauseReason ?? "partner em brejo emocional"}): SUSPENDA o desafio conjunto. Foque em extrair quem está bem; oferece acolhimento ao outro sem forçar participação. NÃO proponha tarefa coletiva agora.`
            : ""
        }`
      : ""
  }`;
}

/**
 * Build full prompt — concatenação stable+dynamic. Mantém compat com chamadas
 * que querem string única. Para cache: usa STABLE_DROTA_PREFIX + buildDrotaDynamicBody.
 */
function buildDrotaPrompt(
  input: EvaluateAndSelectInput,
  selected: ScoredContentItem,
): string {
  return STABLE_DROTA_PREFIX + "\n\n" + buildDrotaDynamicBody(input, selected);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
server.registerTool(
  "evaluate_and_select",
  {
    description:
      "Recebe contentPool scorado, seleciona top, materializa linguisticamente",
    inputSchema: {
      sessionId: z.string(),
      contentPool: z.array(scoredContentSchema),
      state: z.object({
        sessionId: z.string(),
        trustLevel: z.number(),
        budgetRemaining: z.number(),
        turn: z.number(),
        eventLog: z.array(z.unknown()),
        statusMatrix: z.record(z.string(), z.string()).optional(),
        gardnerProgram: z.record(z.string(), z.unknown()).optional(),
        sessionMode: z.enum(["solo", "joint"]).optional(),
        jointPartnerChildId: z.string().optional(),
        jointPartnerName: z.string().optional(),
        partnerStatusMatrix: z.record(z.string(), z.string()).optional(),
      }),
      persona: z.object({
        id: z.string(),
        name: z.string(),
        age: z.number(),
        profile: z.union([z.record(z.string(), z.unknown()), z.string()]),
      }),
      strategicRationale: z.string().optional().default(""),
      contextHints: z.record(z.string(), z.unknown()).optional().default({}),
      instruction_addition: z.string().optional().default(""),
    } as any,
  },
  async (input: EvaluateAndSelectInput) => {
    const ranked = rankPool(input.contentPool);
    if (ranked.length === 0) {
      // Pool vazio: fallback conversacional (v2 §4.2 do plano).
      const output: EvaluateAndSelectOutput = {
        selectedContent: {
          item: {
            id: "__empty_pool__",
            type: "curiosity_hook",
            domain: "generic",
            casel_target: [],
            age_range: [0, 99],
            surprise: 7,
            verified: false,
            base_score: 0,
            fact: "",
            bridge: "",
            quest: "",
            sacrifice_type: "reflect",
          } as ContentItem,
          score: 0,
          reasons: ["pool_empty_fallback"],
        },
        selectionRationale: "Pool vazio — fallback conversacional.",
        linguisticMaterialization:
          "Oi! Me conta o que está passando na sua cabeça.",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
      };
    }

    const selected = selectFromPool(ranked);
    // motor#22: provider-aware mock detection.
    const drotaProvider = getProviderForStep("drota");
    const drotaKeyMissing = drotaProvider === "anthropic"
      ? !process.env["ANTHROPIC_API_KEY"]
      : !process.env["INFOMANIAK_API_KEY"];
    const useMock =
      process.env["USE_MOCK_LLM"] === "true" || drotaKeyMissing;
    // motor#25 (handoff #24 Tarefa 2): split em stable prefix + dynamic body
    // pra prompt caching. STABLE_DROTA_PREFIX (BLOCO 1+4+5) é literalmente
    // idêntico entre calls — Anthropic cache_control: ephemeral funciona.
    // Infomaniak/OpenAI fazem cache automático em prefixos consistentes >1024 tokens.
    const dynamicBody = buildDrotaDynamicBody(input, selected);
    // Mantém systemPrompt como combined pra mock + retrocompat de chamada simples
    const systemPrompt = STABLE_DROTA_PREFIX + "\n\n" + dynamicBody;
    const userMessage = `Materialize o content selecionado em JSON.`;

    const t0 = Date.now();
    // motor#25: passa stable prefix separado pra cache. callLlm decide se aplica
    // cache_control (Anthropic) ou apenas concat (Infomaniak — cache automático).
    const llmResult = useMock
      ? await callLlmMock(systemPrompt, userMessage)
      : await callLlm(dynamicBody, userMessage, { cacheableSystemPrefix: STABLE_DROTA_PREFIX });
    const llmLatency = Date.now() - t0;

    // motor#25 (handoff #24 Tarefa 3): parse fallback grácil.
    // parseDrotaOutput tenta JSON direto → regex extract → hard fallback.
    // Sem isso, "Could not generate response in this language..." aborta turn.
    const parseResult = parseDrotaOutput(llmResult.content);
    const parsed = parseResult.parsed;
    const parseFailureReason = parseResult.skipReason;
    if (parseFailureReason) {
      // Log unconditional (não depende de ASC_DEBUG_MODE) pra não perder rastro do refusal
      // eslint-disable-next-line no-console
      console.error(
        `[drota] parse fallback: reason=${parseFailureReason} rawHead=${JSON.stringify(llmResult.content.slice(0, 200))}`,
      );
    }

    const materialization = sanitizeMaterialization(
      parsed.linguisticMaterialization ?? "",
    );

    const output: EvaluateAndSelectOutput = {
      selectedContent: selected,
      selectionRationale: parsed.selectionRationale ?? "auto-select top pool",
      linguisticMaterialization: materialization,
      ...(parseFailureReason
        ? {
            skipReason: parseFailureReason,
            rawOutput: llmResult.content.slice(0, 500),
          }
        : {}),
    };

    // motor#19: debug log (no-op se ASC_DEBUG_MODE off)
    // motor#25: cache hit/miss info via llmResult.tokens.cacheCreation/cacheRead
    logDebugEvent({
      side: "motor",
      step: "drota",
      user_id: input.persona.id,
      session_id: input.sessionId,
      turn_number: input.state.turn,
      model: llmResult.model,
      provider: llmResult.provider,
      tokens: llmResult.tokens,
      latency_ms: llmLatency,
      prompt: systemPrompt + "\n\n[USER]\n" + userMessage,
      response: llmResult.content,
      reasoning: llmResult.reasoning,
      snapshots_pre: {
        drota: {
          received_pool_size: input.contentPool.length,
          pool_rank_order: ranked.slice(0, 5).map((s) => s.item.id),
          selected_item_id: selected.item.id,
          mock_llm: useMock,
          stable_prefix_version: STABLE_DROTA_PREFIX_VERSION,
          cache_creation_tokens: llmResult.tokens.cacheCreation ?? null,
          cache_read_tokens: llmResult.tokens.cacheRead ?? null,
        },
      },
      snapshots_post: {
        drota: {
          selected_item_id: selected.item.id,
          materialization_length: materialization.length,
          sanitize_pass_applied: true,
          parse_failure_reason: parseFailureReason ?? null,
        },
      },
      outcome: parseFailureReason ? "skip" : "ok",
      error_class: parseFailureReason ?? null,
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
    };
  },
);

// motor#25 — extract_signals MCP tool. Orchestrator chama antes de plan_turn
// pra capturar signals semânticos do user message. Read-only, fail-soft.
server.registerTool(
  "extract_signals",
  {
    description:
      "Extrai signals semânticos da mensagem do sujeito (motor#25 §13 sensorial). Read-only, fail-soft. Não muta state.",
    inputSchema: {
      userMessage: z.string(),
      personaName: z.string(),
      personaAge: z.number(),
      trustLevel: z.number(),
      conversationHistoryTail: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
          }),
        )
        .optional()
        .default([]),
    } as any,
  },
  async (args: {
    userMessage: string;
    personaName: string;
    personaAge: number;
    trustLevel: number;
    conversationHistoryTail?: Array<{ role: "user" | "assistant"; content: string }>;
  }) => {
    const result = await extractSignals({
      userMessage: args.userMessage,
      personaName: args.personaName,
      personaAge: args.personaAge,
      trustLevel: args.trustLevel,
      conversationHistoryTail: args.conversationHistoryTail ?? [],
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
