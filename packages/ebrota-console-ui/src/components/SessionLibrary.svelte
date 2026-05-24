<script lang="ts">
  import { onMount } from "svelte";
  import {
    libraryOpen,
    replaySessionId,
    globalError,
  } from "../lib/stores.js";
  import type {
    ApiClient,
    SessionLibraryEntry,
    SessionLibraryFilters,
  } from "../lib/api.js";

  export let api: ApiClient;

  let sessions: SessionLibraryEntry[] = [];
  let loading = false;
  let persona = "";
  let kind: "" | "real" | "sts" = "";
  let q = "";
  let hasOverrides = false;
  let lastFetch = Date.now();

  $: open = $libraryOpen;

  async function refresh(): Promise<void> {
    loading = true;
    const filters: SessionLibraryFilters = {};
    if (persona.length > 0) filters.persona = persona;
    if (kind === "real" || kind === "sts") filters.kind = kind;
    if (q.length > 0) filters.q = q;
    if (hasOverrides) filters.hasOverrides = true;
    filters.limit = 50;
    try {
      const res = await api.listSessionLibrary(filters);
      sessions = res.sessions;
      lastFetch = Date.now();
    } catch (err) {
      globalError.set(
        `Library falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      sessions = [];
    } finally {
      loading = false;
    }
  }

  $: if (open) {
    void refresh();
  }

  onMount(() => {
    if (open) void refresh();
  });

  function openReplay(sessionId: string): void {
    replaySessionId.set(sessionId);
  }

  function clearFilters(): void {
    persona = "";
    kind = "";
    q = "";
    hasOverrides = false;
    void refresh();
  }

  void lastFetch;
</script>

{#if open}
  <aside class="library" data-testid="session-library">
    <header>
      <h2>Histórico</h2>
      <button
        type="button"
        class="close"
        on:click={() => libraryOpen.set(false)}
        data-testid="library-close"
        aria-label="Fechar histórico"
      >
        ×
      </button>
    </header>

    <div class="filters">
      <label class="filter">
        <span>persona</span>
        <input
          type="text"
          bind:value={persona}
          placeholder="yuji, kei, ..."
          data-testid="filter-persona"
        />
      </label>
      <label class="filter">
        <span>kind</span>
        <select bind:value={kind} data-testid="filter-kind">
          <option value="">all</option>
          <option value="real">real</option>
          <option value="sts">sts</option>
        </select>
      </label>
      <label class="filter">
        <span>busca</span>
        <input
          type="text"
          bind:value={q}
          placeholder="full-text (FTS5)"
          data-testid="filter-q"
        />
      </label>
      <label class="filter inline">
        <input
          type="checkbox"
          bind:checked={hasOverrides}
          data-testid="filter-has-overrides"
        />
        <span>só com overrides</span>
      </label>
      <div class="filter-actions">
        <button
          type="button"
          on:click={refresh}
          disabled={loading}
          data-testid="filter-apply"
        >
          {loading ? "..." : "Aplicar"}
        </button>
        <button
          type="button"
          class="ghost"
          on:click={clearFilters}
          disabled={loading}
          data-testid="filter-clear"
        >
          Limpar
        </button>
      </div>
    </div>

    <div class="list" data-testid="library-list">
      {#if loading}
        <p class="muted">Carregando...</p>
      {:else if sessions.length === 0}
        <p class="muted">Nenhuma sessão.</p>
      {:else}
        {#each sessions as session (session.sessionId)}
          <button
            type="button"
            class="entry"
            class:has-overrides={session.hasOverrides}
            on:click={() => openReplay(session.sessionId)}
            data-testid="library-entry"
          >
            <div class="entry-row1">
              <span class="persona">{session.personaId}</span>
              <span class="kind kind-{session.kind}">{session.kind}</span>
              {#if session.hasOverrides}
                <span class="badge">overrides</span>
              {/if}
            </div>
            <div class="entry-row2">
              <code class="conv">{session.conversationId}</code>
              <span class="meta">{session.turnCount} turns</span>
            </div>
            <div class="entry-row3">
              <span class="time">{session.startedAt}</span>
            </div>
          </button>
        {/each}
      {/if}
    </div>
  </aside>
{/if}

<style>
  .library {
    position: fixed;
    top: 0;
    right: 0;
    width: min(420px, 100%);
    height: 100vh;
    background: var(--bg, #ffffff);
    border-left: 1px solid rgba(127, 127, 127, 0.3);
    display: flex;
    flex-direction: column;
    z-index: 30;
    box-shadow: -4px 0 12px rgba(0, 0, 0, 0.15);
  }

  @media (prefers-color-scheme: dark) {
    .library {
      background: #222;
    }
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.3);
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.8;
  }

  .close {
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 1.5rem;
    line-height: 1;
    padding: 0.2rem 0.5rem;
  }

  .close:hover {
    background: rgba(127, 127, 127, 0.15);
    border-radius: 4px;
  }

  .filters {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.2);
    background: rgba(127, 127, 127, 0.04);
  }

  .filter {
    display: flex;
    flex-direction: column;
  }

  .filter span {
    font-size: 0.7rem;
    opacity: 0.6;
    margin-bottom: 0.15rem;
  }

  .filter.inline {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
    grid-column: 1 / 3;
  }

  .filter.inline span {
    font-size: 0.85rem;
    opacity: 0.8;
    margin: 0;
  }

  input,
  select {
    padding: 0.3rem 0.4rem;
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 3px;
    background: rgba(127, 127, 127, 0.05);
    color: inherit;
    font-family: inherit;
    font-size: 0.85rem;
  }

  .filter-actions {
    grid-column: 1 / 3;
    display: flex;
    gap: 0.5rem;
    margin-top: 0.3rem;
  }

  button {
    padding: 0.3rem 0.8rem;
    border: 1px solid rgba(33, 150, 243, 0.5);
    background: rgba(33, 150, 243, 0.15);
    color: inherit;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.85rem;
  }

  button:hover:not(:disabled) {
    background: rgba(33, 150, 243, 0.3);
  }

  button.ghost {
    background: transparent;
    border-color: rgba(127, 127, 127, 0.3);
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .muted {
    opacity: 0.6;
    text-align: center;
    padding: 1rem;
  }

  .entry {
    text-align: left;
    background: rgba(127, 127, 127, 0.06);
    border: 1px solid rgba(127, 127, 127, 0.2);
    border-radius: 4px;
    padding: 0.5rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    color: inherit;
  }

  .entry:hover {
    background: rgba(33, 150, 243, 0.1);
    border-color: rgba(33, 150, 243, 0.5);
  }

  .entry.has-overrides {
    border-left: 3px solid rgba(255, 193, 7, 0.7);
  }

  .entry-row1 {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.9rem;
  }

  .persona {
    font-weight: 600;
  }

  .kind {
    font-size: 0.7rem;
    text-transform: uppercase;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    opacity: 0.7;
  }

  .kind.kind-real {
    background: rgba(76, 175, 80, 0.2);
    color: #2e7d32;
  }

  .kind.kind-sts {
    background: rgba(156, 39, 176, 0.2);
    color: #6a1b9a;
  }

  .badge {
    background: rgba(255, 193, 7, 0.3);
    color: #b8860b;
    font-size: 0.7rem;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    margin-left: auto;
  }

  .entry-row2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    opacity: 0.7;
  }

  .conv {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.75rem;
  }

  .meta {
    margin-left: auto;
  }

  .entry-row3 {
    font-size: 0.7rem;
    opacity: 0.5;
  }

  .time {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  }
</style>
