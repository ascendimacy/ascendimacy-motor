<script lang="ts">
  import { replaySessionId, globalError } from "../lib/stores.js";
  import type { ApiClient, ReplayTrace } from "../lib/api.js";
  import ReplayTurnDetail from "./ReplayTurnDetail.svelte";

  export let api: ApiClient;

  let trace: ReplayTrace | null = null;
  let loading = false;
  let currentSessionId: string | null = null;

  $: sessionId = $replaySessionId;

  // Quando replaySessionId muda, fetch novo trace
  $: if (sessionId !== currentSessionId) {
    currentSessionId = sessionId;
    trace = null;
    if (sessionId !== null) {
      void loadTrace(sessionId);
    }
  }

  async function loadTrace(id: string): Promise<void> {
    loading = true;
    try {
      trace = await api.getSessionReplay(id);
    } catch (err) {
      globalError.set(
        `Replay falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      trace = null;
    } finally {
      loading = false;
    }
  }

  function close(): void {
    replaySessionId.set(null);
  }
</script>

{#if sessionId !== null}
  <div
    class="replay-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Replay de sessão"
    data-testid="replay-overlay"
    on:click|self={close}
    on:keydown={(e) => {
      if (e.key === "Escape") close();
    }}
  >
    <div class="replay-modal" data-testid="replay-modal">
      <header>
        <h2>Replay</h2>
        <code class="session-id">{sessionId}</code>
        <button
          type="button"
          class="close"
          on:click={close}
          aria-label="Fechar replay"
          data-testid="replay-close"
        >
          ×
        </button>
      </header>

      {#if loading}
        <p class="muted">Carregando trace...</p>
      {:else if trace === null}
        <p class="muted">Trace não disponível.</p>
      {:else}
        <div class="meta-block">
          <p>
            <strong>persona:</strong> {trace.persona ?? "(unknown)"}
          </p>
          {#if trace.startedAt !== undefined}
            <p>
              <strong>started:</strong>
              <code>{trace.startedAt}</code>
            </p>
          {/if}
          {#if trace.endedAt !== undefined}
            <p>
              <strong>ended:</strong>
              <code>{trace.endedAt}</code>
            </p>
          {/if}
          <p>
            <strong>turns:</strong> {trace.turns?.length ?? 0}
          </p>
        </div>

        {#if trace.turns !== undefined && trace.turns.length > 0}
          <ol class="turns" data-testid="replay-turns">
            {#each trace.turns as turn (turn.turnNumber ?? Math.random())}
              <li class="turn" data-testid="replay-turn">
                <header class="turn-header">
                  <strong>turn #{turn.turnNumber ?? "?"}</strong>
                  {#if turn.timestamp !== undefined}
                    <span class="time">{turn.timestamp}</span>
                  {/if}
                </header>
                {#if turn.incomingMessage !== undefined}
                  <div class="message user">
                    <span class="role">user</span>
                    <p>{turn.incomingMessage}</p>
                  </div>
                {/if}
                {#if turn.finalResponse !== undefined}
                  <div class="message bot">
                    <span class="role">bot</span>
                    <p>{turn.finalResponse}</p>
                  </div>
                {/if}
                <ReplayTurnDetail {turn} />
              </li>
            {/each}
          </ol>
        {:else}
          <p class="muted">Nenhum turn registrado.</p>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .replay-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
    padding: 1rem;
  }

  .replay-modal {
    background: var(--bg, #ffffff);
    border-radius: 8px;
    width: min(800px, 100%);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  @media (prefers-color-scheme: dark) {
    .replay-modal {
      background: #1e1e1e;
    }
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.3);
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.8;
  }

  .session-id {
    flex: 1;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.8rem;
    opacity: 0.6;
  }

  .close {
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 1.5rem;
    line-height: 1;
    padding: 0.2rem 0.5rem;
  }

  .close:hover {
    background: rgba(127, 127, 127, 0.15);
    border-radius: 4px;
  }

  .meta-block {
    padding: 0.7rem 1rem;
    background: rgba(127, 127, 127, 0.05);
    border-bottom: 1px solid rgba(127, 127, 127, 0.2);
    font-size: 0.85rem;
  }

  .meta-block p {
    margin: 0.15rem 0;
  }

  .muted {
    opacity: 0.6;
    text-align: center;
    padding: 1rem;
  }

  .turns {
    list-style: none;
    padding: 0.5rem 1rem;
    margin: 0;
    overflow-y: auto;
    flex: 1;
  }

  .turn {
    margin-bottom: 0.7rem;
    padding-bottom: 0.7rem;
    border-bottom: 1px dashed rgba(127, 127, 127, 0.2);
  }

  .turn-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.3rem;
  }

  .turn-header strong {
    font-size: 0.85rem;
  }

  .turn-header .time {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.7rem;
    opacity: 0.5;
  }

  .message {
    margin: 0.3rem 0;
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
  }

  .message.user {
    background: rgba(76, 175, 80, 0.1);
    border-left: 2px solid rgba(76, 175, 80, 0.5);
  }

  .message.bot {
    background: rgba(33, 150, 243, 0.1);
    border-left: 2px solid rgba(33, 150, 243, 0.5);
  }

  .role {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    opacity: 0.6;
  }

  .message p {
    margin: 0.1rem 0 0;
    line-height: 1.4;
    font-size: 0.9rem;
    white-space: pre-wrap;
  }
</style>
