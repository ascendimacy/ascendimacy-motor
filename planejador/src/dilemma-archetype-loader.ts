/**
 * Loader do Philosophical Dilemma Archetype Catalog v1.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-30-physical-world-challenge-piloto-bolo-v0.md §5.4
 *
 * Carrega planejador/data/dilemma-archetypes.yaml, valida estrutura,
 * oferece consulta filtrada por virtude / trigger. Strategist composer
 * consome este loader pra escolher quais dilemas plantar em quais steps.
 *
 * Padrão idêntico ao playbook-moves-loader.ts (motor-drota).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DEFAULT_DILEMMA_CATALOG_PATH = join(
  __dirname,
  "..",
  "data",
  "dilemma-archetypes.yaml",
);

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export type DilemmaTrigger =
  | "step_complete"
  | "step_midway"
  | "evidence_received";

export type DilemmaEvaluationFocus =
  | "raciocinio"
  | "consistencia_com_valor_declarado"
  | "consideracao_do_outro";

export interface DilemmaArchetype {
  id: string;
  virtue_tested: string;
  evaluation_focus: DilemmaEvaluationFocus;
  applicable_triggers: DilemmaTrigger[];
  prompt_template: string;
  description: string;
}

export interface DilemmaCatalog {
  version: number;
  archetypes: DilemmaArchetype[];
}

export interface LoadOptions {
  path?: string;
  strict?: boolean;
}

export interface ValidationIssue {
  level: "error" | "warning";
  archetype_id?: string;
  message: string;
}

export interface LoadCatalogResult {
  catalog: DilemmaCatalog;
  issues: ValidationIssue[];
}

// ─────────────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────────────

const VALID_FOCUS = new Set<DilemmaEvaluationFocus>([
  "raciocinio",
  "consistencia_com_valor_declarado",
  "consideracao_do_outro",
]);

const VALID_TRIGGERS = new Set<DilemmaTrigger>([
  "step_complete",
  "step_midway",
  "evidence_received",
]);

function validateArchetype(
  raw: unknown,
  index: number,
): { ok: DilemmaArchetype | null; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!raw || typeof raw !== "object") {
    issues.push({
      level: "error",
      message: `archetype[${index}] não é um objeto`,
    });
    return { ok: null, issues };
  }
  const r = raw as Record<string, unknown>;
  const id = typeof r["id"] === "string" ? (r["id"] as string) : "";
  if (!id) {
    issues.push({
      level: "error",
      message: `archetype[${index}] sem 'id'`,
    });
    return { ok: null, issues };
  }
  const virtue = typeof r["virtue_tested"] === "string" ? r["virtue_tested"] : "";
  if (!virtue) {
    issues.push({
      level: "error",
      archetype_id: id,
      message: `'${id}' sem 'virtue_tested'`,
    });
    return { ok: null, issues };
  }
  const focus = r["evaluation_focus"];
  if (typeof focus !== "string" || !VALID_FOCUS.has(focus as DilemmaEvaluationFocus)) {
    issues.push({
      level: "error",
      archetype_id: id,
      message: `'${id}' tem 'evaluation_focus' inválido: ${focus}`,
    });
    return { ok: null, issues };
  }
  const triggersRaw = r["applicable_triggers"];
  if (!Array.isArray(triggersRaw) || triggersRaw.length === 0) {
    issues.push({
      level: "error",
      archetype_id: id,
      message: `'${id}' sem 'applicable_triggers' (array não-vazio)`,
    });
    return { ok: null, issues };
  }
  const triggers: DilemmaTrigger[] = [];
  for (const t of triggersRaw) {
    if (typeof t !== "string" || !VALID_TRIGGERS.has(t as DilemmaTrigger)) {
      issues.push({
        level: "error",
        archetype_id: id,
        message: `'${id}' tem trigger inválido: ${t}`,
      });
      return { ok: null, issues };
    }
    triggers.push(t as DilemmaTrigger);
  }
  const tpl = typeof r["prompt_template"] === "string" ? r["prompt_template"].trim() : "";
  if (!tpl) {
    issues.push({
      level: "error",
      archetype_id: id,
      message: `'${id}' sem 'prompt_template'`,
    });
    return { ok: null, issues };
  }
  const desc = typeof r["description"] === "string" ? r["description"].trim() : "";
  if (!desc) {
    issues.push({
      level: "warning",
      archetype_id: id,
      message: `'${id}' sem 'description' (recomendado)`,
    });
  }
  return {
    ok: {
      id,
      virtue_tested: virtue,
      evaluation_focus: focus as DilemmaEvaluationFocus,
      applicable_triggers: triggers,
      prompt_template: tpl,
      description: desc,
    },
    issues,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

export function loadDilemmaCatalog(
  opts: LoadOptions = {},
): LoadCatalogResult {
  const path = opts.path ?? DEFAULT_DILEMMA_CATALOG_PATH;
  const raw = readFileSync(path, "utf8");
  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`dilemma-archetypes: YAML root inválido em ${path}`);
  }
  const root = parsed as Record<string, unknown>;
  const version = typeof root["version"] === "number" ? (root["version"] as number) : 0;
  const archetypesRaw = root["archetypes"];
  if (!Array.isArray(archetypesRaw)) {
    throw new Error(
      `dilemma-archetypes: campo 'archetypes' obrigatório (array) em ${path}`,
    );
  }

  const archetypes: DilemmaArchetype[] = [];
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < archetypesRaw.length; i++) {
    const { ok, issues: archIssues } = validateArchetype(archetypesRaw[i], i);
    issues.push(...archIssues);
    if (!ok) continue;
    if (seenIds.has(ok.id)) {
      issues.push({
        level: "error",
        archetype_id: ok.id,
        message: `id duplicado: '${ok.id}'`,
      });
      continue;
    }
    seenIds.add(ok.id);
    archetypes.push(ok);
  }

  if (opts.strict) {
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length > 0) {
      throw new Error(
        `dilemma-archetypes: ${errors.length} erros no catálogo:\n${errors
          .map((e) => `  - ${e.message}`)
          .join("\n")}`,
      );
    }
  }

  return {
    catalog: { version, archetypes },
    issues,
  };
}

/** Filtra archetypes por virtude testada. */
export function findArchetypesByVirtue(
  catalog: DilemmaCatalog,
  virtue: string,
): DilemmaArchetype[] {
  return catalog.archetypes.filter((a) => a.virtue_tested === virtue);
}

/** Filtra archetypes que aplicam num trigger específico. */
export function findArchetypesByTrigger(
  catalog: DilemmaCatalog,
  trigger: DilemmaTrigger,
): DilemmaArchetype[] {
  return catalog.archetypes.filter((a) =>
    a.applicable_triggers.includes(trigger),
  );
}
