<script lang="ts">
  import type { ApiClient, FrameworkMeta, SubjectMapLike } from "../lib/api.js";
  import { mapsPanelOpen, tracerSubjectId } from "../lib/stores.js";

  export let api: ApiClient;

  let frameworks: FrameworkMeta[] = [];
  let activeFramework = "valores_classicos";
  let maps: SubjectMapLike | null = null;
  let loading = false;
  let err: string | null = null;

  async function loadFrameworks(): Promise<void> {
    try {
      const r = await api.listFrameworks();
      frameworks = r.frameworks;
      if (frameworks.length > 0 && !frameworks.find((f) => f.id === activeFramework)) {
        activeFramework = frameworks[0].id;
      }
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
  }

  async function loadMaps(): Promise<void> {
    loading = true;
    err = null;
    try {
      const r = await api.getSubjectMaps($tracerSubjectId);
      maps = r.maps;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      maps = null;
    }
    loading = false;
  }

  $: if ($mapsPanelOpen) {
    void loadFrameworks();
    void loadMaps();
  }

  function fmtVal(v: unknown): string {
    if (typeof v === "number") return v.toFixed(0);
    if (typeof v === "object" && v !== null) return JSON.stringify(v);
    return String(v);
  }

  function nonZeroEntries(positions: Record<string, unknown> | undefined): Array<[string, unknown]> {
    if (!positions) return [];
    return Object.entries(positions).filter(([, v]) => {
      if (typeof v === "number") return v > 0;
      if (typeof v === "object" && v !== null) return true;
      return Boolean(v);
    });
  }
</script>

{#if $mapsPanelOpen}
  <div class="modal-backdrop" on:click={() => mapsPanelOpen.set(false)} on:keydown={(e) => e.key === "Escape" && mapsPanelOpen.set(false)} role="presentation">
    <div class="modal" on:click|stopPropagation role="dialog" aria-label="Mapas multi-framework">
      <header>
        <h2>🗺️ Mapas — {$tracerSubjectId}</h2>
        <button on:click={() => mapsPanelOpen.set(false)} aria-label="Fechar">×</button>
      </header>

      <div class="subject-picker">
        <label for="maps-subject">subject_id:</label>
        <input id="maps-subject" type="text" bind:value={$tracerSubjectId} on:blur={loadMaps} />
        <button on:click={loadMaps} disabled={loading}>{loading ? "..." : "Reload"}</button>
      </div>

      {#if err}<p class="err">{err}</p>{/if}

      <div class="tabs">
        {#each frameworks as fw}
          <button
            class="tab"
            class:active={activeFramework === fw.id}
            on:click={() => (activeFramework = fw.id)}
          >
            {fw.display_name}
          </button>
        {/each}
      </div>

      {#if maps && frameworks.find((f) => f.id === activeFramework)}
        {@const fw = frameworks.find((f) => f.id === activeFramework)}
        <div class="framework-view">
          <p class="meta">render hint: <code>{fw?.render_hint}</code> · {fw?.dimensions.length} dimensões</p>
          {#if nonZeroEntries(maps.positions[activeFramework]).length === 0}
            <p class="empty">Nenhuma posição com valor > 0 nesta lente. Sujeito ainda sem entries suficientes.</p>
          {:else}
            <ul class="dims">
              {#each nonZeroEntries(maps.positions[activeFramework]) as [dim, val]}
                <li>
                  <span class="dim-name">{dim}</span>
                  <span class="dim-val">{fmtVal(val)}</span>
                </li>
              {/each}
            </ul>
          {/if}
          <details class="raw">
            <summary>JSON cru</summary>
            <pre>{JSON.stringify(maps.positions[activeFramework], null, 2)}</pre>
          </details>
        </div>
      {/if}

      <p class="muted">computed_at: {maps?.computed_at ? new Date(maps.computed_at).toLocaleString() : "—"}</p>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100; display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; padding: 1.5rem; border-radius: 8px; width: min(720px, 90vw); max-height: 90vh; overflow-y: auto; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  header h2 { margin: 0; font-size: 1.1rem; }
  header button { background: transparent; border: none; font-size: 1.5rem; cursor: pointer; }
  .subject-picker { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; }
  .subject-picker input { flex: 1; padding: 0.3rem; }
  .err { color: #b00020; }
  .tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid #ddd; margin-bottom: 1rem; flex-wrap: wrap; }
  .tab { padding: 0.5rem 1rem; background: transparent; border: none; cursor: pointer; border-bottom: 2px solid transparent; font-size: 0.9rem; }
  .tab.active { border-bottom-color: #1976d2; font-weight: 600; }
  .framework-view .meta { color: #888; font-size: 0.85rem; }
  .empty { color: #999; font-style: italic; padding: 1rem; background: #f7f7f7; border-radius: 4px; }
  .dims { list-style: none; padding: 0; }
  .dims li { display: flex; justify-content: space-between; padding: 0.4rem 0.6rem; border-bottom: 1px solid #f0f0f0; }
  .dim-name { font-family: monospace; color: #333; }
  .dim-val { font-weight: 600; color: #1976d2; }
  .raw { margin-top: 1rem; }
  .raw summary { cursor: pointer; }
  .raw pre { background: #f7f7f7; padding: 0.5rem; border-radius: 4px; font-size: 0.8rem; overflow-x: auto; }
  .muted { color: #999; font-size: 0.8rem; margin-top: 1rem; }
</style>
