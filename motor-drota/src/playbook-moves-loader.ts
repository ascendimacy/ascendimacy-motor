/**
 * Loader do catálogo Playbook Moves YAML.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-25-session-phases-journey-stages-strategist.md §5
 *
 * Carrega motor-drota/data/playbook-moves.yaml, valida estrutura, oferece
 * consulta filtrada por phase / target framework. Strategist consome.
 *
 * Independente do strategy-plan.ts (que define StrategyPlan + composeStrategyPlan).
 * Quando ambos forem usados juntos, motor importa daqui.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DEFAULT_PLAYBOOK_PATH = join(
  __dirname,
  "..",
  "data",
  "playbook-moves.yaml",
);

export type PlaybookPhase =
  | "ice_breaker"
  | "challenge_explain"
  | "challenge_execute"
  | "follow_up";

export interface PlaybookTarget {
  framework: string;
  goal: string;
}

export interface PlaybookMoveSpec {
  id: string;
  phase: PlaybookPhase;
  estimated_minutes: number;
  framing_template: string;
  success_signal: string;
  targets?: PlaybookTarget[];
  notes?: string;
}

export interface PlaybookCatalog {
  version: number;
  moves: PlaybookMoveSpec[];
}

export interface LoadOptions {
  path?: string;
  strict?: boolean;
}

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  move_id?: string;
}

const PHASES: ReadonlySet<PlaybookPhase> = new Set<PlaybookPhase>([
  "ice_breaker",
  "challenge_explain",
  "challenge_execute",
  "follow_up",
]);

export function validatePlaybookCatalog(
  cat: PlaybookCatalog,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  if (!Array.isArray(cat.moves) || cat.moves.length === 0) {
    issues.push({
      level: "error",
      code: "moves_empty",
      message: "catálogo precisa de ao menos 1 move",
    });
    return issues;
  }
  for (const move of cat.moves) {
    if (typeof move.id !== "string" || move.id.length === 0) {
      issues.push({
        level: "error",
        code: "move_id_invalid",
        message: "move sem id válido",
      });
      continue;
    }
    if (seenIds.has(move.id)) {
      issues.push({
        level: "error",
        code: "move_id_duplicate",
        message: `move id '${move.id}' duplicado`,
        move_id: move.id,
      });
    }
    seenIds.add(move.id);
    if (!PHASES.has(move.phase)) {
      issues.push({
        level: "error",
        code: "move_phase_invalid",
        message: `move '${move.id}' phase '${move.phase}' inválida`,
        move_id: move.id,
      });
    }
    if (typeof move.estimated_minutes !== "number" || move.estimated_minutes <= 0) {
      issues.push({
        level: "error",
        code: "move_estimated_minutes_invalid",
        message: `move '${move.id}' estimated_minutes deve ser >0`,
        move_id: move.id,
      });
    }
    if (typeof move.framing_template !== "string" || move.framing_template.length === 0) {
      issues.push({
        level: "error",
        code: "move_framing_template_empty",
        message: `move '${move.id}' framing_template vazio`,
        move_id: move.id,
      });
    }
    if (typeof move.success_signal !== "string" || move.success_signal.length === 0) {
      issues.push({
        level: "error",
        code: "move_success_signal_empty",
        message: `move '${move.id}' success_signal vazio`,
        move_id: move.id,
      });
    }
  }
  // Cobertura: ≥1 move por phase
  const phasesCovered = new Set(cat.moves.map((m) => m.phase));
  for (const ph of PHASES) {
    if (!phasesCovered.has(ph)) {
      issues.push({
        level: "warning",
        code: "phase_uncovered",
        message: `phase '${ph}' sem nenhum move — Strategist pode não ter opção`,
      });
    }
  }
  return issues;
}

export interface LoadPlaybookResult {
  catalog: PlaybookCatalog;
  issues: ValidationIssue[];
}

export function loadPlaybookMoves(opts: LoadOptions = {}): LoadPlaybookResult {
  const path = opts.path ?? DEFAULT_PLAYBOOK_PATH;
  const strict = opts.strict ?? true;
  const raw = readFileSync(path, "utf-8");
  const parsed = yaml.load(raw);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(`playbook-moves: YAML root inválido em ${path}`);
  }
  const catalog = parsed as PlaybookCatalog;
  if (!Array.isArray(catalog.moves)) {
    throw new Error(`playbook-moves: campo 'moves' obrigatório (array) em ${path}`);
  }
  const issues = validatePlaybookCatalog(catalog);
  if (strict) {
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length > 0) {
      const summary = errors.map((i) => `  [${i.code}] ${i.message}`).join("\n");
      throw new Error(`playbook-moves: ${errors.length} erro(s):\n${summary}`);
    }
  }
  return { catalog, issues };
}

let cachedCatalog: PlaybookCatalog | undefined;

export function getPlaybookCatalog(): PlaybookCatalog {
  if (cachedCatalog === undefined) {
    cachedCatalog = loadPlaybookMoves().catalog;
  }
  return cachedCatalog;
}

export function resetPlaybookCache(): void {
  cachedCatalog = undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// API de consulta
// ─────────────────────────────────────────────────────────────────────────

export function getMoveById(id: string): PlaybookMoveSpec | undefined {
  return getPlaybookCatalog().moves.find((m) => m.id === id);
}

export function getMovesByPhase(phase: PlaybookPhase): PlaybookMoveSpec[] {
  return getPlaybookCatalog().moves.filter((m) => m.phase === phase);
}

export function getMovesByTargetFramework(framework: string): PlaybookMoveSpec[] {
  return getPlaybookCatalog().moves.filter((m) =>
    (m.targets ?? []).some((t) => t.framework === framework),
  );
}
