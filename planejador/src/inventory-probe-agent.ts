/**
 * Inventory Probe Agent v0 — gera perguntas curtas que mapeiam o que o
 * sujeito TEM DISPONÍVEL agora (materiais, tempo, família presente, orçamento,
 * desejos) — input para o Strategist compor um EmergentPlaybook.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-30-physical-world-challenge-piloto-bolo-v0.md §5.1
 *
 * v0 scope: APENAS função de geração de perguntas — sem extrator de respostas
 * (extrair SubjectInventory das mensagens do sujeito é PR separada). Sem
 * integração com pipeline do motor. Output paralelo ao DiscoveryOption mas
 * com kind específico.
 *
 * Padrão idêntico ao Discovery Agent: LLM-augmented com fallback determinístico.
 *
 * Quando perguntar:
 *   - 5 perguntas-base cobrem inventário completo (1 por dimensão)
 *   - Agent pula dimensões já no `partial_inventory` — só pergunta o que falta
 *   - Output máximo 5 perguntas; mínimo 1 (se inventário quase completo)
 */

import { callLlm } from "./llm-client.js";
import {
  shouldUseMockLlm,
  type SubjectInventory,
} from "@ascendimacy/shared";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export type InventoryQuestionKind =
  | "materials_around"      // o que tem por perto
  | "time_window"           // quanto tempo livre
  | "family_presence"       // quem tá em casa
  | "budget_capacity"       // quanto dinheiro
  | "aspirational";         // o que sempre quis fazer

export interface InventoryProbeQuestion {
  kind: InventoryQuestionKind;
  text: string;
  /** Hint para extrator (PR futura) — qual campo de SubjectInventory popular. */
  expected_extraction_target:
    | "available_materials"
    | "available_time_minutes"
    | "family_present"
    | "available_budget_cents"
    | "aspirational_wishlist";
}

export interface InventoryProbeInput {
  recentTurns: Array<{ role: "user" | "assistant"; content: string }>;
  subjectName: string;
  subjectAge?: number;
  /** Inventário já parcial — agent pula perguntas dessas dimensões. */
  partial_inventory?: Partial<SubjectInventory>;
  run_id?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Kind → extraction target mapping (estável; cada kind sempre puxa o mesmo
// campo do SubjectInventory)
// ─────────────────────────────────────────────────────────────────────────

const KIND_TO_TARGET: Record<
  InventoryQuestionKind,
  InventoryProbeQuestion["expected_extraction_target"]
> = {
  materials_around: "available_materials",
  time_window: "available_time_minutes",
  family_presence: "family_present",
  budget_capacity: "available_budget_cents",
  aspirational: "aspirational_wishlist",
};

// ─────────────────────────────────────────────────────────────────────────
// Detecta dimensões já preenchidas no partial_inventory
// ─────────────────────────────────────────────────────────────────────────

function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "number") return value > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.length > 0;
  return false;
}

