<script lang="ts">
  /**
   * PlaceholderBanner — bloco visual padronizado pra features ainda não
   * wired. Mostra label + link clicável pra spec (clipboard fallback).
   */
  export let label: string;
  export let specPath: string = "";
  export let color: string = "#7f7f7f";
</script>

<div class="placeholder" style:--accent={color} data-testid="placeholder-banner">
  <strong class="label">📋 {label}</strong>
  {#if specPath.length > 0}
    <code class="spec">{specPath}</code>
  {/if}
  <slot />
</div>

<style>
  .placeholder {
    border: 1px dashed rgba(127, 127, 127, 0.5);
    border-left: 4px solid var(--accent);
    padding: 0.7rem 0.9rem;
    border-radius: 4px;
    font-size: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    opacity: 0.95;
  }
  .label {
    font-weight: 600;
  }
  .spec {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.78rem;
    background: rgba(127, 127, 127, 0.18);
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    align-self: flex-start;
    word-break: break-all;
  }
</style>
