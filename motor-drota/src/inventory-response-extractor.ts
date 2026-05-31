/**
 * Inventory Response Extractor v0 — fatia 6 fechando o loop do
 * physical_world_playbook.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-30-physical-world-challenge-piloto-bolo-v0.md
 *
 * Recebe (a) a pergunta de probe que o motor fez no turn anterior e
 * (b) a resposta de texto do sujeito, retorna `Partial<SubjectInventory>`
 * com apenas a dimensão correspondente preenchida.
 *
 * Função PURA — sem estado interno, sem persistência. Caller (futura state
 * machine PendingChallenge ou STS/Bridge) é responsável por acumular as
 * extrações em um `SubjectInventory` completo e propagar via contextHints
 * subject_inventory no próximo planTurn.
 *
 * Estratégia:
 *   1. Heurística determinística primeiro (regex/keywords) — funciona pra
 *      maioria das respostas curtas. Mock mode usa só heurística.
 *   2. Se heurística não extrai nada útil E não está em mock mode, chama LLM
 *      com prompt focado pra extrair o campo específico.
 *   3. Fallback graceful: retorna {} se nada extraído (caller decide se
 *      pergunta novamente ou aceita inventário parcial).
 */

import { callGateway, shouldUseMockLlm } from "@ascendimacy/shared";
import type { SubjectInventory } from "@ascendimacy/shared";

// Mesma união do inventory-probe-agent — espelhada aqui pra evitar dependência
// circular planejador↔motor-drota.
export type InventoryQuestionKind =
  | "materials_around"
  | "time_window"
  | "family_presence"
  | "budget_capacity"
  | "aspirational";

export type ExtractionTarget =
  | "available_materials"
  | "available_time_minutes"
  | "family_present"
  | "available_budget_cents"
  | "aspirational_wishlist";

const KIND_TO_TARGET: Record<InventoryQuestionKind, ExtractionTarget> = {
  materials_around: "available_materials",
  time_window: "available_time_minutes",
  family_presence: "family_present",
  budget_capacity: "available_budget_cents",
  aspirational: "aspirational_wishlist",};

