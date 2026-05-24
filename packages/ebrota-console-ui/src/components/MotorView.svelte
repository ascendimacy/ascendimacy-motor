<script lang="ts">
  import { currentTurnSnapshot } from "../lib/stores.js";
  import ContentPool from "./ContentPool.svelte";
  import type { ApiClient } from "../lib/api.js";

  export let api: ApiClient;

  $: snapshot = $currentTurnSnapshot;

  // Lookup table pra rótulos das fases
  const phaseLabel: Record<string, string> = {
    planning_started: "1/4 Planejando",
    selection_made: "2/4 Selecionando",
    materialization_ready: "3/4 Materializando",
    playbook_executed: "4/4 Executado",
  };
</script>

<section class="motor-view" data-testid="motor-view">
  <h2>Vista motor</h2>

  {#if snapshot === null}
    <p class="empty" data-testid="motor-empty">
      Sem turn ativo. Painel pedagógico vai popular após
      <code>startCardSession</code>.
    </p>
  {:else}
    <div class="phase-tracker" data-testid="phase-tracker">
      <span class="phase-label">{phaseLabel[snapshot.lastPhase]}</span>
      <span class="turn-num">turn #{snapshot.turn}</span>
      <span class="timestamp">{snapshot.lastTimestamp}</span>
    </div>

    {#if snapshot.strategicRationale !== undefined}
      <details class="info-block" open data-testid="rationale-block">
        <summary>Strategic rationale</summary>
        <p class="rationale">{snapshot.strategicRationale}</p>
      </details>
    {/if}

    {#if snapshot.contextHints !== undefined && Object.keys(snapshot.contextHints).length > 0}
      <details class="info-block" data-testid="context-hints-block">
        <summary>Context hints</summary>
        <pre class="json">{JSON.stringify(snapshot.contextHints, null, 2)}</pre>
      </details>
    {/if}

    {#if snapshot.transitionEvaluationsCount !== undefined && snapshot.transitionEvaluationsCount > 0}
      <p class="meta" data-testid="transitions-count">
        Transitions avaliadas: <strong>{snapshot.transitionEvaluationsCount}</strong>
      </p>
    {/if}

    {#if snapshot.selectedContentId !== undefined}
      <div class="selection" data-testid="selection-block">
        <h3>Selecionado</h3>
        <p class="selected-id">
          <code>{snapshot.selectedContentId}</code>
          {#if snapshot.selectedContentScore !== undefined}
            <span class="score">score {snapshot.selectedContentScore.toFixed(1)}</span>
          {/if}
        </p>
        {#if snapshot.selectionRationale !== undefined}
          <p class="rationale">{snapshot.selectionRationale}</p>
        {/if}
      </div>
    {/if}

    {#if snapshot.proposedText !== undefined}
      <details class="info-block" open data-testid="proposed-text-block">
        <summary>Texto materializado</summary>
        <blockquote class="proposed">{snapshot.proposedText}</blockquote>
        {#if snapshot.instructionAdditionApplied}
          <p class="meta">
            <span class="badge">instruction_addition aplicado</span>
            (pkg pedagógico fluiu pro motor-drota)
          </p>
        {/if}
      </details>
    {/if}

    {#if snapshot.playbookId !== undefined}
      <p class="meta" data-testid="playbook-info">
        Playbook: <code>{snapshot.playbookId}</code>
        {#if snapshot.playbookSuccess === true}
          <span class="badge success">✓ sucesso</span>
        {:else if snapshot.playbookSuccess === false}
          <span class="badge fail">✗ falha</span>
        {/if}
        {#if snapshot.newTurnNumber !== undefined}
          → próximo turn #{snapshot.newTurnNumber}
        {/if}
      </p>
    {/if}

    <ContentPool {api} />
  {/if}
</section>

<style>
  .motor-view {
    padding: 1rem;
    overflow-y: auto;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
    opacity: 0.7;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  h3 {
    margin: 0 0 0.3rem;
    font-size: 0.9rem;
    opacity: 0.8;
  }

  .empty {
    opacity: 0.6;
    font-size: 0.9rem;
    padding: 1rem;
    border: 1px dashed rgba(127, 127, 127, 0.3);
    border-radius: 4px;
  }

  .phase-tracker {
    display: flex;
    gap: 1rem;
    align-items: center;
    background: rgba(33, 150, 243, 0.1);
    border-left: 3px solid #2196f3;
    padding: 0.4rem 0.7rem;
    border-radius: 0 4px 4px 0;
    font-size: 0.85rem;
  }

  .phase-label {
    font-weight: 600;
  }

  .turn-num {
    opacity: 0.6;
  }

  .timestamp {
    margin-left: auto;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.75rem;
    opacity: 0.5;
  }

  .info-block {
    background: rgba(127, 127, 127, 0.06);
    border-radius: 4px;
    padding: 0.5rem 0.7rem;
  }

  .info-block summary {
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    opacity: 0.8;
    user-select: none;
  }

  .info-block summary:hover {
    opacity: 1;
  }

  .rationale {
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
    line-height: 1.4;
  }

  .json {
    margin: 0.5rem 0 0;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.75rem;
    background: rgba(0, 0, 0, 0.08);
    padding: 0.5rem;
    border-radius: 3px;
    overflow-x: auto;
  }

  .selection {
    background: rgba(76, 175, 80, 0.08);
    border-left: 3px solid #4caf50;
    padding: 0.5rem 0.7rem;
    border-radius: 0 4px 4px 0;
  }

  .selected-id {
    margin: 0 0 0.3rem;
    font-size: 0.95rem;
  }

  .selected-id .score {
    margin-left: 0.5rem;
    font-size: 0.8rem;
    opacity: 0.7;
  }

  .proposed {
    margin: 0.5rem 0 0;
    padding: 0.5rem 0.7rem;
    border-left: 3px solid rgba(33, 150, 243, 0.5);
    font-style: italic;
    font-size: 0.9rem;
    background: rgba(127, 127, 127, 0.05);
  }

  .meta {
    margin: 0.3rem 0;
    font-size: 0.85rem;
    opacity: 0.8;
  }

  .badge {
    display: inline-block;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 600;
    background: rgba(127, 127, 127, 0.2);
    margin-left: 0.3rem;
  }

  .badge.success {
    background: rgba(76, 175, 80, 0.25);
    color: #2e7d32;
  }

  .badge.fail {
    background: rgba(176, 0, 32, 0.25);
    color: #b00020;
  }

  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.85em;
    background: rgba(127, 127, 127, 0.2);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
