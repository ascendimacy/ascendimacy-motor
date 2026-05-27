<script lang="ts">
  import type { ParentalAlert } from "./parental-types.js";

  export let alert: ParentalAlert;
  export let onPause: () => void;
  export let onContactJun: () => void;
  export let onDismiss: () => void;

  function severityLabel(s: ParentalAlert["severity"]): string {
    if (s === "critical") return "CRÍTICO";
    if (s === "warn") return "ATENÇÃO";
    return "INFO";
  }

  function typeLabel(t: ParentalAlert["type"]): string {
    if (t === "distress") return "Distress detectado";
    if (t === "drift") return "Drift de objetivo";
    if (t === "negative_sequence") return "Sequência negativa";
    return "Outro";
  }
</script>

<div
  class="banner severity-{alert.severity}"
  data-testid="alert-banner"
  data-alert-id={alert.alertId}
  role="alert"
>
  <div class="head">
    <span class="badge">{severityLabel(alert.severity)}</span>
    <strong>{typeLabel(alert.type)}</strong>
  </div>
  <p class="context">{alert.context}</p>
  <blockquote class="excerpt">"{alert.excerpt}"</blockquote>
  {#if alert.sessionRefs.length > 0}
    <p class="refs">
      <span class="muted small">Sessões:</span>
      {alert.sessionRefs.join(", ")}
    </p>
  {/if}
  <div class="actions">
    {#if alert.proposedAction === "pause_brota"}
      <button class="primary" on:click={onPause}>Pausar Brota agora</button>
    {/if}
    <button class="ghost" on:click={onContactJun}>Contatar Jun</button>
    <button class="ghost" on:click={onDismiss}>Dispensar</button>
  </div>
</div>

<style>
  .banner {
    border-radius: 10px;
    padding: 1rem 1.1rem;
    margin: 0.5rem 0;
    border-left: 4px solid currentColor;
    background: rgba(255, 255, 255, 0.04);
  }
  .banner.severity-critical {
    color: #e57373;
    background: rgba(229, 115, 115, 0.08);
  }
  .banner.severity-warn {
    color: #ffb74d;
    background: rgba(255, 183, 77, 0.08);
  }
  .banner.severity-info {
    color: #64b5f6;
    background: rgba(100, 181, 246, 0.08);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.3rem;
  }
  .badge {
    font-size: 0.7rem;
    background: currentColor;
    color: var(--color-bg, #1f1f1f);
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-weight: 700;
    letter-spacing: 0.05em;
  }
  .context {
    color: inherit;
    margin: 0.2rem 0;
    font-size: 0.9rem;
  }
  .excerpt {
    margin: 0.4rem 0;
    padding: 0.4rem 0.7rem;
    background: rgba(255, 255, 255, 0.05);
    border-left: 2px solid rgba(127, 127, 127, 0.4);
    font-size: 0.85rem;
    font-style: italic;
    color: var(--color-fg, inherit);
  }
  .refs {
    margin: 0.3rem 0;
    font-size: 0.85rem;
    color: var(--color-fg, inherit);
  }
  .muted {
    opacity: 0.7;
  }
  .small {
    font-size: 0.8rem;
  }
  .actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
  }
  button {
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    border: 1px solid transparent;
    cursor: pointer;
    font-size: 0.85rem;
    font-family: inherit;
  }
  .primary {
    background: currentColor;
    color: var(--color-bg, #1f1f1f);
    border-color: currentColor;
    font-weight: 600;
  }
  .ghost {
    background: transparent;
    color: var(--color-fg, inherit);
    border-color: rgba(127, 127, 127, 0.4);
  }
</style>
