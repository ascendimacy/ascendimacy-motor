<script lang="ts">
  import { onMount } from "svelte";
  import {
    analyticsOpen,
    replaySessionId,
    globalError,
  } from "../lib/stores.js";
  import type {
    ApiClient,
    PersonaEvolution,
    PersonaSummary,
  } from "../lib/api.js";

  export let api: ApiClient;

  let personas: PersonaSummary[] = [];
  let loadingList = false;
  let selectedPersona: string | null = null;
  let evolution: PersonaEvolution | null = null;
  let loadingEvolution = false;
  let kindFilter: "" | "real" | "sts" = "";
  let fromDate = "";
  let toDate = "";
  let hasOverridesOnly = false;

  $: open = $analyticsOpen;

  async function loadPersonas(): Promise<void> {
    loadingList = true;
    try {
      const res = await api.listAnalyticsPersonas();
      personas = res.personas;
    } catch (err) {
      globalError.set(
        `Analytics falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      personas = [];
    } finally {
      loadingList = false;
    }
  }

  async function loadEvolution(personaId: string): Promise<void> {
    loadingEvolution = true;
    selectedPersona = personaId;
    try {
      evolution = await api.getPersonaEvolution(personaId);
    } catch (err) {
      globalError.set(
        `Evolution falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      evolution = null;
    } finally {
      loadingEvolution = false;
    }
  }

  function backToList(): void {
    selectedPersona = null;
    evolution = null;
    kindFilter = "";
    fromDate = "";
    toDate = "";
    hasOverridesOnly = false;
  }

  $: if (open) {
    void loadPersonas();
  }

  onMount(() => {
    if (open) void loadPersonas();
  });

  function openReplay(sessionId: string): void {
    replaySessionId.set(sessionId);
    analyticsOpen.set(false);
  }

  function formatDate(iso: string | null): string {
    if (iso === null) return "—";
    try {
      return new Date(iso).toLocaleDateString();
    } catch {
      return iso.slice(0, 10);
    }
  }

  function formatRate(rate: number): string {
    return `${(rate * 100).toFixed(1)}%`;
  }

  /** Filtra sessions do drill-down (S-OC-35 filtros). */
  $: filteredSessions =
    evolution === null
      ? []
      : evolution.sessions.filter((s) => {
          if (kindFilter !== "" && s.kind !== kindFilter) return false;
          if (hasOverridesOnly && !s.hasOverrides) return false;
          if (fromDate !== "" && s.startedAt < fromDate) return false;
          if (toDate !== "" && s.startedAt > `${toDate}T23:59:59.999Z`)
            return false;
          return true;
        });

  /** Max turn count pra barra normalizada (visual). */
  $: maxTurns =
    filteredSessions.length === 0
      ? 1
      : Math.max(...filteredSessions.map((s) => s.turnCount), 1);
</script>

{#if open}
  <aside class="analytics" data-testid="analytics-panel">
    <header>
      <h2>
        Analytics
        <span class="version-badge">V0.1</span>
      </h2>
      {#if selectedPersona !== null}
        <button
          type="button"
          class="back"
          on:click={backToList}
          data-testid="analytics-back"
        >
          ← Personas
        </button>
      {/if}
      <button
        type="button"
        class="close"
        on:click={() => analyticsOpen.set(false)}
        aria-label="Fechar analytics"
        data-testid="analytics-close"
      >
        ×
      </button>
    </header>

    {#if selectedPersona === null}
      <!-- S-OC-34 — Cross-session feed (persona cards) -->
      <section class="personas-list" data-testid="personas-list">
        {#if loadingList}
          <p class="muted" data-testid="analytics-loading">Carregando…</p>
        {:else if personas.length === 0}
          <p class="muted" data-testid="analytics-empty">
            Nenhuma sessão indexada ainda. Rode um STS smoke ou inicie
            uma sessão real pra popular o histórico.
          </p>
        {:else}
          <div class="cards-grid">
            {#each personas as p (p.personaId)}
              <button
                type="button"
                class="persona-card"
                on:click={() => loadEvolution(p.personaId)}
                data-testid="persona-card"
              >
                <h3>{p.personaId}</h3>
                <dl>
                  <div class="stat">
                    <dt>sessões</dt>
                    <dd>{p.sessionCount}</dd>
                  </div>
                  <div class="stat">
                    <dt>turns</dt>
                    <dd>{p.totalTurns}</dd>
                  </div>
                  <div class="stat">
                    <dt>real / sts</dt>
                    <dd>{p.realCount} / {p.stsCount}</dd>
                  </div>
                  <div class="stat">
                    <dt>override rate</dt>
                    <dd
                      class:warn={p.overrideRate > 0.2}
                      data-testid="override-rate"
                    >
                      {formatRate(p.overrideRate)}
                    </dd>
                  </div>
                </dl>
                <p class="last-session">
                  últ. sessão: <code>{formatDate(p.lastSessionAt)}</code>
                </p>
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {:else}
      <!-- S-OC-35/36 — Drill-down + evolução -->
      <section class="evolution" data-testid="evolution-view">
        {#if loadingEvolution}
          <p class="muted">Carregando evolução…</p>
        {:else if evolution !== null}
          <div class="summary-strip" data-testid="evolution-summary">
            <h3>{evolution.summary.personaId}</h3>
            <dl class="inline-stats">
              <div><dt>sessões</dt><dd>{evolution.summary.sessionCount}</dd></div>
              <div><dt>turns</dt><dd>{evolution.summary.totalTurns}</dd></div>
              <div>
                <dt>overrides</dt>
                <dd>{evolution.summary.totalOverrides}</dd>
              </div>
              <div>
                <dt>rate</dt>
                <dd>{formatRate(evolution.summary.overrideRate)}</dd>
              </div>
              <div>
                <dt>desde</dt>
                <dd><code>{formatDate(evolution.summary.firstSessionAt)}</code></dd>
              </div>
            </dl>
          </div>

          <div class="filters" data-testid="evolution-filters">
            <label class="filter">
              <span>kind</span>
              <select bind:value={kindFilter} data-testid="filter-kind">
                <option value="">all</option>
                <option value="real">real</option>
                <option value="sts">sts</option>
              </select>
            </label>
            <label class="filter">
              <span>de</span>
              <input
                type="date"
                bind:value={fromDate}
                data-testid="filter-from"
              />
            </label>
            <label class="filter">
              <span>até</span>
              <input
                type="date"
                bind:value={toDate}
                data-testid="filter-to"
              />
            </label>
            <label class="filter inline">
              <input
                type="checkbox"
                bind:checked={hasOverridesOnly}
                data-testid="filter-overrides"
              />
              <span>só com overrides</span>
            </label>
          </div>

          <div class="timeline" data-testid="evolution-timeline">
            {#if filteredSessions.length === 0}
              <p class="muted">Nenhuma sessão com esses filtros.</p>
            {:else}
              {#each filteredSessions as s (s.sessionId)}
                <div
                  class="session-row"
                  class:has-overrides={s.hasOverrides}
                  data-testid="session-row"
                >
                  <span class="kind-badge kind-{s.kind}">{s.kind}</span>
                  <span class="date">{formatDate(s.startedAt)}</span>
                  <div class="turns-bar" title="{s.turnCount} turns">
                    <div
                      class="bar-fill"
                      style="width: {Math.round((s.turnCount / maxTurns) * 100)}%"
                    />
                  </div>
                  <span class="turns-count">{s.turnCount} turns</span>
                  {#if s.hasOverrides}
                    <span class="override-pill" title="overrides count">
                      ✎ {s.overrideCount}
                    </span>
                  {/if}
                  <button
                    type="button"
                    class="replay-btn"
                    on:click={() => openReplay(s.sessionId)}
                    data-testid="open-replay"
                  >
                    Replay
                  </button>
                </div>
              {/each}
            {/if}
          </div>

          <p class="hint">
            <small>
              Métricas profundas (Helix state, mood timeline, Dreyfus
              level, cards trabalhadas) ficam pra V0.2 — requerem parse
              do trace.json.
            </small>
          </p>
        {/if}
      </section>
    {/if}
  </aside>
{/if}

<style>
  .analytics {
    position: fixed;
    top: 0;
    right: 0;
    width: 60vw;
    max-width: 900px;
    height: 100vh;
    background: var(--bg, #ffffff);
    border-left: 2px solid rgba(76, 175, 80, 0.4);
    box-shadow: -4px 0 12px rgba(0, 0, 0, 0.15);
    display: flex;
    flex-direction: column;
    z-index: 35;
  }

  @media (prefers-color-scheme: dark) {
    .analytics {
      background: #1c1c1c;
    }
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.3);
    background: rgba(76, 175, 80, 0.05);
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.85;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .version-badge {
    background: rgba(76, 175, 80, 0.25);
    color: #2e7d32;
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-weight: 600;
  }

  button {
    background: rgba(127, 127, 127, 0.15);
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 3px;
    padding: 0.2rem 0.6rem;
    color: inherit;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }

  button.close {
    background: transparent;
    border: none;
    font-size: 1.3rem;
    padding: 0.2rem 0.5rem;
  }

  button:hover {
    background: rgba(127, 127, 127, 0.25);
  }

  .personas-list {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
  }

  .cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.8rem;
  }

  .persona-card {
    background: rgba(127, 127, 127, 0.08);
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: 6px;
    padding: 0.8rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
  }

  .persona-card:hover {
    background: rgba(76, 175, 80, 0.12);
    border-color: rgba(76, 175, 80, 0.4);
  }

  .persona-card h3 {
    margin: 0 0 0.5rem;
    font-size: 0.95rem;
    text-transform: capitalize;
  }

  .persona-card dl {
    margin: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.3rem 0.6rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
  }

  .stat dt {
    font-size: 0.7rem;
    opacity: 0.6;
    text-transform: uppercase;
  }

  .stat dd {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .stat dd.warn {
    color: #ff9800;
  }

  .last-session {
    margin: 0.6rem 0 0;
    font-size: 0.75rem;
    opacity: 0.7;
  }

  .evolution {
    flex: 1;
    overflow-y: auto;
    padding: 0.8rem 1rem 1rem;
  }

  .summary-strip {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 0.8rem;
    flex-wrap: wrap;
  }

  .summary-strip h3 {
    margin: 0;
    font-size: 1.1rem;
    text-transform: capitalize;
  }

  .inline-stats {
    margin: 0;
    display: flex;
    gap: 1.2rem;
    flex-wrap: wrap;
  }

  .inline-stats > div {
    display: flex;
    flex-direction: column;
  }

  .inline-stats dt {
    font-size: 0.65rem;
    opacity: 0.6;
    text-transform: uppercase;
  }

  .inline-stats dd {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .filters {
    display: flex;
    gap: 0.7rem;
    flex-wrap: wrap;
    margin-bottom: 0.7rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px dashed rgba(127, 127, 127, 0.25);
  }

  .filter {
    display: flex;
    flex-direction: column;
    font-size: 0.75rem;
    opacity: 0.85;
  }

  .filter.inline {
    flex-direction: row;
    align-items: center;
    gap: 0.3rem;
  }

  .filter input,
  .filter select {
    background: rgba(127, 127, 127, 0.1);
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 3px;
    padding: 0.2rem 0.4rem;
    font-family: inherit;
    color: inherit;
    font-size: 0.85rem;
  }

  .timeline {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .session-row {
    display: grid;
    grid-template-columns: 50px 90px 1fr 70px 60px 70px;
    gap: 0.5rem;
    align-items: center;
    padding: 0.3rem 0.5rem;
    background: rgba(127, 127, 127, 0.05);
    border-radius: 4px;
    font-size: 0.85rem;
  }

  .session-row.has-overrides {
    background: rgba(255, 152, 0, 0.08);
    border-left: 3px solid #ff9800;
  }

  .kind-badge {
    text-transform: uppercase;
    font-size: 0.65rem;
    font-weight: 700;
    text-align: center;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }

  .kind-real {
    background: rgba(76, 175, 80, 0.2);
    color: #2e7d32;
  }

  .kind-sts {
    background: rgba(33, 150, 243, 0.2);
    color: #1565c0;
  }

  .date {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.75rem;
    opacity: 0.75;
  }

  .turns-bar {
    height: 14px;
    background: rgba(127, 127, 127, 0.15);
    border-radius: 7px;
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #4caf50, #8bc34a);
  }

  .turns-count {
    font-size: 0.75rem;
    opacity: 0.85;
    text-align: right;
  }

  .override-pill {
    background: rgba(255, 152, 0, 0.25);
    color: #e65100;
    font-size: 0.7rem;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
    font-weight: 600;
    text-align: center;
  }

  .replay-btn {
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
  }

  .muted {
    opacity: 0.6;
    text-align: center;
    padding: 2rem 1rem;
  }

  .hint {
    margin-top: 1rem;
    opacity: 0.6;
    border-top: 1px dashed rgba(127, 127, 127, 0.25);
    padding-top: 0.7rem;
    text-align: center;
  }

  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.75rem;
    background: rgba(127, 127, 127, 0.15);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
