/**
 * Carregador de pacotes pedagógicos — S-MX-06-06 (ops#1115).
 *
 * Lê `<baseDir>/<cardId>.md`, retorna o envelope `CardPackage` com markdown
 * cru. Parse estruturado fica pra quando o template (E3 da sessão) aterrissar.
 *
 * PR3: apenas filesystem + cache em memória. Hot reload via fs.watch fica
 * de fora (P2 simplicidade) — `invalidate()` é a porta pra dev tooling
 * disparar reload manual. PR4+ pode adicionar watcher se necessário.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CardId, CardPackage } from "./types.js";

/** Mesmo formato aceito pelo detector do router. Bloqueia path traversal
 *  e qualquer cardId fora do alfabeto canônico antes de tocar o fs. */
const VALID_CARD_ID = /^[a-z0-9-]+$/;

export interface CardPackageLoaderOptions {
  /** Diretório raiz dos pacotes. Caller decide (legacy `docs/ebrota/...`
   *  por default D5 da ops#1115). */
  baseDir: string;
}

export interface CardPackageLoader {
  /** Retorna o pacote do cache se já carregado; senão lê do disco. Retorna
   *  `null` para `cardId` em formato inválido ou arquivo inexistente.
   *  Erros de IO não-ENOENT propagam. */
  load(cardId: string): Promise<CardPackage | null>;

  /** Sem argumento limpa o cache inteiro; com cardId remove só essa entrada. */
  invalidate(cardId?: string): void;
}

export function createCardPackageLoader(
  opts: CardPackageLoaderOptions,
): CardPackageLoader {
  const cache = new Map<CardId, CardPackage>();

  return {
    async load(cardId: string): Promise<CardPackage | null> {
      if (!VALID_CARD_ID.test(cardId)) return null;

      const cached = cache.get(cardId);
      if (cached) return cached;

      const sourcePath = join(opts.baseDir, `${cardId}.md`);
      let raw: string;
      try {
        raw = await readFile(sourcePath, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }

      const pkg: CardPackage = { cardId, raw, sourcePath };
      cache.set(cardId, pkg);
      return pkg;
    },

    invalidate(cardId?: string): void {
      if (cardId === undefined) cache.clear();
      else cache.delete(cardId);
    },
  };
}
