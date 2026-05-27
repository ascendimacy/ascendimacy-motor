<script lang="ts">
  import {
    chatBubbles,
    currentSessionId,
    globalError,
  } from "../lib/stores.js";
  import type { ApiClient } from "../lib/api.js";
  import type { ChatBubble } from "../lib/types.js";

  export let api: ApiClient;

  // --- Card session state ---
  let cardId = "tabuada-7";
  let from = "yuji";
  let cardBusy = false;

  // --- STS session state (ops#1156) ---
  const PERSONA_OPTIONS = ["ryo-ochiai", "kei-ochiai", "paula"];
  let stsPersonaId = PERSONA_OPTIONS[0]!;
  let stsCardId = "";
  let stsTurns = 6;
  let stsBusy = false;
  let stsLastPid: number | null = null;

  async function startCard(): Promise<void> {
    if (cardBusy) return;
    cardBusy = true;
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
      cardBusy = false;
    }
  }

  async function startSts(): Promise<void> {
    if (stsBusy) return;
    stsBusy = true;
    stsLastPid = null;
    globalError.set(null);
    try {
      const result = await api.startStsSession({
        personaId: stsPersonaId,
        ...(stsCardId.length > 0 ? { cardId: stsCardId } : {}),
        turns: stsTurns,
      });
      stsLastPid = result.pid;
      currentSessionId.set(result.sessionId);
    } catch (err) {
      globalError.set(
        `Falha ao iniciar STS: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      stsBusy = false;
    }
  }
</script>

<section class="session-start" data-testid="session-start">
  <!-- Card session (existente) -->
  <h3>Iniciar sessão de teste (carta)</h3>
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
      on:click={startCard}
      disabled={cardBusy || cardId.length === 0 || from.length === 0}
      data-testid="start-button"
    >
      {cardBusy ? "..." : "Iniciar"}
    </button>
  </div>

  <!-- STS session (ops#1156) -->
  <h3 class="sts-heading">Iniciar sessão STS</h3>
  <p class="help">
    Lança STS subprocess (<code>orchestrator/dist/cli.js run</code>).
    Requer <code>EBROTA_BFF_STS_ROOT</code> no BFF.
    V0 — sem gate por turn (follow-up).
    {#if stsLastPid !== null}
      <span class="pid">PID {stsLastPid}</span>
    {/if}
  </p>
  <div class="form">
    <label>
      <span>personaId</span>
      <select bind:value={stsPersonaId} data-testid="sts-persona-select">
        {#each PERSONA_OPTIONS as opt}
          <option value={opt}>{opt}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>cardId (opcional)</span>
      <input
        bind:value={stsCardId}
        type="text"
        placeholder="ex: tabuada-7"
        data-testid="sts-card-id-input"
      />
    </label>
    <label class="turns-label">
      <span>turns</span>
      <input
        bind:value={stsTurns}
        type="number"
        min="1"
        max="30"
        data-testid="sts-turns-input"
      />
    </label>
    <button
      type="button"
      on:click={startSts}
      disabled={stsBusy || stsPersonaId.length === 0}
      class="sts-btn"
      data-testid="start-sts-button"
    >
      {stsBusy ? "..." : "Iniciar STS"}
    </button>
  </div>
</section>

<style>
  .session-start {
    padding: 1rem;
    border-top: 1px solid rgba(127, 127, 127, 0.3);
    background: rgba(127, 127, 127, 0.04);
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  h3 {
    margin: 0 0 0.3rem;
    font-size: 0.9rem;
    opacity: 0.8;
  }

  .sts-heading {
    margin-top: 0.8rem;
    border-top: 1px solid rgba(127, 127, 127, 0.2);
    padding-top: 0.7rem;
  }

  .help {
    font-size: 0.8rem;
    opacity: 0.6;
    margin: 0 0 0.7rem;
  }

  .pid {
    display: inline-block;
    background: rgba(76, 175, 80, 0.2);
    border-radius: 3px;
    padding: 0 0.3rem;
    font-family: ui-monospace, monospace;
    font-size: 0.8em;
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

  .turns-label {
    max-width: 70px;
    flex: 0 0 70px;
  }

  label span {
    font-size: 0.75rem;
    opacity: 0.6;
    margin-bottom: 0.2rem;
  }

  input,
  select {
    padding: 0.3rem 0.5rem;
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 4px;
    background: rgba(127, 127, 127, 0.05);
    color: inherit;
    font-family: inherit;
    font-size: 0.9rem;
  }

  input:focus,
  select:focus {
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

  .sts-btn {
    border-color: rgba(156, 39, 176, 0.6);
    background: rgba(156, 39, 176, 0.12);
  }

  .sts-btn:hover:not(:disabled) {
    background: rgba(156, 39, 176, 0.25);
  }
</style>
