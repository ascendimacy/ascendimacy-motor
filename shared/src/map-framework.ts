/**
 * MapFramework registry — Fase 8 sub-fase 8.3 (spec §4).
 *
 * Cada framework pedagógico é uma LENTE projetável sobre o subject_knowledge
 * ledger. O sujeito-real é um ponto multi-dim projetado em cada lente
 * independentemente. Adicionar nova lente = registrar projeção, sem migration.
 *
 * Frameworks v1 (release inicial):
 *   - valores_classicos  — catálogo lineage F4 (12 eixos × 9 tradições)
 *   - gardner            — 9 inteligências múltiplas
 *   - casel              — SA/SM/SOC/REL/DM
 *   - dreyfus_by_domain  — Dreyfus level por domínio
 *
 * Registry é singleton lazy — registerFramework antes do primeiro getCatalog.
 */

import type { SubjectKnowledgeEntry } from "./subject-knowledge.js";

export interface MapFramework {
  /** ID único — usado nas tabelas/UI/endpoints. */
  id: string;
  /** Nome humano-legível. */
  display_name: string;
  /** Dimensões da lente (axis IDs, channels, etc — depende do framework). */
  dimensions: readonly string[];
  /** Renderização sugerida pra Console UI. */
  render_hint: "radar" | "bar" | "tree" | "list";
  /**
   * Função de projeção pura: lê entries do ledger e devolve posicionamento
   * do sujeito naquela lente. Map<dimensionId, valor>. O shape do valor é
   * decidido pelo framework (number/object/etc).
   */
  project: (entries: SubjectKnowledgeEntry[]) => Map<string, unknown>;
}

