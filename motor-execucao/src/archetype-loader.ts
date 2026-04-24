/**
 * Carrega arquétipos do content/cards/archetypes-seed.json.
 * v1 usa scaffolds — emitCard bloqueia em env != 'test' via guard.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CardArchetype } from "@ascendimacy/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(__dirname, "../../content/cards/archetypes-seed.json");

let _cache: CardArchetype[] | null = null;

export function loadArchetypes(path?: string): CardArchetype[] {
  if (_cache && !path) return _cache;
  const target = path ?? DEFAULT_PATH;
  const raw = readFileSync(target, "utf-8");
  const parsed = JSON.parse(raw) as CardArchetype[];
  if (!path) _cache = parsed;
  return parsed;
}

export function getArchetype(id: string, path?: string): CardArchetype | undefined {
  return loadArchetypes(path).find((a) => a.id === id);
}

/** Clear cache (test helper). */
export function clearArchetypeCache(): void {
  _cache = null;
}
