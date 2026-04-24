/**
 * Parental authorization pipeline — 3 camadas do §6 paper:
 *   1. Divergência: eBerrante (planejador) gera 3-5 alternativas (pool).
 *   2. Triagem: Claude Haiku filtra e rankeia pelo ParentalProfile.
 *   3. Decisão: pais aprovam/rejeitam/pinam; parent_pinned propaga pro scorer.
 *
 * Este módulo contém a camada (2): filter pipeline puro + helper async
 * pra chamada do Haiku. A camada (3) vive em motor-execucao (persistência).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-24-ebrota-learning-mechanics-paper.md §6
 * Handoff: Bloco 4 do #17.
 */

import type { ScoredContentItem, ContentItem } from "./content-item.js";
import type { ParentalProfile, ForbiddenZone } from "./parental-profile.js";

export interface TriageResult {
  /** Items aprovados pela triagem (aceitáveis pra pais). */
  approved: ScoredContentItem[];
  /** Items rejeitados por algum gate. */
  rejected: Array<ScoredContentItem & { reject_reason: string }>;
  /** Se Haiku foi consultado ou só filtro rule-based. */
  triage_mode: "rule_based" | "haiku";
  /** Tempo de triagem em ms (pra trace). */
  duration_ms: number;
}

export interface TriageInput {
  pool: ScoredContentItem[];
  profile: ParentalProfile;
  /** Top-K máximo após triagem. Default: min(2, pool.length). */
  max_approved?: number;
}

/**
 * Filtro rule-based — não chama LLM. Aplica forbidden_zones, age, budget.
 * Pode ser usado standalone OU como fallback quando Haiku indisponível.
 */
export function triageRuleBased(input: TriageInput): TriageResult {
  const started = Date.now();
  const { pool, profile } = input;
  const maxApproved = input.max_approved ?? Math.min(2, pool.length);

  const approved: ScoredContentItem[] = [];
  const rejected: TriageResult["rejected"] = [];

  for (const scored of pool) {
    const reject = evaluateAgainstProfile(scored.item, profile);
    if (reject) {
      rejected.push({ ...scored, reject_reason: reject });
    } else {
      approved.push(scored);
    }
  }

  approved.sort((a, b) => b.score - a.score);
  const topApproved = approved.slice(0, maxApproved);
  const filteredOut = approved.slice(maxApproved);
  for (const filtered of filteredOut) {
    rejected.push({ ...filtered, reject_reason: "below_max_approved_cutoff" });
  }

  return {
    approved: topApproved,
    rejected,
    triage_mode: "rule_based",
    duration_ms: Date.now() - started,
  };
}

function evaluateAgainstProfile(
  item: ContentItem,
  profile: ParentalProfile,
): string | null {
  // 1. Forbidden zones — match por domain + texto livre.
  for (const zone of profile.forbidden_zones) {
    if (matchesForbiddenZone(item, zone)) {
      return `forbidden_zone:${zone.topic}`;
    }
  }

  // 2. Scale tolerance — sacrifice_type 'act'/'create' pede 'medio' tolerance no mínimo.
  const sacrificeType = (item as ContentItem & { sacrifice_type?: string }).sacrifice_type;
  const tolerance = profile.parental_availability.scale_tolerance;
  if (tolerance) {
    if (
      (sacrificeType === "act" || sacrificeType === "create") &&
      (tolerance.medio === "no" || tolerance.pequeno === "no")
    ) {
      return "scale_tolerance_blocks_act_or_create";
    }
  }

  return null;
}

function matchesForbiddenZone(item: ContentItem, zone: ForbiddenZone): boolean {
  const topic = zone.topic.toLowerCase();
  const hay = [
    item.domain ?? "",
    (item as ContentItem & { fact?: string }).fact ?? "",
    (item as ContentItem & { bridge?: string }).bridge ?? "",
    (item as ContentItem & { quest?: string }).quest ?? "",
    (item as ContentItem & { title?: string }).title ?? "",
    (item as ContentItem & { description?: string }).description ?? "",
  ]
    .join(" ")
    .toLowerCase();
  // Match naïve por substring do topic em qualquer campo textual.
  if (hay.includes(topic)) return true;
  // Match de dominio específico pra topics canônicos.
  if (topic === "political_content" && /politic|political/i.test(item.domain)) return true;
  if (topic === "religious_proselytizing" && /relig|religion|teolog/i.test(item.domain)) return true;
  return false;
}

/**
 * Triage via Claude Haiku — input/output estruturados, prompt curto.
 * Assinado assincronamente; caller decide mock vs real via env.
 *
 * Se Haiku falhar (timeout, parse error), cai em rule_based pra resiliência.
 */
