<script lang="ts">
  import type { WizardState } from "../../lib/wizard-types.js";

  export let state: WizardState;

  $: hasMultipleChildren = state.family.children.length > 1;

  function togglePair(childId: string): void {
    if (!state.dyad) {
      state.dyad = {
        pairChildIds: [childId],
        playbookId: "kids.group.playbook",
        includeYoungest: false,
      };
    } else if (state.dyad.pairChildIds.includes(childId)) {
      state.dyad.pairChildIds = state.dyad.pairChildIds.filter(
        (id) => id !== childId,
      );
      if (state.dyad.pairChildIds.length === 0) {
        state.dyad = null;
      }
    } else {
      state.dyad.pairChildIds = [...state.dyad.pairChildIds, childId];
    }
    state = state;
  }

  function isPaired(childId: string): boolean {
    return state.dyad?.pairChildIds.includes(childId) ?? false;
  }
</script>

<div class="step" data-testid="step-09">
  {#if !hasMultipleChildren}
    <p class="muted">
      Apenas uma criança cadastrada — dyad não aplicável. Avance para o
      próximo passo.
    </p>
  {:else}
    <p class="intro">
      Configure dyad (par cooperativo) entre crianças. Brota pode rodar
      sessões conjuntas com playbook específico.
    </p>

    <section>
      <h3>Selecione o par</h3>
      <div class="children-list">
        {#each state.family.children as child (child.id)}
          <button
            type="button"
            class="child-pill"
            class:active={isPaired(child.id)}
            on:click={() => togglePair(child.id)}
            data-testid="dyad-toggle-{child.id}"
          >
            {child.name} ({child.age}a)
          </button>
        {/each}
      </div>
    </section>

    {#if state.dyad !== null && state.dyad.pairChildIds.length >= 2}
      <section>
        <label>
          <span>Playbook ativo</span>
          <input
            type="text"
            bind:value={state.dyad.playbookId}
            data-testid="dyad-playbook"
          />
        </label>
      </section>

      <section class="preview">
        <strong>Preview:</strong>
        Bloco 6 (jogada cooperativa) ativado para o par selecionado.
      </section>
    {/if}
  {/if}
</div>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .intro,
  .muted {
    margin: 0;
    opacity: 0.8;
    font-size: 0.9rem;
  }
  h3 {
    font-size: 0.9rem;
    margin: 0 0 0.4rem;
  }
  .children-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .child-pill {
    padding: 0.35rem 0.7rem;
    border-radius: 999px;
    border: 1px solid rgba(127, 127, 127, 0.4);
    background: rgba(127, 127, 127, 0.1);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.85rem;
    color: inherit;
  }
  .child-pill.active {
    background: rgba(33, 150, 243, 0.25);
    border-color: rgba(33, 150, 243, 0.6);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  label span {
    opacity: 0.7;
  }
  input {
    padding: 0.35rem 0.5rem;
    background: rgba(127, 127, 127, 0.1);
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 3px;
    font-family: inherit;
    color: inherit;
  }
  .preview {
    background: rgba(76, 175, 80, 0.08);
    border-left: 3px solid rgba(76, 175, 80, 0.5);
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
  }
</style>
