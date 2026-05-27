<script lang="ts">
  /**
   * SubsystemPanelShell — chrome compartilhado dos 7 painéis (S1-B2).
   * Header com badge + title + close, slot pra conteúdo.
   * Click fora ou ESC fecha (seta expandedSubsystem=null).
   */
  import { expandedSubsystem } from "../../lib/stores.js";
  import { onMount, onDestroy } from "svelte";

  export let id: string;
  export let title: string;
  export let color: string = "#7f7f7f";

  function close(): void {
    expandedSubsystem.set(null);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }

  onMount(() => {
    window.addEventListener("keydown", onKey);
  });
  onDestroy(() => {
    window.removeEventListener("keydown", onKey);
  });
</script>

<section
  class="panel-shell"
  data-testid={`subsystem-panel-${id}`}
  data-subsystem-id={id}
  style:--accent={color}
  aria-label={`painel ${id} — ${title}`}
>
  <header class="panel-header">
    <div class="title-block">
      <span class="badge">{id}</span>
      <h2>{title}</h2>
    </div>
    <button
      type="button"
      class="close-btn"
      on:click={close}
      data-testid={`subsystem-panel-${id}-close`}
      aria-label="voltar ao grid"
      title="voltar ao grid (Esc)"
    >
      ← voltar
    </button>
  </header>
  <div class="panel-body">
    <slot />
  </div>
</section>

<style>
  .panel-shell {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    border-left: 4px solid var(--accent);
    background: var(--color-bg, transparent);
  }
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
  }
  .title-block {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  .badge {
    font-weight: 700;
    color: var(--accent);
    font-size: 0.85rem;
    letter-spacing: 0.05em;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .close-btn {
    background: transparent;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 4px;
    padding: 0.25rem 0.6rem;
    font: inherit;
    font-size: 0.8rem;
    color: inherit;
    cursor: pointer;
  }
  .close-btn:hover {
    border-color: var(--accent);
  }
  .panel-body {
    flex: 1;
    overflow: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
</style>
