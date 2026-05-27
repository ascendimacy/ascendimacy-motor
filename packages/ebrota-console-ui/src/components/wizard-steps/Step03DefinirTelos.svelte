<script lang="ts">
  import {
    DEFAULT_TELOS_TAGS,
    type WizardState,
  } from "../../lib/wizard-types.js";

  export let state: WizardState;

  const MAX_LEN = 500;

  function toggleTag(tag: string): void {
    if (state.telos.tags.includes(tag)) {
      state.telos.tags = state.telos.tags.filter((t) => t !== tag);
    } else {
      state.telos.tags = [...state.telos.tags, tag];
    }
    state = state;
  }

  $: remaining = MAX_LEN - state.telos.text.length;
</script>

<div class="step" data-testid="step-03">
  <p class="intro">
    O que importa pra esta família? O motor vai favorecer atividades que
    refletem esses valores.
  </p>

  <label>
    <span>Texto livre (≤500 caracteres)</span>
    <textarea
      bind:value={state.telos.text}
      maxlength={MAX_LEN}
      rows="5"
      data-testid="telos-text"
      placeholder="Ex: queremos que nossos filhos cresçam bilíngues, com curiosidade ativa e respeito por anciãos."
    />
    <span class="counter" class:warn={remaining < 50}>
      {remaining} caracteres restantes
    </span>
  </label>

  <section>
    <h3>Tags estruturadas</h3>
    <div class="chips">
      {#each DEFAULT_TELOS_TAGS as tag}
        <button
          type="button"
          class="chip"
          class:active={state.telos.tags.includes(tag)}
          on:click={() => toggleTag(tag)}
          data-testid="telos-tag-{tag}"
        >
          {tag}
        </button>
      {/each}
    </div>
  </section>

  {#if state.telos.text.trim().length > 0 || state.telos.tags.length > 0}
    <section class="preview">
      <strong>Preview:</strong>
      Brota vai favorecer atividades alinhadas com
      {state.telos.tags.length > 0
        ? state.telos.tags.join(", ")
        : "esses valores"}.
    </section>
  {/if}
</div>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .intro {
    margin: 0;
    opacity: 0.8;
    font-size: 0.9rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
  }
  textarea {
    padding: 0.5rem;
    background: rgba(127, 127, 127, 0.1);
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 3px;
    font-family: inherit;
    color: inherit;
    resize: vertical;
  }
  .counter {
    opacity: 0.6;
    font-size: 0.75rem;
    align-self: flex-end;
  }
  .counter.warn {
    color: #ff9800;
  }
  h3 {
    font-size: 0.9rem;
    margin: 0 0 0.4rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip {
    padding: 0.25rem 0.65rem;
    border: 1px solid rgba(127, 127, 127, 0.4);
    background: rgba(127, 127, 127, 0.1);
    border-radius: 999px;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.8rem;
    color: inherit;
  }
  .chip.active {
    background: rgba(33, 150, 243, 0.25);
    border-color: rgba(33, 150, 243, 0.6);
  }
  .preview {
    background: rgba(76, 175, 80, 0.08);
    border-left: 3px solid rgba(76, 175, 80, 0.5);
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
  }
</style>
