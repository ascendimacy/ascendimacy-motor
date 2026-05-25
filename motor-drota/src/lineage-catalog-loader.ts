/**
 * Loader do Lineage Catalog YAML — motor-drota.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-25-subject-knowledge-bridge.md §2.
 *
 * Carrega motor-drota/data/lineage-catalog.yaml, valida estrutura,
 * disponibiliza API para consulta (filtrada por cultural_filter parental).
 *
 * Falha hard se validação produz qualquer issue de nível "error" — não
 * deixa o sistema rodar com catálogo inconsistente que viole redundância
 * mínima por eixo (≥3 tradições distintas).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  validateLineageCatalog,
  type LineageCatalog,
  type LineageCatalogValidationIssue,
} from "@ascendimacy/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Path default do catálogo YAML; sobe da pasta dist/ até motor-drota/data/. */
export const DEFAULT_CATALOG_PATH = join(
  __dirname,
  "..",
  "data",
  "lineage-catalog.yaml",
);

export interface LoadCatalogOptions {
  /** Override do path (útil em tests). Default: motor-drota/data/lineage-catalog.yaml */
  path?: string;
  /** Se true (default), throw em issues de nível "error". Se false, retorna catálogo + issues. */
  strict?: boolean;
}

export interface LoadCatalogResult {
  catalog: LineageCatalog;
  issues: LineageCatalogValidationIssue[];
}

/**
 * Carrega e valida o catálogo. Em strict mode (default), lança erro
 * se qualquer issue de nível "error" for encontrado.
 */
export function loadLineageCatalog(opts: LoadCatalogOptions = {}): LoadCatalogResult {
  const path = opts.path ?? DEFAULT_CATALOG_PATH;
  const strict = opts.strict ?? true;

  const raw = readFileSync(path, "utf-8");
  const parsed = yaml.load(raw);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(`lineage-catalog: YAML root inválido em ${path}`);
  }
  const catalog = parsed as LineageCatalog;
  if (!Array.isArray(catalog.axes)) {
    throw new Error(`lineage-catalog: campo 'axes' obrigatório (array) em ${path}`);
  }

  const issues = validateLineageCatalog(catalog);
  if (strict) {
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length > 0) {
      const summary = errors
        .map((i) => `  [${i.code}] ${i.message}`)
        .join("\n");
      throw new Error(
        `lineage-catalog: ${errors.length} erro(s) de validação:\n${summary}`,
      );
    }
  }

  return { catalog, issues };
}

/**
 * Singleton lazy — primeira chamada carrega; subsequentes retornam cache.
 * Reset via resetCatalogCache() em testes.
 */
let cachedCatalog: LineageCatalog | undefined;

export function getCatalog(): LineageCatalog {
  if (cachedCatalog === undefined) {
    cachedCatalog = loadLineageCatalog().catalog;
  }
  return cachedCatalog;
}

export function resetCatalogCache(): void {
  cachedCatalog = undefined;
}