/** Estado projetado por sujeito em todos os frameworks registrados. */
export interface SubjectMapPosition {
  subject_id: string;
  computed_at: string;
  /** frameworkId → (dimensionId → valor). */
  positions: Record<string, Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────────
// Registry — singleton lazy
// ─────────────────────────────────────────────────────────────────────────

const FRAMEWORK_REGISTRY: Map<string, MapFramework> = new Map();

export function registerFramework(fw: MapFramework): void {
  FRAMEWORK_REGISTRY.set(fw.id, fw);
}

export function getFramework(id: string): MapFramework | undefined {
  return FRAMEWORK_REGISTRY.get(id);
}

export function listFrameworks(): MapFramework[] {
  return Array.from(FRAMEWORK_REGISTRY.values());
}

/** Reset — só pra tests. */
export function resetFrameworkRegistry(): void {
  FRAMEWORK_REGISTRY.clear();
  registerDefaultFrameworks();
}

// ─────────────────────────────────────────────────────────────────────────
// Framework: valores_classicos (12 eixos, paideia/aristotélica/etc)
// ─────────────────────────────────────────────────────────────────────────

const VALORES_AXES = Array.from({ length: 12 }, (_, i) => `axis_${i + 1}`);

const valoresClassicos: MapFramework = {
  id: "valores_classicos",
  display_name: "Valores Clássicos (12 eixos)",
  dimensions: VALORES_AXES,
  render_hint: "radar",
  project(entries) {
    const points = new Map<string, number>();
    for (const ax of VALORES_AXES) points.set(ax, 0);
    for (const e of entries) {
      if (e.type === "presented_concept" && e.payload.kind === "presented_concept") {
        const key = `axis_${e.payload.axis_id}`;
        points.set(key, (points.get(key) ?? 0) + e.payload.points);
      } else if (e.type === "recall_check_attempt" && e.payload.kind === "recall_check_attempt") {
        // recall_check positivo soma points_awarded ao axis do concept original
        // — em v1, sem cross-lookup (precisaríamos correlacionar pelo concept_id).
        // Por hora, se points_awarded > 0, atribuímos ao axis 0 marker — caller
        // pode pós-processar com lookup completo.
        if (e.payload.points_awarded > 0) {
          points.set("axis_unknown", (points.get("axis_unknown") ?? 0) + e.payload.points_awarded);
        }
      }
    }
    return new Map(points);
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Framework: gardner (9 inteligências)
// ─────────────────────────────────────────────────────────────────────────

const GARDNER_CHANNELS = [
  "linguistic",
  "logical_mathematical",
  "spatial",
  "musical",
  "bodily_kinesthetic",
  "interpersonal",
  "intrapersonal",
  "naturalist",
  "existential",
] as const;

const gardner: MapFramework = {
  id: "gardner",
  display_name: "Inteligências de Gardner",
  dimensions: GARDNER_CHANNELS,
  render_hint: "bar",
  project(entries) {
    // v1: score por channel = soma de "discovery interest"
    // cujos extracted_keywords (do concept apresentado) batem com channel-name
    // Heurística simples — projeção mais sofisticada em fase futura.
    const scores = new Map<string, number>();
    for (const ch of GARDNER_CHANNELS) scores.set(ch, 0);
    for (const e of entries) {
      if (e.type !== "interest") continue;
      if (e.payload.kind !== "interest") continue;
      const label = (e.payload.label ?? "").toLowerCase();
      for (const ch of GARDNER_CHANNELS) {
        if (label.includes(ch.replace("_", " ")) || label.includes(ch.split("_")[0])) {
          scores.set(ch, (scores.get(ch) ?? 0) + 1);
        }
      }
    }
    return new Map(scores);
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Framework: casel (5 dimensões SEL)
// ─────────────────────────────────────────────────────────────────────────

const CASEL_DIMS = ["SA", "SM", "SOC", "REL", "DM"] as const;

const casel: MapFramework = {
  id: "casel",
  display_name: "CASEL (Aprendizado Socioemocional)",
  dimensions: CASEL_DIMS,
  render_hint: "radar",
  project(entries) {
    // v1: count de presented_concept agrupado por inferência axis→casel
    // Mapeamento aproximado:
    //   axis 1 (Prudência) → DM
    //   axis 2 (Justiça) → SOC
    //   axis 3 (Fortaleza) → SM
    //   axis 4 (Temperança) → SM
    //   axis 5-8 (Disposição) → REL/SOC
    //   axis 9-12 (Cognição-de-si) → SA
    const counts = new Map<string, number>();
    for (const dim of CASEL_DIMS) counts.set(dim, 0);
    for (const e of entries) {
      if (e.type !== "presented_concept" || e.payload.kind !== "presented_concept") continue;
      const dim = axisToCasel(e.payload.axis_id);
      if (dim) counts.set(dim, (counts.get(dim) ?? 0) + 1);
    }
    return new Map(counts);
  },
};

function axisToCasel(axisId: number): string | null {
  if (axisId === 1) return "DM";
  if (axisId === 2) return "SOC";
  if (axisId === 3 || axisId === 4) return "SM";
  if (axisId >= 5 && axisId <= 8) return "REL";
  if (axisId >= 9 && axisId <= 12) return "SA";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Framework: dreyfus_by_domain (level por domínio)
// ─────────────────────────────────────────────────────────────────────────

const dreyfusByDomain: MapFramework = {
  id: "dreyfus_by_domain",
  display_name: "Dreyfus por Domínio",
  dimensions: [], // dinâmico — depende dos domínios observados
  render_hint: "tree",
  project(entries) {
    // v1: agrega menções por domínio (palavra-chave) + heurística simples
    // de level. Refino em fase futura.
    // shape do valor: { mentions: N, level: "novice|apprentice|practitioner|proficient|expert" }
    const byDomain = new Map<string, { mentions: number; level: string }>();
    for (const e of entries) {
      if (e.type !== "interest" && e.type !== "value" && e.type !== "discovery") continue;
      const payload = e.payload as { label?: string };
      const label = (payload.label ?? "").toLowerCase().trim();
      if (label.length === 0) continue;
      // v1: domain = label inteira (não normalizado); refinar com extraction
      const prev = byDomain.get(label) ?? { mentions: 0, level: "novice" };
      const mentions = prev.mentions + 1;
      const level =
        mentions >= 8 ? "proficient" :
        mentions >= 4 ? "practitioner" :
        mentions >= 2 ? "apprentice" : "novice";
      byDomain.set(label, { mentions, level });
    }
    return new Map(byDomain);
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Bootstrap — registra defaults
// ─────────────────────────────────────────────────────────────────────────

function registerDefaultFrameworks(): void {
  registerFramework(valoresClassicos);
  registerFramework(gardner);
  registerFramework(casel);
  registerFramework(dreyfusByDomain);
}

// Auto-register on module load
registerDefaultFrameworks();

// ─────────────────────────────────────────────────────────────────────────
// API pública: computa posição completa do sujeito em todos os frameworks
// ─────────────────────────────────────────────────────────────────────────

export interface ComputeMapPositionsInput {
  subjectId: string;
  entries: SubjectKnowledgeEntry[];
  /** Filtra a lista — undefined = todos os frameworks registrados. */
  frameworkIds?: string[];
}

export function computeMapPositions(
  input: ComputeMapPositionsInput,
): SubjectMapPosition {
  const positions: Record<string, Record<string, unknown>> = {};
  const fws = input.frameworkIds
    ? input.frameworkIds
        .map((id) => FRAMEWORK_REGISTRY.get(id))
        .filter((fw): fw is MapFramework => fw !== undefined)
    : Array.from(FRAMEWORK_REGISTRY.values());
  for (const fw of fws) {
    const map = fw.project(input.entries);
    positions[fw.id] = Object.fromEntries(map.entries());
  }
  return {
    subject_id: input.subjectId,
    computed_at: new Date().toISOString(),
    positions,
  };
}
