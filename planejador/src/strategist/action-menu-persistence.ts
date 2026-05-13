/**
 * ActionMenu persistence helpers (S-T-09-05).
 *
 * Convenção de filename: `{persona_id}-menu.json`, sibling do profile JSON
 * sob `fixtures/profiles/`. Validação Zod corre tanto no save (rejeita
 * antes de gravar) quanto no load (rejeita JSON malformado / fora do
 * schema).
 *
 * Operações `null` em vez de throw quando o arquivo não existe — caller
 * decide se isso é triggers C-T-09-03/04 (gerar pela primeira vez) ou
 * fallback C-T-10 (pool scoring antigo).
 *
 * Refs: ops#989 (capability C-T-09), ops#991 (Sprint 1 tracker).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseActionMenu,
  type ActionMenu,
} from "@ascendimacy/shared";

/** Nome canônico do arquivo de menu pra um persona_id. */
export function actionMenuFilename(personaId: string): string {
  return `${personaId}-menu.json`;
}

/** Path completo, sibling do profile JSON sob `baseDir`. */
export function actionMenuPath(personaId: string, baseDir: string): string {
  return path.join(baseDir, actionMenuFilename(personaId));
}

/**
 * Persiste menu validado. Cria `baseDir` se ausente. Retorna o path
 * absoluto/relativo gravado.
 *
 * Throws se `menu` não passa no schema — falha loud antes de escrever.
 */
export async function saveActionMenu(
  menu: ActionMenu,
  baseDir: string,
): Promise<string> {
  const validated = parseActionMenu(menu);
  const target = actionMenuPath(validated.persona_id, baseDir);
  await mkdir(baseDir, { recursive: true });
  await writeFile(target, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
  return target;
}

/**
 * Carrega menu validado. Retorna `null` quando o arquivo não existe
 * (ENOENT) — sinaliza "menu não gerado ainda". Throws em JSON inválido
 * ou schema mismatch.
 */
export async function loadActionMenu(
  personaId: string,
  baseDir: string,
): Promise<ActionMenu | null> {
  const target = actionMenuPath(personaId, baseDir);
  let raw: string;
  try {
    raw = await readFile(target, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return parseActionMenu(JSON.parse(raw));
}
