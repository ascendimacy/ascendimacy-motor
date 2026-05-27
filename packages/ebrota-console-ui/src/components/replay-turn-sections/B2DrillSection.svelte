<script lang="ts">
  /**
   * B2 drill — items drilled no turno (correct/incorrect).
   *
   * B2 ainda não está wired no motor — campo turn.drillAttempts é emergent.
   * Quase sempre mostra "não houve" placeholder no estado atual.
   */
  import type { ReplayTraceTurn } from "../../lib/api.js";
  import SectionShell from "./SectionShell.svelte";

  export let turn: ReplayTraceTurn;

  const COLOR = "#6b7280";

  $: attempts = turn.drillAttempts ?? [];
  $: correct = attempts.filter((a) => a.correct === true).length;
  $: incorrect = attempts.filter((a) => a.correct === false).length;
  $: hasAny = attempts.length > 0;
</script>

<SectionShell id="B2" title="Drilling" color={COLOR}>
  <span slot="meta">
    {#if hasAny}
      <span class="badge correct" data-testid="section-B2-correct">{correct} ✓</span>
      <span class="badge incorrect" data-testid="section-B2-incorrect">{incorrect} ✗</span>
    {:else}
      <span class="badge muted" data-testid="section-B2-empty">não houve</span>
    {/if}
  </span>

  {#if !hasAny}
    <p class="empty">
      não houve drill neste turno (B2 ainda ausente como sistema — ver spec
      <code>2026-05-26-b2-drilling-primer-v0.md</code>)
    </p>
  {/if}

  {#if hasAny}
    <ul class="attempts">
      {#each attempts as a, i}
        <li class:correct={a.correct === true} class:incorrect={a.correct === false}>
          <span class="ico" aria-hidden="true">
            {a.correct === true ? "✓" : a.correct === false ? "✗" : "·"}
          </span>
          {#if a.item_id}
            <code>{a.item_id}</code>
          {:else}
            <code>drill-{i}</code>
          {/if}
          {#if a.prompt}<span class="muted-row">prompt: {a.prompt}</span>{/if}
          {#if a.given !== undefined}
            <span class="muted-row">given: <code>{a.given}</code></span>
          {/if}
          {#if a.expected !== undefined && a.correct === false}
            <span class="muted-row">expected: <code>{a.expected}</code></span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</SectionShell>

<style>
  .badge {
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .badge.correct {
    background: rgba(34, 197, 94, 0.22);
    color: #166534;
  }
  .badge.incorrect {
    background: rgba(176, 0, 32, 0.2);
    color: #b00020;
  }
  .badge.muted {
    background: rgba(127, 127, 127, 0.18);
    opacity: 0.7;
    font-weight: 400;
  }
  .empty {
    opacity: 0.6;
    font-style: italic;
    margin: 0.15rem 0;
  }
  .attempts {
    list-style: none;
    padding: 0;
    margin: 0.2rem 0;
  }
  .attempts li {
    padding: 0.15rem 0.4rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: baseline;
    border-left: 2px solid transparent;
  }
  .attempts li.correct {
    border-left-color: #22c55e;
  }
  .attempts li.incorrect {
    border-left-color: #b00020;
  }
  .ico {
    width: 1rem;
    text-align: center;
    font-weight: 600;
  }
  .muted-row {
    opacity: 0.7;
    font-size: 0.72rem;
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.78em;
    background: rgba(127, 127, 127, 0.15);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
