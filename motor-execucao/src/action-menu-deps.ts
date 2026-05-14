/**
 * Production deps factory pra OnboardingTriggerDeps (S-T-09-03 wiring).
 *
 * motor#104 entregou `onboarding-trigger.ts` com deps injetadas pra
 * testabilidade. Esta factory cria os deps reais em runtime via
 * **dynamic import** de motor-drota/dist e planejador/dist — evita
 * cross-workspace coupling no package.json (motor-execucao não depende
 * formalmente em motor-drota nem planejador).
 *
 * Trade-off:
 * - Pro: architectural boundary preservada; mock-friendly pra tests
 * - Con: prod isolado (motor-execucao standalone) quebra — depende de
 *   sibling workspaces serem buildados. Aceitável enquanto monorepo é
 *   o único deploy target.
 *
 * Cached singleton — primeira chamada faz imports, subsequentes reusam.
 *
 * Ref: ops#994 (S-T-09-03), motor#104 (trigger infra).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { OnboardingTriggerDeps } from "./onboarding-trigger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve REPO_ROOT a partir do dist path de motor-execucao. */
function resolveRepoRoot(): string {
  // dist está em motor-execucao/dist, então sobe 2 niveis pra repo root.
  return path.resolve(__dirname, "..", "..");
}

let _cachedDeps: OnboardingTriggerDeps | null = null;

/**
 * Lazy factory — primeira chamada faz dynamic imports + monta deps.
 * Subsequentes reusam singleton.
 *
 * Aceita `repoRoot` override pra testes ou deploy custom. Default:
 * resolvido relativo ao dist path deste módulo.
 */
export async function createProdActionMenuDeps(
  repoRootOverride?: string,
): Promise<OnboardingTriggerDeps> {
  if (_cachedDeps) return _cachedDeps;

  const repoRoot = repoRootOverride ?? resolveRepoRoot();

  // Dynamic imports — paths absolutos pros builds de sibling workspaces.
  const motorDrotaDist = path.join(repoRoot, "motor-drota", "dist");
  const planejadorDist = path.join(repoRoot, "planejador", "dist");

  type GenerateActionMenuFn = OnboardingTriggerDeps["generateMenu"];
  type ResolveHintFn = OnboardingTriggerDeps["resolveHint"];
  type SaveMenuFn = OnboardingTriggerDeps["saveMenu"];

  const menuGen = (await import(
    path.join(motorDrotaDist, "menu-generator.js")
  )) as { generateActionMenu: GenerateActionMenuFn };

  const personaHints = (await import(
    path.join(motorDrotaDist, "persona-hints.js")
  )) as { resolvePersonaHint: ResolveHintFn };

  const persistence = (await import(
    path.join(planejadorDist, "strategist", "action-menu-persistence.js")
  )) as { saveActionMenu: SaveMenuFn };

  _cachedDeps = {
    generateMenu: menuGen.generateActionMenu,
    loadProfile: (personaId: string) => {
      // Tenta variants do fixture naming convention.
      const candidates = [
        `${personaId}.pre-phase2.json`,
        `${personaId}.json`,
      ];
      for (const name of candidates) {
        const p = path.join(repoRoot, "fixtures", "profiles", name);
        try {
          return JSON.parse(readFileSync(p, "utf-8"));
        } catch {
          // try next candidate
        }
      }
      return null;
    },
    saveMenu: persistence.saveActionMenu,
    resolveHint: personaHints.resolvePersonaHint,
    baseDir: path.join(repoRoot, "fixtures", "profiles"),
    onLog: (event) => {
      // Stderr pra dev visibility; debug-logger NDJSON fica pra próximo
      // iteração quando trigger ganhar telemetria estruturada (H-AC-08).
      // eslint-disable-next-line no-console
      console.error(
        `[onboarding-trigger] ${event.code}: ${event.message}` +
          (event.details ? ` (${JSON.stringify(event.details)})` : ""),
      );
    },
  };
  return _cachedDeps;
}

/** Reset cache — uso só em tests. */
export function _resetActionMenuDepsCache(): void {
  _cachedDeps = null;
}
