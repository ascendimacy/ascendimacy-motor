<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    consoleMode,
    currentContentPool,
    currentSessionId,
    currentTurnSnapshot,
    globalError,
  } from "../lib/stores.js";
  import type { ApiClient } from "../lib/api.js";

  export let api: ApiClient;
  /** Top N cards mostrados por default; resto fica em "show all" toggle. */
  export let topN = 3;
  /** Polling interval ms — só ativo em semi-auto mode. */
  export let pollIntervalMs = 250;

  let expanded = false;
  let overrideBusy: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  $: pool = $currentContentPool;
  $: snapshot = $currentTurnSnapshot;
  $: mode = $consoleMode;
  $: sessionId = $currentSessionId;
  $: shouldPoll = mode === "semi-auto" && sessionId !== null;
  $: selectedId = snapshot?.selectedContentId ?? null;

  // listOptions polling (semi-auto only). Default 250ms — agressivo o
  // suficiente pra Jun ver leque atualizado rápido sem ddos no BFF.
  async function fetchPool(): Promise<void> {
    if (sessionId === null) return;
    try {
      const res = await api.listOptions(sessionId);
      currentContentPool.set(res.contentPool);
    } catch (err) {
      // silencioso — pool offline não trava UX; bffStatus indicator cobre
      void err;
    }
  }

  $: if (shouldPoll && pollTimer === undefined) {
    void fetchPool();
    pollTimer = setInterval(() => void fetchPool(), pollIntervalMs);
  }

  $: if (!shouldPoll && pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
    currentContentPool.set([]);
  }

  onMount(() => {
    if (shouldPoll) {
      void fetchPool();
      pollTimer = setInterval(() => void fetchPool(), pollIntervalMs);
    }
  });

  onDestroy(() => {
    if (pollTimer !== undefined) clearInterval(pollTimer);
  });

  async function overrideTo(contentItemId: string): Promise<void> {
    if (sessionId === null || overrideBusy !== null) return;
    overrideBusy = contentItemId;
    globalError.set(null);
    try {
      const res = await api.overrideSelection(sessionId, contentItemId);
      if (!res.accepted) {
        const why = res.gateWasActive
          ? `id ${contentItemId} não está no pool`
          : "gate inativo (auto mode ou turn já passou)";
        globalError.set(`Override falhou: ${why}`);
      }
    } catch (err) {
      globalError.set(
        `Override erro: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      overrideBusy = null;
    }
  }

  /**
   * Combina pool com snapshot.contentPoolIds (do planning_started)
   * pra mostrar algo mesmo em auto mode (sem listOptions). Em semi-auto
   * pool ativo terá objetos completos com fact/bridge/quest.
   */
  $: displayPool = (() => {
    if (pool.length > 0) {
      return pool.map((s) => ({
        id: s.item.id,
        score: s.score,
        type: s.item.type ?? "",
        fact: typeof s.item["fact"] === "string"
          ? (s.item["fact"] as string)
          : "",
        full: true as const,
      }));
    }
    // Fallback — só ids do TurnStateEvent
    if (snapshot?.contentPoolIds !== undefined) {
      return snapshot.contentPoolIds.map((id) => ({
        id,
        score: 0,
        type: "",
        fact: "",
        full: false as const,
      }));
    }
    return [];
  })();

  $: visiblePool = expanded ? displayPool : displayPool.slice(0, topN);
</script>

<section class="content-pool" data-testid="content-pool">
  <h3>
    Leque pedagógico
    {#if mode === "semi-auto"}
      <span class="mode-badge">semi-auto</span>
    {/if}
    {#if displayPool.length > 0}
      <span class="count">({displayPool.length})</span>
    {/if}
  </h3>

  {#if displayPool.length === 0}
    <p class="empty" data-testid="pool-empty">
      Pool não disponível. Em <strong>auto</strong>, snapshot do
      planning_started lista ids; em <strong>semi-auto</strong>,
      listOptions popula com fact/bridge/quest.
    </p>
  {:else}
    <ul class="pool-list" data-testid="pool-list">
      {#each visiblePool as card (card.id)}
        <li
          class="card"
          class:selected={card.id === selectedId}
          data-testid="pool-card"
        >
          <div class="card-header">
            <code class="card-id">{card.id}</code>
            {#if card.type !== ""}
              <span class="type">{card.type}</span>
            {/if}
            {#if card.full}
              <span class="score">score {card.score.toFixed(1)}</span>
            {/if}
            {#if card.id === selectedId}
              <span class="selected-badge">selecionado</span>
            {/if}
          </div>
          {#if card.fact !== ""}
            <p class="fact">{card.fact}</p>
          {/if}
          {#if mode === "semi-auto" && card.id !== selectedId}
            <button
              type="button"
              class="override-btn"
              on:click={() => overrideTo(card.id)}
              disabled={overrideBusy === card.id}
              data-testid="override-button"
            >
              {overrideBusy === card.id ? "..." : "Override pra esse"}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if displayPool.length > topN}
      <button
        type="button"
        class="expand-toggle"
        on:click={() => (expanded = !expanded)}
        data-testid="expand-toggle"
      >
        {expanded
          ? `Mostrar só top ${topN}`
          : `Mostrar todas (${displayPool.length})`}
      </button>
    {/if}
  {/if}
</section>

<style>
  .content-pool {
    margin-top: 0.5rem;
    padding: 0.5rem 0.7rem;
    background: rgba(127, 127, 127, 0.06);
    border-radius: 4px;
  }

  h3 {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .mode-badge {
    background: rgba(255, 193, 7, 0.25);
    color: #b8860b;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .count {
    opacity: 0.6;
    font-weight: 400;
  }

  .empty {
    opacity: 0.6;
    font-size: 0.85rem;
    padding: 0.5rem;
    border: 1px dashed rgba(127, 127, 127, 0.3);
    border-radius: 4px;
  }

  .pool-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .card {
    background: rgba(127, 127, 127, 0.06);
    border: 1px solid rgba(127, 127, 127, 0.2);
    border-radius: 4px;
    padding: 0.4rem 0.6rem;
  }

  .card.selected {
    border-color: rgba(76, 175, 80, 0.6);
    background: rgba(76, 175, 80, 0.08);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: 0.85rem;
  }

  .card-id {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.85rem;
    background: rgba(127, 127, 127, 0.2);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }

  .type {
    opacity: 0.6;
    font-size: 0.75rem;
  }

  .score {
    margin-left: auto;
    opacity: 0.7;
    font-size: 0.8rem;
  }

  .selected-badge {
    background: rgba(76, 175, 80, 0.25);
    color: #2e7d32;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 600;
  }

  .fact {
    margin: 0.3rem 0;
    font-size: 0.85rem;
    line-height: 1.3;
  }

  .override-btn {
    margin-top: 0.3rem;
    padding: 0.2rem 0.6rem;
    border: 1px solid rgba(255, 193, 7, 0.6);
    background: rgba(255, 193, 7, 0.15);
    color: inherit;
    border-radius: 3px;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .override-btn:hover:not(:disabled) {
    background: rgba(255, 193, 7, 0.3);
  }

  .override-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .expand-toggle {
    margin-top: 0.5rem;
    width: 100%;
    padding: 0.3rem;
    background: transparent;
    border: 1px dashed rgba(127, 127, 127, 0.4);
    border-radius: 3px;
    color: inherit;
    cursor: pointer;
    font-size: 0.8rem;
    opacity: 0.7;
  }

  .expand-toggle:hover {
    opacity: 1;
    background: rgba(127, 127, 127, 0.1);
  }
</style>