function missingKinds(
  partial: Partial<SubjectInventory> | undefined,
): InventoryQuestionKind[] {
  if (!partial) {
    return [
      "materials_around",
      "time_window",
      "family_presence",
      "budget_capacity",
      "aspirational",
    ];
  }
  const out: InventoryQuestionKind[] = [];
  if (!isFilled(partial.available_materials)) out.push("materials_around");
  if (!isFilled(partial.available_time_minutes)) out.push("time_window");
  if (!isFilled(partial.family_present)) out.push("family_presence");
  if (!isFilled(partial.available_budget_cents)) out.push("budget_capacity");
  if (!isFilled(partial.aspirational_wishlist)) out.push("aspirational");
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Fallback determinístico — 5 perguntas-base ajustadas por idade
// ─────────────────────────────────────────────────────────────────────────

function buildFallbackQuestions(
  input: InventoryProbeInput,
): InventoryProbeQuestion[] {
  const kinds = missingKinds(input.partial_inventory);
  // Tom mais infantil para < 10, mais direto para 10+
  const isLudic = (input.subjectAge ?? 12) < 10;
  const subj = input.subjectName;

  const BASE: Record<InventoryQuestionKind, string> = isLudic
    ? {
        materials_around: `${subj}, olha em volta — vê alguma coisa legal pra mexer com a mão? Pode ser comida, brinquedo, ferramenta.`,
        time_window: "Quanto tempo você tem antes de ter que fazer outra coisa hoje?",
        family_presence: "Quem tá em casa contigo agora?",
        budget_capacity:
          "Se valer a pena, dá pra usar um pouquinho de dinheiro? Quanto?",
        aspirational:
          "Tem alguma coisa que você sempre quis fazer mas nunca rolou?",
      }
    : {
        materials_around: `${subj}, olha em volta — tem algo útil pra construir, cozinhar ou montar alguma coisa? Pode ser cozinha, ferramenta, qualquer coisa concreta.`,
        time_window:
          "Quanto tempo de hoje você tem livre, sem ninguém te chamar?",
        family_presence: "Tem alguém em casa agora? Quem?",
        budget_capacity:
          "Quanto dinheiro você poderia gastar se valesse a pena pra algo real?",
        aspirational:
          "Tem uma coisa que você sempre quis fazer mas nunca teve tempo ou material?",
      };

  return kinds.map((k) => ({
    kind: k,
    text: BASE[k],
    expected_extraction_target: KIND_TO_TARGET[k],
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// Parser defensivo
// ─────────────────────────────────────────────────────────────────────────

const VALID_KINDS = new Set<string>([
  "materials_around",
  "time_window",
  "family_presence",
  "budget_capacity",
  "aspirational",
]);

function parseInventoryQuestions(
  raw: string,
): InventoryProbeQuestion[] | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  const candidate = match ? match[0] : cleaned;
  try {
    const arr = JSON.parse(candidate);
    if (!Array.isArray(arr)) return null;
    const out: InventoryProbeQuestion[] = [];
    for (const x of arr) {
      if (
        typeof x?.kind === "string" &&
        VALID_KINDS.has(x.kind) &&
        typeof x?.text === "string" &&
        x.text.length > 0
      ) {
        const kind = x.kind as InventoryQuestionKind;
        out.push({
          kind,
          text: x.text,
          expected_extraction_target: KIND_TO_TARGET[kind],
        });
      }
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(input: InventoryProbeInput): string {
  const missing = missingKinds(input.partial_inventory);
  const missingList =
    missing.length > 0 ? missing.join(", ") : "(inventário completo)";
  const ageHint = input.subjectAge
    ? `${input.subjectAge} anos`
    : "(idade não declarada)";
  const recent = input.recentTurns
    .slice(-3)
    .map((t) => `${t.role}: "${t.content.slice(0, 100)}"`)
    .join("\n");

  return `Você é o Inventory Probe Agent do Ascendimacy. Gere perguntas curtas pra mapear o que o sujeito TEM DISPONÍVEL agora (materiais físicos, tempo, família presente, dinheiro, desejos não realizados). Esse inventário vai virar input pro Strategist compor um desafio físico real.

REGRAS ABSOLUTAS:
- 1 pergunta por dimensão (nunca duas pra mesma)
- APENAS pra dimensões na lista de FALTANTES abaixo
- Pergunta curta, concreta, sem teoria
- NÃO faça pergunta sobre sentimento ou abstração
- Cada pergunta tem o "kind" exato da lista abaixo

KINDS DISPONÍVEIS (use APENAS estes):
- materials_around: o que tem fisicamente disponível pra usar
- time_window: quanto tempo livre tem hoje
- family_presence: quem está em casa agora
- budget_capacity: quanto dinheiro pode usar se valer a pena
- aspirational: o que sempre quis fazer mas nunca rolou

CONTEXTO:
Sujeito: ${input.subjectName} (${ageHint})
Conversa recente:
${recent || "(início da conversa)"}

DIMENSÕES FALTANTES (gere 1 pergunta pra CADA): ${missingList}

OUTPUT — APENAS JSON ARRAY:
[
  { "kind": "materials_around", "text": "..." },
  { "kind": "time_window", "text": "..." }
]`;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

export async function generateInventoryProbeQuestions(
  input: InventoryProbeInput,
): Promise<InventoryProbeQuestion[]> {
  const missing = missingKinds(input.partial_inventory);
  if (missing.length === 0) {
    return [];
  }

  if (shouldUseMockLlm("planejador")) {
    return buildFallbackQuestions(input);
  }

  const systemPrompt = buildSystemPrompt(input);
  const userMessage = `Gere as perguntas em JSON array. Apenas para as dimensões faltantes.`;

  try {
    const result = await callLlm(systemPrompt, userMessage);
    const parsed = parseInventoryQuestions(result.content);
    if (parsed && parsed.length >= 1) {
      // Filtra pra garantir que não veio kind já preenchido (LLM pode ignorar instruction)
      const missingSet = new Set(missing);
      const filtered = parsed.filter((q) => missingSet.has(q.kind));
      if (filtered.length > 0) return filtered;
    }
    return buildFallbackQuestions(input);
  } catch {
    return buildFallbackQuestions(input);
  }
}
