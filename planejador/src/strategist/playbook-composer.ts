/**
 * Playbook Composer v0 — Strategist function que compõe `EmergentPlaybook`
 * a partir de `SubjectInventory` + axes + objetivos.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-30-physical-world-challenge-piloto-bolo-v0.md §5.2
 *
 * v0 scope: APENAS função pura (input → output via LLM). Sem integração com
 * pipeline do motor. Sem persistência de PendingChallenge. Sem consent
 * parental. Sem Bridge multi-modal. Tudo isso é fase posterior — esta fatia
 * valida o shape do EmergentPlaybook e o prompt do LLM.
 *
 * Fluxo:
 *   1. Mock mode → fallback determinístico (bolo template baseado em inventário)
 *   2. LLM call (step="planejador") com system prompt explícito + JSON output
 *   3. Defensive parse (zod) — se falha de parsing OU schema invalid, fallback
 *   4. Anti-repetição: se playbook_id repetido nos last N, força fallback variante
 */

import { callLlm } from "../llm-client.js";
import {
  shouldUseMockLlm,
  EmergentPlaybookSchema,
  type EmergentPlaybook,
  type PlaybookComposerInput,
  type SubjectInventory,
  type EmergentVirtueTarget,
} from "@ascendimacy/shared";

// ─────────────────────────────────────────────────────────────────────────
// Fallback determinístico — bolo template + 2 dilemas
// ─────────────────────────────────────────────────────────────────────────