export interface HaikuCaller {
  (systemPrompt: string, userMessage: string): Promise<string>;
}

export async function triageWithHaiku(
  input: TriageInput,
  callHaiku: HaikuCaller,
): Promise<TriageResult> {
  const started = Date.now();
  const { pool, profile } = input;
  const maxApproved = input.max_approved ?? Math.min(2, pool.length);

  // Rule-based pre-filter: sempre primeiro (cheap gate). Haiku só reordena.
  const prefilter = triageRuleBased({ ...input, max_approved: pool.length });
  if (prefilter.approved.length === 0) {
    return { ...prefilter, duration_ms: Date.now() - started };
  }

  const systemPrompt = buildHaikuSystemPrompt(profile);
  const userMessage = buildHaikuUserMessage(prefilter.approved);

  let parsed: { ranking: string[] } | null = null;
  try {
    const raw = await callHaiku(systemPrompt, userMessage);
    parsed = parseHaikuResponse(raw);
  } catch {
    // Fallback silencioso pro rule_based.
    return {
      approved: prefilter.approved.slice(0, maxApproved),
      rejected: [
        ...prefilter.rejected,
        ...prefilter.approved.slice(maxApproved).map((s) => ({
          ...s,
          reject_reason: "below_max_approved_cutoff",
        })),
      ],
      triage_mode: "rule_based",
      duration_ms: Date.now() - started,
    };
  }

  if (!parsed || !Array.isArray(parsed.ranking)) {
    return {
      approved: prefilter.approved.slice(0, maxApproved),
      rejected: prefilter.rejected,
      triage_mode: "rule_based",
      duration_ms: Date.now() - started,
    };
  }

  const byId = new Map(prefilter.approved.map((s) => [s.item.id, s]));
  const reordered: ScoredContentItem[] = [];
  for (const id of parsed.ranking) {
    const s = byId.get(id);
    if (s) reordered.push(s);
  }
  // Items que Haiku omitiu — vão pro rejeitado.
  const omittedIds = new Set(
    prefilter.approved.map((s) => s.item.id).filter((id) => !reordered.find((r) => r.item.id === id)),
  );
  const rejected = [
    ...prefilter.rejected,
    ...Array.from(omittedIds).map((id) => {
      const s = prefilter.approved.find((x) => x.item.id === id)!;
      return { ...s, reject_reason: "haiku_omitted" };
    }),
  ];
  const topK = reordered.slice(0, maxApproved);
  for (const dropped of reordered.slice(maxApproved)) {
    rejected.push({ ...dropped, reject_reason: "below_max_approved_cutoff" });
  }

  return {
    approved: topK,
    rejected,
    triage_mode: "haiku",
    duration_ms: Date.now() - started,
  };
}

function buildHaikuSystemPrompt(profile: ParentalProfile): string {
  const values = profile.family_values.principles.slice(0, 5).map((p) => `- ${p}`).join("\n");
  const forbidden = profile.forbidden_zones.map((z) => `- ${z.topic}: ${z.reason}`).join("\n");
  return `Você é um filtro parental leve. Recebe uma lista curta de propostas de conteúdo pedagógico pra criança, cada uma com id + resumo. Seu trabalho é RERANKEAR por alinhamento com os valores da família.

Valores declarados:
${values}

Zonas proibidas:
${forbidden}

Output obrigatório: JSON {"ranking": ["id1", "id2", ...]}. Omita o que viola valores; não invente ids.`;
}

function buildHaikuUserMessage(pool: ScoredContentItem[]): string {
  const entries = pool.map((s) => {
    const it = s.item as ContentItem & { fact?: string; bridge?: string };
    const summary = `[${it.type}] ${it.domain}: ${it.fact ?? ""} → ${it.bridge ?? ""}`.slice(0, 180);
    return `- ${it.id}: ${summary}`;
  });
  return `Propostas:\n${entries.join("\n")}\n\nRerankeie.`;
}

function parseHaikuResponse(raw: string): { ranking: string[] } | null {
  const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as { ranking?: unknown };
    if (!Array.isArray(parsed.ranking)) return null;
    return { ranking: parsed.ranking.filter((x): x is string => typeof x === "string") };
  } catch {
    return null;
  }
}

/**
 * Dispatch entry: chama Haiku se disponível, senão rule_based.
 * Mode controlado por env USE_MOCK_LLM — se mock, força rule_based.
 */
export async function triageForParents(
  input: TriageInput,
  callHaiku?: HaikuCaller,
): Promise<TriageResult> {
  if (!callHaiku) return triageRuleBased(input);
  return triageWithHaiku(input, callHaiku);
}
