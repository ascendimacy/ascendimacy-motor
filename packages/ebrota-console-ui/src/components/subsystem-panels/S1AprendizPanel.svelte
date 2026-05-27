<script lang="ts">
  /**
   * S1 — Modelo do Aprendiz (panel).
   * Pergunta: "O que o motor crê sobre [persona] agora?"
   *
   * v0: identity card hardcoded + envelopa MapsPanel/DiscoveriesPanel
   * abrindo os toggles existentes + placeholders pra Objetivos / Threads
   * (specs em rascunho).
   */
  import { mapsPanelOpen, discoveriesPanelOpen, tracerSubjectId } from "../../lib/stores.js";
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";
  import PlaceholderBanner from "./PlaceholderBanner.svelte";

  const COLOR = "#3b82f6";

  function openMaps(): void {
    mapsPanelOpen.set(true);
  }
  function openDiscoveries(): void {
    discoveriesPanelOpen.set(true);
  }
</script>

<SubsystemPanelShell id="S1" title="Modelo do Aprendiz" color={COLOR}>
  <section class="block">
    <h3>Identity</h3>
    <dl class="identity">
      <dt>persona_id</dt><dd>{$tracerSubjectId}</dd>
      <dt>age</dt><dd>— <span class="muted">(v0 hardcoded)</span></dd>
      <dt>language</dt><dd>pt-BR · ja</dd>
      <dt>household</dt><dd>— <span class="muted">(v0 hardcoded)</span></dd>
      <dt>parental_telos</dt><dd>— <span class="muted">(v0 hardcoded)</span></dd>
    </dl>
  </section>

  <section class="block">
    <h3>Competências (CASEL × Dreyfus + Tree + Helix)</h3>
    <p class="hint">
      Visualização ao vivo via <code>MapsPanel</code> (Status bar → 🗺️).
    </p>
    <button type="button" class="action" on:click={openMaps}>
      Abrir MapsPanel
    </button>
  </section>

  <section class="block">
    <h3>Subject Knowledge</h3>
    <p class="hint">
      Ledger de conceitos via <code>DiscoveriesPanel</code> (Status bar →
      🔍).
    </p>
    <button type="button" class="action" on:click={openDiscoveries}>
      Abrir DiscoveriesPanel
    </button>
  </section>

  <section class="block">
    <h3>Mood</h3>
    <div class="sparkline-placeholder" aria-hidden="true">
      <span class="bar" style="height:30%"></span>
      <span class="bar" style="height:55%"></span>
      <span class="bar" style="height:70%"></span>
      <span class="bar" style="height:60%"></span>
      <span class="bar" style="height:75%"></span>
    </div>
    <p class="muted small">
      sparkline placeholder — TODO link com trace v2 (US-S1-04)
    </p>
  </section>

  <section class="block">
    <h3>Objetivos declarados</h3>
    <PlaceholderBanner
      label="spec em rascunho — feature ainda não wired"
      specPath="docs/specs/2026-05-26-s1-objetivos-declarados-v0.md"
      color={COLOR}
    />
  </section>

  <section class="block">
    <h3>Narrative Threads</h3>
    <PlaceholderBanner
      label="spec B1 hooks em rascunho — feature ainda não wired"
      specPath="docs/specs/2026-05-26-b1-hooks-temporais-v0.md"
      color={COLOR}
    />
  </section>
</SubsystemPanelShell>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  h3 {
    margin: 0 0 0.3rem 0;
    font-size: 0.95rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
    padding-bottom: 0.2rem;
  }
  .identity {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 0.8rem;
    row-gap: 0.2rem;
    margin: 0;
    font-size: 0.85rem;
  }
  .identity dt {
    font-weight: 600;
    opacity: 0.8;
  }
  .identity dd {
    margin: 0;
  }
  .hint {
    font-size: 0.85rem;
    opacity: 0.85;
    margin: 0;
  }
  .muted {
    opacity: 0.55;
    font-size: 0.78rem;
  }
  .small {
    font-size: 0.75rem;
    margin: 0;
  }
  .action {
    align-self: flex-start;
    padding: 0.3rem 0.7rem;
    background: transparent;
    border: 1px solid rgba(59, 130, 246, 0.6);
    border-radius: 4px;
    font: inherit;
    font-size: 0.8rem;
    color: inherit;
    cursor: pointer;
  }
  .action:hover {
    background: rgba(59, 130, 246, 0.12);
  }
  .sparkline-placeholder {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 40px;
    padding: 0.2rem 0;
  }
  .bar {
    width: 8px;
    background: linear-gradient(to top, rgba(59, 130, 246, 0.35), rgba(59, 130, 246, 0.9));
    border-radius: 2px;
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.82em;
    background: rgba(127, 127, 127, 0.18);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
