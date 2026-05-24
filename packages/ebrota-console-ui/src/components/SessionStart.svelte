<script lang="ts">
  import {
    chatBubbles,
    currentSessionId,
    globalError,
  } from "../lib/stores.js";
  import type { ApiClient } from "../lib/api.js";
  import type { ChatBubble } from "../lib/types.js";

  export let api: ApiClient;

  let cardId = "tabuada-7";
  let from = "yuji";
  let busy = false;

  async function start(): Promise<void> {
    if (busy) return;
    busy = true;
    globalError.set(null);
    try {
      const conversationId = `${from}-${Date.now()}`;
      const result = await api.startCardSession({
        cardId,
        conversationId,
        from,
        pkg: {
          cardId,
          raw: `# ${cardId}\n\n(pacote mock pra dev — PR3)`,
          sourcePath: "dev-mock",
        },
      });
      currentSessionId.set(result.sessionId);
      const now = new Date().toISOString();
      const userBubble: ChatBubble = {
        id: `${result.sessionId}-user`,
        role: "user",
        text: `card:${cardId}`,
        timestamp: now,
      };
      const botBubble: ChatBubble = {
        id: `${result.sessionId}-bot`,
        role: "bot",
        text: result.text,
        timestamp: now,
      };
      chatBubbles.update((bs) => [...bs, userBubble, botBubble]);
    } catch (err) {
      globalError.set(
        `Falha ao iniciar sessão: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      busy = false;
    }
  }
</script>

<section class="session-start" data-testid="session-start">
  <h3>Iniciar sessão de teste</h3>
  <p class="help">
    Dev utility — dispara <code>startCardSession</code> contra o BFF
    (default mock daemon). Em produção, sessões aterrissam via
    motor-channels detector <code>^card:&lt;id&gt;$</code>.
  </p>
  <div class="form">
    <label>
      <span>cardId</span>
      <input bind:value={cardId} type="text" data-testid="card-id-input" />
    </label>
    <label>
      <span>from</span>
      <input bind:value={from} type="text" data-testid="from-input" />
    </label>
    <button
      type="button"
      on:click={start}
      disabled={busy || cardId.length === 0 || from.length === 0}
      data-testid="start-button"
    >
      {busy ? "..." : "Iniciar"}
    </button>
  </div>
</section>

<style>
  .session-start {
    padding: 1rem;
    border-top: 1px solid rgba(127, 127, 127, 0.3);
    background: rgba(127, 127, 127, 0.04);
  }

  h3 {
    margin: 0 0 0.3rem;
    font-size: 0.9rem;
    opacity: 0.8;
  }

  .help {
    font-size: 0.8rem;
    opacity: 0.6;
    margin: 0 0 0.7rem;
  }

  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.85em;
    background: rgba(127, 127, 127, 0.2);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }

  .form {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }

  label {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 100px;
  }

  label span {
    font-size: 0.75rem;
    opacity: 0.6;
    margin-bottom: 0.2rem;
  }

  input {
    padding: 0.3rem 0.5rem;
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 4px;
    background: rgba(127, 127, 127, 0.05);
    color: inherit;
    font-family: inherit;
    font-size: 0.9rem;
  }

  input:focus {
    outline: 2px solid rgba(33, 150, 243, 0.5);
    outline-offset: -1px;
  }

  button {
    padding: 0.4rem 1rem;
    border: 1px solid rgba(33, 150, 243, 0.6);
    border-radius: 4px;
    background: rgba(33, 150, 243, 0.15);
    color: inherit;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.9rem;
  }

  button:hover:not(:disabled) {
    background: rgba(33, 150, 243, 0.3);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
