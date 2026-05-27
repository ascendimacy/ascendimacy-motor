<script lang="ts">
  import type { WizardState, Mc10Material } from "../../lib/wizard-types.js";

  export let state: WizardState;
  export let material: Mc10Material | null;
  export let loading: boolean;

  function markRead(): void {
    state.mc10ReadAt = new Date().toISOString();
    state = state;
  }
</script>

<div class="step" data-testid="step-01">
  <p class="intro">
    Antes de apresentar o Brota aos seus filhos, leia este material em ~1
    minuto. Cada bullet é uma ação memorizável — não precisa decorar.
  </p>

  {#if loading}
    <p class="muted">Carregando material...</p>
  {:else if material === null}
    <p class="muted">Material indisponível — verifique conexão BFF.</p>
  {:else}
    <section>
      <h3>Antes de apresentar</h3>
      <ul>
        {#each material.beforeBullets as bullet}
          <li>{bullet}</li>
        {/each}
      </ul>
    </section>

    <section>
      <h3>Durante a apresentação</h3>
      <ul>
        {#each material.duringBullets as bullet}
          <li>{bullet}</li>
        {/each}
      </ul>
      {#if material.jpPhrases.length > 0}
        <h4>Frases-chave JP sugeridas</h4>
        <ul class="jp-list">
          {#each material.jpPhrases as phrase}
            <li>
              <div class="jp">{phrase.jp}</div>
              <div class="muted">{phrase.pt}</div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h3>Depois</h3>
      <ul>
        {#each material.afterBullets as bullet}
          <li>{bullet}</li>
        {/each}
      </ul>
    </section>

    <section class="escalation">
      <strong>Escalation:</strong>
      {material.escalationPath}
    </section>
  {/if}

  <div class="confirm">
    <button
      type="button"
      class="btn-confirm"
      on:click={markRead}
      disabled={loading || material === null}
      data-testid="mc10-mark-read"
    >
      {state.mc10ReadAt !== null ? "✓ Li, entendi" : "Li, entendi"}
    </button>
    {#if state.mc10ReadAt !== null}
      <span class="muted ts">Confirmado em {state.mc10ReadAt}</span>
    {/if}
  </div>
</div>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  h3 {
    font-size: 0.95rem;
    margin: 0.5rem 0 0.25rem;
  }
  h4 {
    font-size: 0.85rem;
    margin: 0.5rem 0 0.25rem;
    opacity: 0.8;
  }
  ul {
    margin: 0;
    padding-left: 1.25rem;
  }
  li {
    margin: 0.25rem 0;
    line-height: 1.4;
  }
  .jp-list li {
    list-style: none;
    margin-bottom: 0.5rem;
  }
  .jp {
    font-size: 1rem;
  }
  .muted {
    opacity: 0.65;
    font-size: 0.85rem;
  }
  .escalation {
    background: rgba(255, 193, 7, 0.1);
    border-left: 3px solid rgba(255, 193, 7, 0.6);
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
  }
  .confirm {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }
  .btn-confirm {
    background: rgba(76, 175, 80, 0.25);
    border: 1px solid rgba(76, 175, 80, 0.6);
    border-radius: 4px;
    padding: 0.4rem 0.9rem;
    cursor: pointer;
    color: inherit;
    font-family: inherit;
    font-size: 0.9rem;
  }
  .btn-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ts {
    font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
    font-size: 0.75rem;
  }
</style>
