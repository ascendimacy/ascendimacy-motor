<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    debugLlmEvents,
    debugPanelOpen,
    globalError,
  } from "../lib/stores.js";
  import type { ApiClient, DebugLlmCallEvent } from "../lib/api.js";

  export let api: ApiClient;
  /** Polling ms — V0.1 tail mode. Default 500ms (debug = passive,
   *  não NFR-critical). */
  export let pollIntervalMs = 500;

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let lastSeenId = 0;
  let expandedIds = new Set<number>();
  let totalEmitted = 0;

  $: open = $debugPanelOpen;
  $: events = $debugLlmEvents;

  async function fetchEvents(): Promise<void> {
    try {
      const res = await api.listDebugLlmCalls(lastSeenId);
      if (res.events.length > 0) {
        debugLlmEvents.update((prev) => [...prev, ...res.events]);
        lastSeenId = res.events[res.events.length - 1]!.id;
      }
      totalEmitted = res.totalEmitted;
    } catch (err) {
      void err;
    }
  }

  $: if (open && pollTimer === undefined) {
    void fetchEvents();
    pollTimer = setInterval(() => void fetchEvents(), pollIntervalMs);
  }

  $: if (!open && pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }

  onMount(() => {
    if (open) {
      void fetchEvents();
      pollTimer = setInterval(() => void fetchEvents(), pollIntervalMs);
    }
  });

  onDestroy(() => {
    if (pollTimer !== undefined) clearInterval(pollTimer);
  });

  function toggleExpanded(id: number): void {
    if (expandedIds.has(id)) {
      expandedIds.delete(id);
    } else {
      expandedIds.add(id);
    }
    expandedIds = new Set(expandedIds);
  }

  async function clearAll(): Promise<void> {
    try {
      await api.clearDebugLlmCalls();
      debugLlmEvents.set([]);
      lastSeenId = 0;
      expandedIds.clear();
      expandedIds = new Set();
    } catch (err) {
      globalError.set(
        `Clear debug falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function providerColor(provider: DebugLlmCallEvent["provider"]): string {
    switch (provider) {
      case "anthropic":
        return "anthropic";
      case "infomaniak":
        return "infomaniak";
      case "local":
        return "local";
      default:
        return "unknown";
    }
  }

  /** Token estimate rough (~4 chars/token). */
  function estimateTokens(event: DebugLlmCallEvent): number {
    const parts = [
      event.prompt.system ?? "",
      event.prompt.user ?? "",
      event.prompt.assistantPrefill ?? "",
      event.prompt.raw ?? "",
    ];
    return Math.ceil(parts.join("").length / 4);
  }
</script>

{#if open}
  <aside class="debug-panel" data-testid="debug-panel">
    <header>
      <h2>
        Debug LLM
        <span class="tail-badge">tail</span>
      </h2>
      <span class="total" data-testid="debug-total">
        {totalEmitted} total
      </span>
      <button
        type="button"
        class="ghost"
        on:click={clearAll}
        data-testid="debug-clear"
      >
        Limpar
      </button>
      <button
        type="button"
        class="close"
        on:click={() => debugPanelOpen.set(false)}
        aria-label="Fechar debug panel"
        data-testid="debug-close"
      >
        ×
      </button>
    </header>

    <div class="list" data-testid="debug-list">
      {#if events.length === 0}
        <p class="muted" data-testid="debug-empty">
          Nenhum LLM call interceptado. Em produção, requer
          <code>ASC_LLM_DEBUG_MODE=true</code> +
          <code>shared/gateway-client.ts</code> POSTando aqui (hook
          é PR follow-up).
        </p>
      {:else}
        {#each events as event (event.id)}
          <article
            class="event"
            class:expanded={expandedIds.has(event.id)}
            data-testid="debug-event"
          >
            <header class="event-header">
              <button
                type="button"
                class="event-toggle"
                on:click={() => toggleExpanded(event.id)}
                data-testid="debug-event-toggle"
              >
                <span class="provider provider-{providerColor(event.provider)}"
                  >{event.provider}</span
                >
                <code class="model">{event.model}</code>
                <span class="step">{event.step}</span>
                <span class="tokens" title="estimate (~4 chars/token)">
                  ~{estimateTokens(event)} tok
                </span>
                <span class="time">{event.receivedAt}</span>
              </button>
            </header>

            {#if expandedIds.has(event.id)}
              <div class="event-body" data-testid="debug-event-body">
                {#if event.prompt.system !== undefined && event.prompt.system.length > 0}
                  <details open>
                    <summary>system</summary>
                    <pre>{event.prompt.system}</pre>
                  </details>
                {/if}
                {#if event.prompt.user !== undefined && event.prompt.user.length > 0}
                  <details open>
                    <summary>user</summary>
                    <pre>{event.prompt.user}</pre>
                  </details>
                {/if}
                {#if event.prompt.assistantPrefill !== undefined && event.prompt.assistantPrefill.length > 0}
                  <details>
                    <summary>assistant prefill</summary>
                    <pre>{event.prompt.assistantPrefill}</pre>
                  </details>
                {/if}
                {#if event.prompt.raw !== undefined && event.prompt.raw.length > 0}
                  <details>
                    <summary>raw</summary>
                    <pre>{event.prompt.raw}</pre>
                  </details>
                {/if}
                {#if event.params !== undefined && Object.keys(event.params).length > 0}
                  <details>
                    <summary>params</summary>
                    <pre>{JSON.stringify(event.params, null, 2)}</pre>
                  </details>
                {/if}
                {#if event.sessionId !== undefined}
                  <p class="meta">
                    session: <code>{event.sessionId}</code>
                    {#if event.turn !== undefined}
                      &middot; turn #{event.turn}
                    {/if}
                  </p>
                {/if}
              </div>
            {/if}
          </article>
        {/each}
      {/if}
    </div>
  </aside>
{/if}

<style>
  .debug-panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 50vh;
    background: var(--bg, #ffffff);
    border-top: 2px solid rgba(33, 150, 243, 0.5);
    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.15);
    display: flex;
    flex-direction: column;
    z-index: 40;
  }

  @media (prefers-color-scheme: dark) {
    .debug-panel {
      background: #1c1c1c;
    }
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.3);
    background: rgba(33, 150, 243, 0.05);
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.85;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .tail-badge {
    background: rgba(33, 150, 243, 0.3);
    color: #1565c0;
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-weight: 600;
  }

  .total {
    margin-left: auto;
    font-size: 0.8rem;
    opacity: 0.6;
  }

  button {
    background: rgba(127, 127, 127, 0.15);
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 3px;
    padding: 0.2rem 0.5rem;
    color: inherit;
    font-family: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }

  button.close {
    background: transparent;
    border: none;
    font-size: 1.3rem;
    padding: 0.2rem 0.5rem;
  }

  button:hover {
    background: rgba(127, 127, 127, 0.25);
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 0.4rem;
  }

  .muted {
    opacity: 0.6;
    padding: 1rem;
    text-align: center;
  }

  .event {
    margin-bottom: 0.3rem;
    border: 1px solid rgba(127, 127, 127, 0.2);
    border-radius: 4px;
    background: rgba(127, 127, 127, 0.04);
  }

  .event.expanded {
    background: rgba(127, 127, 127, 0.08);
  }

  .event-toggle {
    background: transparent;
    border: none;
    width: 100%;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0.4rem 0.6rem;
    font-family: inherit;
    color: inherit;
    cursor: pointer;
  }

  .provider {
    text-transform: uppercase;
    font-size: 0.65rem;
    font-weight: 700;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
  }

  .provider-anthropic {
    background: rgba(176, 0, 32, 0.2);
    color: #b00020;
  }

  .provider-infomaniak {
    background: rgba(33, 150, 243, 0.2);
    color: #1565c0;
  }

  .provider-local {
    background: rgba(127, 127, 127, 0.25);
    color: #555;
  }

  .provider-unknown {
    background: rgba(127, 127, 127, 0.15);
    color: #777;
  }

  .model {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.75rem;
    background: rgba(127, 127, 127, 0.15);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }

  .step {
    font-size: 0.8rem;
    opacity: 0.85;
  }

  .tokens {
    margin-left: auto;
    font-size: 0.7rem;
    opacity: 0.6;
  }

  .time {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.7rem;
    opacity: 0.5;
  }

  .event-body {
    padding: 0.4rem 0.7rem 0.6rem;
    border-top: 1px dashed rgba(127, 127, 127, 0.2);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .event-body details {
    background: rgba(0, 0, 0, 0.06);
    border-radius: 3px;
    padding: 0.3rem 0.5rem;
  }

  @media (prefers-color-scheme: dark) {
    .event-body details {
      background: rgba(255, 255, 255, 0.06);
    }
  }

  .event-body summary {
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 600;
    opacity: 0.8;
  }

  .event-body pre {
    margin: 0.3rem 0 0;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 150px;
    overflow-y: auto;
  }

  .meta {
    font-size: 0.75rem;
    opacity: 0.7;
    margin: 0.2rem 0 0;
  }

  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.75rem;
    background: rgba(127, 127, 127, 0.15);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
