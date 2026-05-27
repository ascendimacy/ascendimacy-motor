<script lang="ts">
  /**
   * SubsystemCard — card visual de um subsistema (S1/S2/S3/S4/S5/B1/B2).
   * Usado no SubsystemGrid landing. Click → emite event "expand" com id.
   *
   * Spec: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-7-subsistemas-redesign-v0.md
   */
  import { createEventDispatcher } from "svelte";

  export let id: string;
  export let title: string;
  export let subtitle: string = "";
  export let vitalSign: string = "";
  export let status: "impl" | "partial" | "placeholder" = "impl";
  export let color: string = "#7f7f7f";

  const dispatch = createEventDispatcher<{ expand: { id: string } }>();

  function statusIcon(s: typeof status): string {
    switch (s) {
      case "impl":
        return "✅";
      case "partial":
        return "◑";
      case "placeholder":
        return "📋";
    }
  }

  function handleClick(): void {
    dispatch("expand", { id });
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }
</script>

<button
  type="button"
  class="subsystem-card"
  data-testid={`subsystem-card-${id}`}
  data-subsystem-id={id}
  on:click={handleClick}
  on:keydown={handleKey}
  style:--accent={color}
>
  <header class="card-header">
    <span class="badge" aria-hidden="true">{id}</span>
    <span class="status" title={`status: ${status}`}>{statusIcon(status)}</span>
  </header>
  <h3 class="title">{title}</h3>
  {#if subtitle.length > 0}
    <p class="subtitle">{subtitle}</p>
  {/if}
  {#if vitalSign.length > 0}
    <div class="vital">{vitalSign}</div>
  {/if}
</button>

<style>
  .subsystem-card {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.9rem 1rem;
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-left: 4px solid var(--accent);
    border-radius: 6px;
    background: var(--color-bg, transparent);
    color: inherit;
    text-align: left;
    cursor: pointer;
    font: inherit;
    min-height: 7.5rem;
    transition: transform 80ms ease, box-shadow 80ms ease;
  }
  .subsystem-card:hover,
  .subsystem-card:focus-visible {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.75rem;
    opacity: 0.85;
  }
  .badge {
    font-weight: 700;
    letter-spacing: 0.05em;
    color: var(--accent);
  }
  .title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .subtitle {
    margin: 0;
    font-size: 0.8rem;
    opacity: 0.75;
  }
  .vital {
    margin-top: auto;
    font-size: 0.8rem;
    opacity: 0.9;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  }
</style>