function buildFallbackBolo(input: PlaybookComposerInput): EmergentPlaybook {
  const now = new Date().toISOString();
  const id = `piloto-${input.subject_name}-${Date.now()}-fallback`;
  const primary: EmergentVirtueTarget =
    input.current_objectives[0] ?? { axis: "carater", virtue: "persistencia" };
  const secondary: EmergentVirtueTarget[] = input.current_objectives.slice(1, 3);

  return {
    playbook_id: id,
    composed_at: now,
    source_inventory: input.inventory,
    primary_objective: primary,
    secondary_objectives: secondary,
    steps: [
      {
        step_id: "list",
        kind: "shopping_list",
        hint_to_subject:
          "Faz a lista do que falta pra um bolo simples (farinha, ovo, açúcar, leite, fermento).",
        evidence_kind: "text_answer",
        expected_duration_minutes: 5,
      },
      {
        step_id: "buy",
        kind: "execute_recipe_step",
        hint_to_subject: "Compra os ingredientes (limite R$ 30). Tira foto da nota.",
        evidence_kind: "photo",
        expected_duration_minutes: 30,
      },
      {
        step_id: "mix",
        kind: "execute_recipe_step",
        hint_to_subject:
          "Mistura na ordem certa. Tira foto da massa antes do forno.",
        evidence_kind: "photo",
        expected_duration_minutes: 20,
      },
      {
        step_id: "bake",
        kind: "wait",
        hint_to_subject: "Forno 180°C por 35-40min. Não abra a porta antes.",
        evidence_kind: "none",
        expected_duration_minutes: 40,
      },
      {
        step_id: "judge",
        kind: "reflect",
        hint_to_subject:
          "Pronto. Como ficou? Bom ou ruim — descreve sem maquiar.",
        evidence_kind: "text_answer",
        expected_duration_minutes: 5,
      },
      {
        step_id: "share",
        kind: "execute_recipe_step",
        hint_to_subject:
          "Oferece um pedaço pra alguém da família. Anota o que disseram.",
        evidence_kind: "text_answer",
        expected_duration_minutes: 10,
      },
    ],
    total_duration_minutes: 110,
    budget_range_cents: { min: 2000, max: 3000 },
    philosophical_dilemmas: [
      {
        dilemma_id: "dilemma-buy-budget-balance",
        attached_to_step: "buy",
        trigger: "step_complete",
        virtue_tested: "controle",
        prompt:
          "Sobrou R$ 4 do orçamento. Você compra um doce pra você ou guarda? Não tem certo nem errado — me conta o que faz sentido pra você.",
        evaluation_focus: "raciocinio",
      },
      {
        dilemma_id: "dilemma-judge-honesty",
        attached_to_step: "judge",
        trigger: "step_complete",
        virtue_tested: "honestidade",
        prompt:
          "Ficou ok, mas não excelente. Se alguém da família perguntar, você fala 'tá bom' ou descreve o que faltou?",
        evaluation_focus: "consistencia_com_valor_declarado",
      },
    ],
    composition_rationale:
      "Fallback determinístico (bolo template). LLM indisponível ou parsing falhou; sujeito recebe playbook estável de menor risco.",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Prompt construction
// ─────────────────────────────────────────────────────────────────────────

function inventoryAsText(inv: SubjectInventory): string {
  const lines = [
    `- Materiais disponíveis: ${inv.available_materials.join(", ") || "(nenhum declarado)"}`,
    `- Tempo livre: ${inv.available_time_minutes} min`,
    `- Orçamento: R$ ${(inv.available_budget_cents / 100).toFixed(2)}`,
    `- Família presente: ${inv.family_present.join(", ") || "(ninguém declarado)"}`,
    `- Desejos: ${inv.aspirational_wishlist.join(", ") || "(nenhum)"}`,
    `- Confiança do inventário: ${inv.confidence}/3`,
  ];
  return lines.join("\n");
}

function buildSystemPrompt(input: PlaybookComposerInput): string {
  const objLines = input.current_objectives
    .map((o) => `- ${o.axis}: ${o.virtue}`)
    .join("\n");
  const axisList = input.active_axes.join(", ") || "(nenhum ativo)";
  const previous = input.previous_playbook_ids?.length
    ? `\nNÃO repita estes playbook_ids: ${input.previous_playbook_ids.join(", ")}`
    : "";

  return `Você é o Playbook Composer do Ascendimacy. Recebe inventário físico/temporal/social de um sujeito + axes ativos + objetivos parentais. Output: 1 EmergentPlaybook único em JSON.

REGRAS ABSOLUTAS:
- Use APENAS materiais declarados no inventário (não invente coisas)
- Total duration ≤ available_time_minutes do inventário
- Budget_range.max ≤ available_budget_cents do inventário
- 4-6 steps OBRIGATÓRIOS (não menos, não mais)
- 1-3 dilemmas filosóficos atrelados a steps específicos
- Cada dilemma tem prompt curto (≤ 200 chars) + virtue_tested + evaluation_focus
- composition_rationale ≤ 300 chars explicando POR QUE escolheu este playbook${previous}

CONTEXTO:
Sujeito: ${input.subject_name}${input.subject_age ? ` (${input.subject_age} anos)` : ""}
Inventário:
${inventoryAsText(input.inventory)}

Axes ativos: ${axisList}

Objetivos correntes:
${objLines || "(nenhum — escolha primary baseado nos axes ativos)"}

OUTPUT — JSON único conforme schema:
{
  "playbook_id": "string único",
  "composed_at": "ISO8601",
  "source_inventory": <copy of inventory>,
  "primary_objective": { "axis": "...", "virtue": "..." },
  "secondary_objectives": [{ "axis": "...", "virtue": "..." }],
  "steps": [
    {
      "step_id": "string",
      "kind": "shopping_list" | "execute_recipe_step" | "wait" | "reflect",
      "hint_to_subject": "string curta",
      "evidence_kind": "photo" | "voice_memo" | "text_answer" | "parent_confirmation" | "none",
      "expected_duration_minutes": number
    }
  ],
  "total_duration_minutes": number,
  "budget_range_cents": { "min": number, "max": number },
  "philosophical_dilemmas": [
    {
      "dilemma_id": "string",
      "attached_to_step": "<step_id existente>",
      "trigger": "step_complete" | "step_midway" | "evidence_received",
      "virtue_tested": "string",
      "prompt": "string curta",
      "evaluation_focus": "raciocinio" | "consistencia_com_valor_declarado" | "consideracao_do_outro"
    }
  ],
  "composition_rationale": "string"
}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Parser defensivo
// ─────────────────────────────────────────────────────────────────────────

function parsePlaybookJson(raw: string): EmergentPlaybook | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
  // Acha o primeiro objeto JSON top-level
  const match = cleaned.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : cleaned;
  try {
    const obj = JSON.parse(candidate);
    const parsed = EmergentPlaybookSchema.safeParse(obj);
    if (parsed.success) return parsed.data;
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compõe um EmergentPlaybook via LLM. Cai pro fallback determinístico se:
 *   - Mock mode habilitado (USE_MOCK_LLM=true)
 *   - LLM throw (network/timeout)
 *   - JSON parsing falha
 *   - Schema validation falha
 */
export async function composePlaybook(
  input: PlaybookComposerInput,
): Promise<EmergentPlaybook> {
  if (shouldUseMockLlm("planejador")) {
    return buildFallbackBolo(input);
  }

  const systemPrompt = buildSystemPrompt(input);
  const userMessage = `Compose o EmergentPlaybook agora. JSON único.`;

  try {
    const result = await callLlm(systemPrompt, userMessage);
    const parsed = parsePlaybookJson(result.content);
    if (parsed) return parsed;
    return buildFallbackBolo(input);
  } catch {
    return buildFallbackBolo(input);
  }
}
