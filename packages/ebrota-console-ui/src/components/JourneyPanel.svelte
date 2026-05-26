<script lang="ts">
  import { onMount } from "svelte";
  import type { ApiClient, JourneyStateLike } from "../lib/api.js";
  import {
    journeyPanelOpen,
    tracerSubjectId,
  } from "../lib/stores.js";

  export let api: ApiClient;

  let state: JourneyStateLike | null = null;
  let loading = false;
  let err: string | null = null;
  let overrideStage: "discovery_only" | "mapping_ready" | "applied_double_helix" = "mapping_ready";
  let overrideReason = "";

  async function load(): Promise<void> {
    loading = true;
    err = null;
    try {
      const r = await api.getJourneyState($tracerSubjectId);
      state = r.state;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      state = null;
    }
    loading = false;
  }

  async function applyOverride(): Promise<void> {
    if (overrideReason.trim().length === 0) {
      err = "Reason obrigatório";
      return;
    }
    try {
      const r = await api.setJourneyOverride($tracerSubjectId, overrideStage, overrideReason);
      state = r.state;
      overrideReason = "";
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
  }

  async function clearOverride(): Promise<void> {
    try {
      const r = await api.clearJourneyOverride($tracerSubjectId);
      state = r.state;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
  }

  $: if ($journeyPanelOpen) void load();
</script>

{#if $journeyPanelOpen}
  <div class="modal-backdrop" on:click={() => journeyPanelOpen.set(false)} on:keydown={(e) => e.key === "Escape" && journeyPanelOpen.set(false)} role="presentation">
    <div class="modal" on:click|stopPropagation role="dialog" aria-label="Journey State">
      <header>
        <h2>🧭 Journey State — {$tracerSubjectId}</h2>
        <button on:click={() => journeyPanelOpen.set(false)} aria-label="Fechar">×</button>
      </header>

      <div class="subject-picker">
        <label for="journey-subject">subject_id:</label>
        <input id="journey-subject" type="text" bind:value={$tracerSubjectId} on:blur={load} />
        <button on:click={load} disabled={loading}>{loading ? "..." : "Reload"}</button>
      </div>

      {#if err}
        <p class="err">{err}</p>
      {/if}

      {#if state}
        <div class="state-card">
          <div class="row">
            <span class="lbl">Stage:</span>
            <span class="val stage-{state.stage}">{state.stage}</span>
          </div>
          <div class="row">
            <span class="lbl">Discoveries:</span>
            <span class="val">{state.discoveries_count} / 10 (threshold)</span>
          </div>
          <div class="bar">
            <div class="bar-fill" style="width: {Math.min(100, state.discoveries_count * 10)}%"></div>
          </div>
          <div class="row">
            <span class="lbl">Famílias cobertas:</span>
            <span class="val">{state.families_covered.length} / 3 — {state.families_covered.join(", ") || "(nenhuma)"}</span>
          </div>
          <div class="row">
            <span class="lbl">Stage entered:</span>
            <span class="val muted">{new Date(state.stage_entered_at).toLocaleString()}</span>
          </div>
          {#if state.override_by_parent}
            <div class="override">
              <strong>⚠️ Override parental ativo:</strong>
              <p>Forçado pra <code>{state.override_by_parent.forced_stage}</code></p>
              <p class="reason">"{state.override_by_parent.reason}"</p>
              <button on:click={clearOverride}>Limpar override</button>
            </div>
          {/if}
        </div>

        <details class="override-form">
          <summary>Aplicar override parental</summary>
          <div class="form">
            <label for="override-stage">Forçar stage:</label>
            <select id="override-stage" bind:value={overrideStage}>
              <option value="discovery_only">discovery_only</option>
              <option value="mapping_ready">mapping_ready</option>
              <option value="applied_double_helix">applied_double_helix</option>
            </select>
            <label for="override-reason">Reason:</label>
            <input id="override-reason" type="text" bind:value={overrideReason} placeholder="ratificado pelo pai..." />
            <button on:click={applyOverride}>Aplicar</button>
          </div>
        </details>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100;
    display: flex; align-items: center; justify-content: center;
  }
  .modal {
    background: #fff; padding: 1.5rem; border-radius: 8px;
    width: min(640px, 90vw); max-height: 90vh; overflow-y: auto;
  }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  header h2 { margin: 0; font-size: 1.1rem; }
  header button { background: transparent; border: none; font-size: 1.5rem; cursor: pointer; }
  .subject-picker { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; }
  .subject-picker input { flex: 1; padding: 0.3rem; }
  .err { color: #b00020; font-size: 0.9rem; }
  .state-card { background: #f7f7f7; padding: 1rem; border-radius: 4px; }
  .row { display: flex; justify-content: space-between; padding: 0.3rem 0; }
  .lbl { font-weight: 600; color: #555; }
  .val { color: #222; }
  .muted { color: #999; font-size: 0.85rem; }
  .stage-discovery_only { color: #1976d2; }
  .stage-mapping_ready { color: #f57c00; }
  .stage-applied_double_helix { color: #388e3c; }
  .bar { background: #ddd; height: 8px; border-radius: 4px; margin: 0.5rem 0; overflow: hidden; }
  .bar-fill { background: #1976d2; height: 100%; transition: width 0.3s; }
  .override { background: #fff3e0; padding: 0.75rem; border-radius: 4px; margin-top: 1rem; border-left: 3px solid #f57c00; }
  .override .reason { font-style: italic; color: #555; margin: 0.3rem 0; }
  .override-form { margin-top: 1rem; }
  .override-form summary { cursor: pointer; padding: 0.5rem; background: #eee; border-radius: 4px; }
  .form { display: grid; grid-template-columns: auto 1fr; gap: 0.5rem; align-items: center; margin-top: 0.5rem; }
  .form button { grid-column: 1 / span 2; padding: 0.4rem; }
</style>
