<script lang="ts">
  import type {
    ApiClient,
    SubjectKnowledgeEntryLike,
    BoundarySummary,
  } from "../lib/api.js";
  import { discoveriesPanelOpen, tracerSubjectId } from "../lib/stores.js";

  export let api: ApiClient;

  let discoveries: SubjectKnowledgeEntryLike[] = [];
  let boundariesSummary: BoundarySummary[] = [];
  let typeFilter = "";
  let loading = false;
  let err: string | null = null;

  async function load(): Promise<void> {
    loading = true;
    err = null;
    try {
      const [d, s] = await Promise.all([
        api.listSubjectDiscoveries($tracerSubjectId, {
          ...(typeFilter ? { type: typeFilter } : {}),
          limit: 100,
        }),
        api.getBoundariesSummary($tracerSubjectId),
      ]);
      discoveries = d.discoveries;
      boundariesSummary = s.summary;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    loading = false;
  }

  $: if ($discoveriesPanelOpen) void load();
  $: typeFilter, $discoveriesPanelOpen && void load();

  function shortLabel(e: SubjectKnowledgeEntryLike): string {
    const p = e.payload;
    if (typeof p["label"] === "string") return p["label"];
    if (typeof p["concept_id"] === "string") return p["concept_id"];
    if (typeof p["signal_type"] === "string") return p["signal_type"];
    return e.type;
  }

  function badgeColor(type: string): string {
    if (type === "interest") return "#1976d2";
    if (type === "value") return "#388e3c";
    if (type === "need") return "#f57c00";
    if (type === "discovery") return "#7b1fa2";
    if (type === "boundary_event") return "#b00020";
    if (type === "presented_concept") return "#00897b";
    if (type === "recall_check_attempt") return "#ef6c00";
    return "#666";
  }
</script>

{#if $discoveriesPanelOpen}
  <div class="modal-backdrop" on:click={() => discoveriesPanelOpen.set(false)} on:keydown={(e) => e.key === "Escape" && discoveriesPanelOpen.set(false)} role="presentation">
    <div class="modal" on:click|stopPropagation role="dialog" aria-label="Descobertas">
      <header>
        <h2>🔍 Descobertas — {$tracerSubjectId}</h2>
        <button on:click={() => discoveriesPanelOpen.set(false)} aria-label="Fechar">×</button>
      </header>

      <div class="filters">
        <label for="disc-subject">subject_id:</label>
        <input id="disc-subject" type="text" bind:value={$tracerSubjectId} on:blur={load} />
        <label for="disc-type">type:</label>
        <select id="disc-type" bind:value={typeFilter}>
          <option value="">(todos)</option>
          <option value="interest">interest</option>
          <option value="value">value</option>
          <option value="need">need</option>
          <option value="discovery">discovery</option>
        </select>
        <button on:click={load} disabled={loading}>{loading ? "..." : "Reload"}</button>
      </div>

      {#if err}<p class="err">{err}</p>{/if}

      {#if boundariesSummary.length > 0}
        <section class="boundaries">
          <h3>⚠️ Boundaries (agregados por topic_category)</h3>
          <ul>
            {#each boundariesSummary as b}
              <li>
                <span class="topic">{b.topic_category}</span>
                <span class="counts">
                  {b.count}× <span class:high={b.high_intensity_count > 0}>(high {b.high_intensity_count})</span>
                </span>
                <span class="when">last: {new Date(b.last_seen_at).toLocaleString()}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <section class="timeline">
        <h3>Descobertas timeline ({discoveries.length})</h3>
        {#if discoveries.length === 0}
          <p class="empty">Nenhuma descoberta pra este sujeito ainda.</p>
        {:else}
          <ul>
            {#each discoveries as d}
              <li>
                <span class="badge" style="background: {badgeColor(d.type)}">{d.type}</span>
                <span class="label">{shortLabel(d)}</span>
                <span class="conf">conf={d.confidence.toFixed(2)}</span>
                <span class="when">{new Date(d.created_at).toLocaleString()}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100; display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; padding: 1.5rem; border-radius: 8px; width: min(800px, 90vw); max-height: 90vh; overflow-y: auto; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  header h2 { margin: 0; font-size: 1.1rem; }
  header button { background: transparent; border: none; font-size: 1.5rem; cursor: pointer; }
  .filters { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 1rem; }
  .filters input, .filters select { padding: 0.3rem; }
  .err { color: #b00020; }
  .boundaries { background: #fff3e0; padding: 0.75rem; border-radius: 4px; border-left: 3px solid #f57c00; margin-bottom: 1rem; }
  .boundaries h3 { margin: 0 0 0.5rem 0; font-size: 0.95rem; }
  .boundaries ul { list-style: none; padding: 0; }
  .boundaries li { display: grid; grid-template-columns: 1fr auto auto; gap: 0.5rem; padding: 0.3rem 0; align-items: center; }
  .topic { font-weight: 600; }
  .counts .high { color: #b00020; font-weight: 600; }
  .when { color: #999; font-size: 0.8rem; }
  .timeline h3 { font-size: 0.95rem; margin-bottom: 0.5rem; }
  .timeline ul { list-style: none; padding: 0; }
  .timeline li { display: grid; grid-template-columns: auto 1fr auto auto; gap: 0.5rem; padding: 0.4rem; border-bottom: 1px solid #f0f0f0; align-items: center; }
  .badge { color: white; padding: 0.15rem 0.5rem; border-radius: 3px; font-size: 0.75rem; font-weight: 600; }
  .label { font-family: monospace; color: #333; word-break: break-word; }
  .conf { color: #888; font-size: 0.8rem; }
  .empty { color: #999; font-style: italic; padding: 1rem; background: #f7f7f7; border-radius: 4px; }
</style>
