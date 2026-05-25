/**
 * Lineage Catalog — vocabulário fechado de tradições clássicas usado
 * pelo Tutor para compor o sujeito-proposto via ponte tripla.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-25-subject-knowledge-bridge.md §2.
 *
 * Tipos canônicos cross-workspace. Loader + YAML em motor-drota/.
 *
 * Princípio de redundância (auditado na validação):
 *   cada eixo (1..12) deve ter ≥3 complementos de tradições distintas
 *   pra honrar opt-in parental sem cair em coerção mascarada.
 */

/** Vocabulário fechado das 9 tradições disponíveis na v1. */
export type LineageTradition =
  | "aristotelica"
  | "paideia"
  | "estoica"
  | "bushido"
  | "zen"
  | "cristã"
  | "hebraica"
  | "confucionista"
  | "taoista";

export const LINEAGE_TRADITIONS: readonly LineageTradition[] = [
  "aristotelica",
  "paideia",
  "estoica",
  "bushido",
  "zen",
  "cristã",
  "hebraica",
  "confucionista",
  "taoista",
] as const;

/** Famílias do catálogo (3 famílias × 4 eixos = 12 eixos). */
export type CatalogFamily = "carater" | "disposicao" | "cognicao_si";

export const CATALOG_FAMILIES: readonly CatalogFamily[] = [
  "carater",
  "disposicao",
  "cognicao_si",
] as const;

/**
 * Um complemento clássico = elemento atômico do catálogo.
 *
 * id é único globalmente (ex: "phronesis"); appears em apenas um eixo
 * (exceto raros casos de overlap intencional documentados no campo
 * shared_with_axes).
 */
export interface LineageComplement {
  id: string;
  lineage: LineageTradition;
  /** 1..12 do catálogo */
  axis_id: number;
  /** Definição-resumo (1-2 linhas). */
  short_definition: string;
  /** Exemplo aplicado ao desenvolvimento infantil/adolescente. */
  youth_example: string;
  /** Eixos secundários onde o conceito também se aplica (uso raro). */
  shared_with_axes?: number[];
}

export interface LineageAxis {
  id: number;
  family: CatalogFamily;
  name: string;
  /** O que esse eixo balanceia / corrige. */
  balances: string[];
  complements: LineageComplement[];
}

export interface LineageCatalog {
  version: number;
  axes: LineageAxis[];
}

/**
 * Resultado da validação estrutural — usado tanto no loader quanto
 * em testes/ferramentas.
 */
export interface LineageCatalogValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  axis_id?: number;
  complement_id?: string;
}

export function validateLineageCatalog(
  cat: LineageCatalog,
): LineageCatalogValidationIssue[] {
  const issues: LineageCatalogValidationIssue[] = [];
  const seenComplementIds = new Set<string>();
  const seenAxisIds = new Set<number>();

  if (cat.axes.length !== 12) {
    issues.push({
      level: "error",
      code: "axis_count_mismatch",
      message: `esperado 12 eixos, encontrei ${cat.axes.length}`,
    });
  }

  for (const axis of cat.axes) {
    if (axis.id < 1 || axis.id > 12) {
      issues.push({
        level: "error",
        code: "axis_id_out_of_range",
        message: `axis_id ${axis.id} fora de 1..12`,
        axis_id: axis.id,
      });
    }
    if (seenAxisIds.has(axis.id)) {
      issues.push({
        level: "error",
        code: "axis_id_duplicate",
        message: `axis_id ${axis.id} duplicado`,
        axis_id: axis.id,
      });
    }
    seenAxisIds.add(axis.id);
    if (!CATALOG_FAMILIES.includes(axis.family)) {
      issues.push({
        level: "error",
        code: "axis_family_invalid",
        message: `family '${axis.family}' inválida`,
        axis_id: axis.id,
      });
    }

    // Redundância por eixo: ≥3 tradições distintas
    const traditionsInAxis = new Set(axis.complements.map((c) => c.lineage));
    if (traditionsInAxis.size < 3) {
      issues.push({
        level: "error",
        code: "axis_redundancy_insufficient",
        message: `eixo ${axis.id} tem só ${traditionsInAxis.size} tradição(ões) — mínimo 3 pra honrar opt-in`,
        axis_id: axis.id,
      });
    }

    for (const c of axis.complements) {
      if (c.axis_id !== axis.id) {
        issues.push({
          level: "error",
          code: "complement_axis_mismatch",
          message: `complemento '${c.id}' declara axis_id=${c.axis_id} mas está dentro do eixo ${axis.id}`,
          axis_id: axis.id,
          complement_id: c.id,
        });
      }
      if (!LINEAGE_TRADITIONS.includes(c.lineage)) {
        issues.push({
          level: "error",
          code: "complement_lineage_invalid",
          message: `complemento '${c.id}' usa tradição '${c.lineage}' fora do vocabulário`,
          axis_id: axis.id,
          complement_id: c.id,
        });
      }
      if (seenComplementIds.has(c.id) && c.shared_with_axes === undefined) {
        issues.push({
          level: "error",
          code: "complement_id_duplicate",
          message: `complemento '${c.id}' duplicado e sem shared_with_axes`,
          axis_id: axis.id,
          complement_id: c.id,
        });
      }
      seenComplementIds.add(c.id);
    }

    // família esperada por eixo (spec §2)
    const expectedFamily = expectedFamilyForAxis(axis.id);
    if (expectedFamily !== null && axis.family !== expectedFamily) {
      issues.push({
        level: "warning",
        code: "axis_family_unexpected",
        message: `eixo ${axis.id} esperado family '${expectedFamily}', got '${axis.family}'`,
        axis_id: axis.id,
      });
    }
  }

  return issues;
}

/** Mapeamento spec §2: eixos 1-4 Caráter, 5-8 Disposição, 9-12 Cognição-de-si. */
export function expectedFamilyForAxis(axisId: number): CatalogFamily | null {
  if (axisId >= 1 && axisId <= 4) return "carater";
  if (axisId >= 5 && axisId <= 8) return "disposicao";
  if (axisId >= 9 && axisId <= 12) return "cognicao_si";
  return null;
}

/** Filtra complementos de um eixo segundo allowed/blocked do filtro cultural parental. */
export function getComplementsForAxis(
  cat: LineageCatalog,
  axisId: number,
  filter?: { allowed?: LineageTradition[]; blocked?: LineageTradition[] },
): LineageComplement[] {
  const axis = cat.axes.find((a) => a.id === axisId);
  if (!axis) return [];
  const allowed = filter?.allowed;
  const blocked = filter?.blocked ?? [];
  return axis.complements.filter((c) => {
    if (blocked.includes(c.lineage)) return false;
    if (allowed !== undefined && allowed.length > 0 && !allowed.includes(c.lineage)) {
      return false;
    }
    return true;
  });
}

/** Encontra um eixo por ID. */
export function getAxis(cat: LineageCatalog, axisId: number): LineageAxis | undefined {
  return cat.axes.find((a) => a.id === axisId);
}

/** Encontra um complemento por ID (procura em todos os eixos). */
export function getComplement(
  cat: LineageCatalog,
  complementId: string,
): LineageComplement | undefined {
  for (const axis of cat.axes) {
    const c = axis.complements.find((x) => x.id === complementId);
    if (c) return c;
  }
  return undefined;
}
