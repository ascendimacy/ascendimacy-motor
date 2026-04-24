import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { EvaluateAndSelectInput, EvaluateAndSelectOutput } from "@ascendimacy/shared";
import { scoreActions } from "./evaluate.js";
import { selectBest, sanitizeMaterialization } from "./select.js";
import { callLlm, callLlmMock } from "./llm-client.js";

const server = new McpServer({
  name: "motor-drota",
  version: "0.2.0",
});

const candidateSchema = z.object({
  playbookId: z.string(),
  priority: z.number(),
  rationale: z.string(),
  estimatedSacrifice: z.number(),
  estimatedConfidenceGain: z.number(),
});

function buildDrotaPrompt(input: EvaluateAndSelectInput, selectedPlaybookId: string): string {
  const { persona, state, contextHints, strategicRationale, candidateActions } = input;

  const personaYaml = typeof persona.profile === "object"
    ? JSON.stringify(persona.profile, null, 2)
    : String(persona.profile);

  const contextHintsJson = JSON.stringify(contextHints ?? {}, null, 2);
  const candidateActionsJson = JSON.stringify(candidateActions, null, 2);

  // Detect language from contextHints, fallback to pt-br
  const language = (contextHints?.["language"] as string | undefined) ?? "pt-br";
  const isLimitedProficiency = language.includes("limitado") || language.includes("basico") || language.includes("básico");

  return `[BLOCO 1 - Role]
Você avalia ações candidatas e materializa a ação escolhida em linguagem natural para o sujeito. Você não é um assistente utilitário — você é o componente que traduz intenção estratégica em fala concreta.

[BLOCO 2 - Dynamic content]
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

<candidate_actions>
${candidateActionsJson}
</candidate_actions>

<selected_playbook_id>
${selectedPlaybookId}
</selected_playbook_id>

[BLOCO 3 - Numbered instructions]
1. A ação selecionada é ${selectedPlaybookId}. Materialize-a em linguagem natural para ${persona.name}.
2. A materialização DEVE respeitar todas as diretivas em <context_hints>.
3. Se <context_hints> contém chaves 'avoid', 'evitar', ou 'alertas', esses padrões são PROIBIDOS na saída — não apareçam na fala de forma alguma.
4. Se <context_hints> contém 'tom', 'format', 'tone', ou 'next_move', siga literalmente.
5. Quando <context_hints> contém informação específica extraída (ex: afirmações da persona, hipóteses, intenções), USE essa informação na materialização — não gere conteúdo genérico que ignora o que foi extraído.
6. Use o ID do playbook (ex: 'helix.ciclo.avancar_dia') APENAS como índice interno. NUNCA reproduza identificadores técnicos, dot-notation ou jargon interno na materialização. A persona não sabe que o sistema tem 'Helix', 'painel', 'ciclo.avancar_dia'.
7. Língua: "${language}". Gere na MESMA língua. Se omitido, default pt-br.
8. ${isLimitedProficiency ? `PROFICIÊNCIA LIMITADA: vocabulário simples, frases curtas, zero jargon, erros típicos de não-nativo (concordância de gênero, preposições), eventual interjeição na língua nativa, pausas 'hmm'.` : `Gere em ${language} fluente, natural, adequado à idade e contexto.`}
9. Se o playbook não tem template canônico, construa a materialização PELOS HINTS (não pelo nome técnico).

[BLOCO 4 - Examples]
<example>
<context_hints>
{"language": "pt-br", "afirmacoes_extraidas": ["trabalho me consome", "não consigo descansar"], "avoid": ["diagnóstico emocional", "rótulos clínicos"]}
</context_hints>
<selected_playbook_id>reflexao.custo-beneficio</selected_playbook_id>
Output esperado:
{"selectionRationale": "Reflexão sobre custo-benefício dado que persona afirmou que trabalho consome", "linguisticMaterialization": "Você mencionou que o trabalho te consome e que é difícil descansar. Vou te propor algo simples: imagina que seu tempo é um recurso limitado. Como você está distribuindo ele agora?"}
</example>

<example>
<context_hints>
{"language": "pt-br limitado", "avoid": ["diagnóstico emocional", "vocabulário técnico"]}
</context_hints>
<selected_playbook_id>icebreaker.primeiro-contato</selected_playbook_id>
Output esperado:
{"selectionRationale": "Primeiro contato adaptado para proficiência limitada", "linguisticMaterialization": "Oi! Como você está hoje? Pode falar simples, tudo bem."}
</example>

[BLOCO 5 - Repeat critical]
Lembre-se:
- NUNCA vaze identificadores técnicos (dot-notation, nomes de playbooks) na fala ao sujeito.
- Diretivas em <context_hints> são OBRIGATÓRIAS, não sugestões.
- Gere na mesma língua do sujeito; adapte para proficiência limitada quando indicado.
- Retorne APENAS JSON válido, sem markdown fence.
- JSON schema: {"selectionRationale": "string", "linguisticMaterialization": "string"}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
server.registerTool("evaluate_and_select", {
  description: "Avalia candidateActions, seleciona o melhor e materializa linguisticamente",
  inputSchema: {
    sessionId: z.string(),
    candidateActions: z.array(candidateSchema),
    state: z.object({
      sessionId: z.string(),
      trustLevel: z.number(),
      budgetRemaining: z.number(),
      turn: z.number(),
      eventLog: z.array(z.unknown()),
    }),
    persona: z.object({
      id: z.string(),
      name: z.string(),
      age: z.number(),
      profile: z.union([z.record(z.string(), z.unknown()), z.string()]),
    }),
    strategicRationale: z.string().optional().default(""),
    contextHints: z.record(z.string(), z.unknown()).optional().default({}),
  } as any,
}, async (input: EvaluateAndSelectInput) => {
  const { candidateActions, state } = input;
  const scored = scoreActions(candidateActions, state);
  const selected = selectBest(scored);

  const useMock = process.env["USE_MOCK_LLM"] === "true" || !process.env["INFOMANIAK_API_KEY"];
  const systemPrompt = buildDrotaPrompt(input, selected.playbookId);
  const userMessage = `Materialize a ação selecionada em JSON.`;
  const raw = useMock ? await callLlmMock(systemPrompt, userMessage) : await callLlm(systemPrompt, userMessage);

  let parsed: { selectionRationale?: string; linguisticMaterialization?: string } = {};
  try { parsed = JSON.parse(raw); } catch { parsed = { linguisticMaterialization: raw }; }

  const materialization = sanitizeMaterialization(parsed.linguisticMaterialization ?? "");

  const output: EvaluateAndSelectOutput = {
    selectedAction: selected,
    selectionRationale: parsed.selectionRationale ?? selected.rationale,
    actualSacrifice: selected.estimatedSacrifice,
    actualConfidenceGain: selected.estimatedConfidenceGain,
    linguisticMaterialization: materialization,
  };

  return { content: [{ type: "text" as const, text: JSON.stringify(output) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
