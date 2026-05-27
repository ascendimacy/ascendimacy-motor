<script lang="ts">
  /**
   * B1 social — cards emitidos no turno + sacrifice cost + pulso emitido.
   *
   * Pipeline social ainda não emite campos canônicos em trace v2 — campo
   * tolerante a ausência. Quando turn.cardsEmitted/sacrificeCost/pulseEmitted
   * faltam, mostra "não houve" placeholder.
   */
  import type { ReplayTraceTurn } from "../../lib/api.js";
  import SectionShell from "./SectionShell.svelte";

  export let turn: ReplayTraceTurn;

  const COLOR = "#8b5cf6";

  $: cards = turn.cardsEmitted ?? [];
  $: cost = turn.sacrificeCost;
  $: pulse = turn.pulseEmitted === true;

  $: hasAny = cards.length > 0 || cost !== undefined || pulse;
</script>

<SectionShell id="B1" title="Social (cards / pulso)" color={COLOR}>
  <span slot="meta">
    {#if cards.length > 0}
      <span class="badge social" data-testid="section-B1-cards-count"
        >{cards.length} card{cards.length === 1 ? "" : "s"}</span
      >
    {/if}
    {#if pulse}
      <span class="badge pulse" data-testid="section-B1-pulse">🌐 pulso</span>
    {/if}
    {#if cost !== undefined}
      <span class="badge cost" data-testid="section-B1-cost">cost={cost}</span>
    {/if}
    {#if !hasAny}
      <span class="badge muted">não houve</span>
    {/if}
  </span>

  {#if !hasAny}
    <p class="empty">não houve emissão social neste turno (cards/pulse/cost ausentes)</p>
  {/if}

  {#if cards.length > 0}
    <div class="block">
      <strong>Cards emitidos:</strong>
      <ul>
        {#each cards as card, i}
          {@const id = typeof card["id"] === "string" ? card["id"] : `card-${i}`}
          {@const kind = typeof card["kind"] === "string" ? card["kind"] : undefined}
          <li>
            <code>{id}</code>
            {#if kind}<span class="muted-row">· kind={kind}</span>{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if cost !== undefined}
    <p class="row"><strong>sacrifice cost:</strong> <code>{cost}</code></p>
  {/if}

  {#if pulse}
    <p class="row">🌐 turno emitiu pulso social</p>
  {/if}
</SectionShell>

<style>
  .badge {
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .badge.social {
    background: rgba(139, 92, 246, 0.22);
    color: #5b21b6;
  }
  .badge.pulse {
    background: rgba(6, 182, 212, 0.22);
    color: #0e7490;
  }
  .badge.cost {
    background: rgba(127, 127, 127, 0.2);
  }
  .badge.muted {
    background: rgba(127, 127, 127, 0.18);
    opacity: 0.6;
    font-weight: 400;
  }
  .block {
    margin: 0.3rem 0;
  }
  .block ul {
    margin: 0.1rem 0;
    padding-left: 1.2rem;
  }
  .block li {
    padding: 0.1rem 0;
  }
  .row {
    margin: 0.25rem 0;
    line-height: 1.5;
  }
  .muted-row {
    opacity: 0.7;
    font-size: 0.72rem;
    margin-left: 0.3rem;
  }
  .empty {
    opacity: 0.6;
    font-style: italic;
    margin: 0.15rem 0;
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.78em;
    background: rgba(127, 127, 127, 0.15);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