export interface InventoryExtractorInput {
  /** Pergunta que o motor fez no turn anterior. */
  probe_kind: InventoryQuestionKind;
  /** Resposta do sujeito ao probe. */
  subject_response: string;
  /** run_id pra trace correlation. */
  runId?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Heurísticas determinísticas
// ─────────────────────────────────────────────────────────────────────────

const NEGATIVES = /\b(n[aã]o|nada|nenhum[ao]?|ningu[eé]m)\b/i;

function extractMaterials(text: string): string[] {
  // Heurística simples: divide por vírgula/conjunção, filtra palavras
  // pequenas e palavras de função, trim, dedupe.
  if (!text || NEGATIVES.test(text.trim())) return [];
  const parts = text
    .toLowerCase()
    .replace(/\b(tem|tenho|aqui|tipo|na|no|em|um[ao]?|de|d[ao])\b/g, " ")
    .split(/[,;]|\be\b|\bou\b/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const candidate = p.trim().replace(/[.!?;:]+$/, "").trim();
    if (candidate.length >= 3 && candidate.length <= 40 && !seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out.slice(0, 8);
}

function extractTimeMinutes(text: string): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  // Padrão "X horas/h" → X * 60
  const hMatch = lower.match(/(\d+)\s*(?:horas?|hrs?|h\b)/);
  if (hMatch) {
    return parseInt(hMatch[1]!, 10) * 60;
  }
  // Padrão "X minutos/min/m" → X
  const mMatch = lower.match(/(\d+)\s*(?:minutos?|mins?|min\b|m\b)/);
  if (mMatch) {
    return parseInt(mMatch[1]!, 10);
  }
  // Padrão "X" sozinho, presumir minutos se reasonable
  const nMatch = lower.match(/(\d+)/);
  if (nMatch) {
    const n = parseInt(nMatch[1]!, 10);
    if (n >= 5 && n <= 720) return n;
  }
  // Termos qualitativos
  if (/\b(uma )?hora\b/.test(lower)) return 60;
  if (/\b(meia hora|30 ?min)\b/.test(lower)) return 30;
  if (/\b(tarde|manh[aã])\b/.test(lower)) return 180;
  return 0;
}

const RELATIONSHIPS_PT = [
  "pai", "mãe", "mae", "irmão", "irmao", "irmã", "irma",
  "vovô", "vovo", "vovó", "vova", "avô", "avo", "avó",
  "tio", "tia", "primo", "prima",
  "padrasto", "madrasta",
  "babá", "baba", "babysitter",
  "amigo", "amiga", "vizinho", "vizinha",
];

function extractFamilyPresent(text: string): string[] {
  if (!text || NEGATIVES.test(text.trim())) return [];
  const lower = text.toLowerCase();
  const out: string[] = [];
  // \b regex falha pra palavras com acentos finais (ex: irmã, mãe) porque
  // JS regex word boundary considera apenas [a-zA-Z0-9_]. Usamos includes
  // permissivo + dedupe — false positives raros (ex: "pai" em "papai" é OK,
  // ambos indicam relação parental).
  for (const rel of RELATIONSHIPS_PT) {
    if (lower.includes(rel) && !out.includes(rel)) {
      out.push(rel);
    }
  }
  return out;
}

function extractBudgetCents(text: string): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  // R$ X[,YY]
  const rsMatch = lower.match(/r\$\s*(\d+)(?:[.,](\d{1,2}))?/);
  if (rsMatch) {
    const reais = parseInt(rsMatch[1]!, 10);
    const cents = rsMatch[2] ? parseInt(rsMatch[2].padEnd(2, "0"), 10) : 0;
    return reais * 100 + cents;
  }
  // "X reais"
  const reaisMatch = lower.match(/(\d+)\s*(?:reais|real)/);
  if (reaisMatch) {
    return parseInt(reaisMatch[1]!, 10) * 100;
  }
  // Número sozinho, presumir reais se reasonable pro contexto teen
  const nMatch = lower.match(/(\d+)/);
  if (nMatch) {
    const n = parseInt(nMatch[1]!, 10);
    if (n >= 5 && n <= 500) return n * 100;
  }
  // "nada" / "zero"
  if (/\b(nada|zero|0)\b/.test(lower)) return 0;
  return 0;
}

function extractAspirational(text: string): string[] {
  if (!text || text.trim().length < 3) return [];
  if (NEGATIVES.test(text.trim()) && text.trim().length < 20) return [];
  // v0: aceita resposta inteira como 1 item (curador parental pode separar).
  return [text.trim().slice(0, 200)];
}

// ─────────────────────────────────────────────────────────────────────────
// LLM fallback prompt
// ─────────────────────────────────────────────────────────────────────────

function buildLlmPrompt(input: InventoryExtractorInput): string {
  const target = KIND_TO_TARGET[input.probe_kind];
  const fieldHint = {
    available_materials: 'array de strings — materiais/itens concretos mencionados (ex: ["ovos","farinha"])',
    available_time_minutes: "number — minutos totais disponíveis (converte horas para minutos)",
    family_present: 'array de strings — relações familiares presentes (ex: ["pai","irmão"])',
    available_budget_cents: "number — dinheiro disponível em CENTAVOS (multiplica reais por 100)",
    aspirational_wishlist: 'array de strings — desejo(s) declarado(s) como itens (ex: ["fazer bolo"])',
  }[target];

  return `Você extrai informação concreta da resposta de um adolescente a uma pergunta de inventário físico.

Pergunta feita (kind=${input.probe_kind}): apurar ${target}
Resposta do sujeito: "${input.subject_response}"

Extraia APENAS o que o sujeito declarou. Não invente. Se a resposta for negativa ("não tenho", "nada"), retorne valor vazio apropriado (0 ou []).

OUTPUT JSON único:
{ "value": <${fieldHint}> }`;
}

function parseLlmExtraction(
  raw: string,
  target: ExtractionTarget,
): Partial<SubjectInventory> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : cleaned;
  try {
    const obj = JSON.parse(candidate) as { value?: unknown };
    const value = obj.value;
    switch (target) {
      case "available_time_minutes":
      case "available_budget_cents":
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          return { [target]: Math.round(value) } as Partial<SubjectInventory>;
        }
        return {};
      case "available_materials":
      case "family_present":
      case "aspirational_wishlist": {
        if (Array.isArray(value)) {
          const filtered = value
            .filter((v) => typeof v === "string" && v.trim().length > 0)
            .map((v) => (v as string).trim());
          return { [target]: filtered } as Partial<SubjectInventory>;
        }
        return {};
      }
    }
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

function heuristicExtract(input: InventoryExtractorInput): Partial<SubjectInventory> {
  const target = KIND_TO_TARGET[input.probe_kind];
  switch (target) {
    case "available_materials": {
      const arr = extractMaterials(input.subject_response);
      return arr.length > 0 ? { available_materials: arr } : {};
    }
    case "available_time_minutes": {
      const n = extractTimeMinutes(input.subject_response);
      return n > 0 ? { available_time_minutes: n } : {};
    }
    case "family_present": {
      const arr = extractFamilyPresent(input.subject_response);
      return arr.length > 0 ? { family_present: arr } : {};
    }
    case "available_budget_cents": {
      const n = extractBudgetCents(input.subject_response);
      // 0 é resposta válida (sujeito disse "nada"); detectamos via NEGATIVES
      if (NEGATIVES.test(input.subject_response.trim())) {
        return { available_budget_cents: 0 };
      }
      return n > 0 ? { available_budget_cents: n } : {};
    }
    case "aspirational_wishlist": {
      const arr = extractAspirational(input.subject_response);
      return arr.length > 0 ? { aspirational_wishlist: arr } : {};
    }
  }
}

export async function extractInventoryFromResponse(
  input: InventoryExtractorInput,
): Promise<Partial<SubjectInventory>> {
  if (!input.subject_response || input.subject_response.trim().length === 0) {
    return {};
  }

  // 1. Heurística primeiro — barato + previsível
  const heuristic = heuristicExtract(input);
  const hasResult = Object.keys(heuristic).length > 0;

  // Mock mode: só heurística
  if (shouldUseMockLlm("drota")) {
    return heuristic;
  }

  // Heurística funcionou: retorna direto
  if (hasResult) return heuristic;

  // 2. LLM fallback quando heurística não extraiu
  try {
    const systemPrompt = buildLlmPrompt(input);
    const result = await callGateway({
      step: "drota",
      systemPrompt,
      userMessage: `Extraia agora. JSON único.`,
      maxTokens: 200,
      ...(input.runId ? { run_id: input.runId } : {}),
    });
    return parseLlmExtraction(result.content, KIND_TO_TARGET[input.probe_kind]);
  } catch {
    return {};
  }
}
