/**
 * S1.read — contrato unificado de leitura do estado do aprendiz.
 *
 * Agrega 3 fontes (kids_casel_history, kids_tree_nodes, kids_helix_state)
 * e retorna LearnerSummary com cache in-memory TTL 60s.
 *
 * Spec: ascendimacy-ops#1150. Decisões:
 *  - D-P41-01: TTL = 60s
 *  - D-P41-02: cache em memória (in-process Map)
 */

import type { LearnerSummary } from "@ascendimacy/shared";

export const S1_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  data: LearnerSummary;
  cachedAt: number;
}

const _cache = new Map<string, CacheEntry>();

/**
 * Injectable data sources — permite testes sem DB real.
 * Produção: motor-execucao fornece implementação concreta.
 */
export interface S1DataSources {
  getCaselLevels(persona: string): Promise<Record<string, number>>;
  getTreeZones(persona: string): Promise<string[]>;
  getHelixPosition(persona: string): Promise<string | null>;
  getLastSession(persona: string): Promise<string | null>;
}

const defaultSources: S1DataSources = {
  getCaselLevels: async () => ({}),
  getTreeZones: async () => [],
  getHelixPosition: async () => null,
  getLastSession: async () => null,
};

export const S1 = {
  async read(
    { persona }: { persona: string },
    sources: S1DataSources = defaultSources,
  ): Promise<LearnerSummary> {
    const now = Date.now();
    const cached = _cache.get(persona);
    if (cached !== undefined && now - cached.cachedAt < S1_CACHE_TTL_MS) {
      return cached.data;
    }

    const [casel_levels, tree_zones, helix_position, last_session] =
      await Promise.all([
        sources.getCaselLevels(persona),
        sources.getTreeZones(persona),
        sources.getHelixPosition(persona),
        sources.getLastSession(persona),
      ]);

    const summary: LearnerSummary = {
      persona,
      casel_levels,
      tree_zones,
      helix_position,
      last_session,
      cached_at: now,
    };

    _cache.set(persona, { data: summary, cachedAt: now });
    return summary;
  },

  clearCache(persona?: string): void {
    if (persona !== undefined) {
      _cache.delete(persona);
    } else {
      _cache.clear();
    }
  },
};
