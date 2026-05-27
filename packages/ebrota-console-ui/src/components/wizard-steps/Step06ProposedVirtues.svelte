<script lang="ts">
  import {
    CARDINAL_AXES,
    type WizardState,
    type WizardChild,
  } from "../../lib/wizard-types.js";

  export let state: WizardState;

  function getRecommendedAxes(child: WizardChild): number[] {
    if (child.age <= 5) return [4, 5]; // temperança + curiosidade
    if (child.age <= 9) return [1, 11, 5]; // justiça + criatividade + curiosidade
    return [1, 8, 9]; // justiça + autonomia + disciplina
  }

  function toggleAxis(childId: string, axis: number): void {
    const list = state.virtuesByChild[childId] ?? [];
    const exists = list.some((v) => v.axis === axis);
    if (exists) {
      state.virtuesByChild[childId] = list.filter((v) => v.axis !== axis);
    } else {
      state.virtuesByChild[childId] = [...list, { axis }];
    }
    state.virtuesByChild = state.virtuesByChild;
    state = state;
  }

  function isActive(childId: string, axis: number): boolean {
    return (state.virtuesByChild[childId] ?? []).some((v) => v.axis === axis);
  }

  function applyRecommended(child: WizardChild): void {
    const recommended = getRecommendedAxes(child);
    state.virtuesByChild[child.id] = recommended.map((axis) => ({ axis }));
    state.virtuesByChild = state.virtuesByChild;
    state = state;
  }
</script>

<div class="step" data-testid="step-06">
  <p class="intro">
    Eixos cardeais que esta família escolhe cultivar agora. Aceita a
    recomendação por idade ou customize. Pelo menos 1 eixo por criança é
    obrigatório.
  </p>

  {#if state.family.children.length === 0}
    <p class="muted">
      Nenhuma criança cadastrada — volte ao passo 2.
    </p>
  {/if}

  {#each state.family.children as child (child.id)}
    <section class="child-section">
      <header class="child-header">
        <h3>{child.name} ({child.age}a)</h3>
        <button
          type="button"
          class="btn-small"
          on:click={() => applyRecommended(child)}
          data-testid="apply-recommended-{child.id}"
        >
          Usar recomendação por idade
        </button>
      </header>
      <div class="grid">
        {#each CARDINAL_AXES as axis}
          <button
            type="button"
            class="axis-btn"
            class:active={isActive(child.id, axis.id)}
            on:click={() => toggleAxis(child.id, axis.id)}
            data-testid="axis-{child.id}-{axis.id}"
          >
            <span class="axis-id">{axis.id}</span>
            <span class="axis-label">{axis.label}</span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
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
  .child-section {
    border: 1px solid rgba(127, 127, 127, 0.2);
    border-radius: 5px;
    padding: 0.75rem;
  }
  .child-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .child-header h3 {
    font-size: 0.95rem;
    margin: 0;
  }
  .btn-small {
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    cursor: pointer;
    color: inherit;
    font-family: inherit;
    background: rgba(33, 150, 243, 0.15);
    border: 1px solid rgba(33, 150, 243, 0.4);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.4rem;
  }
  .axis-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.4rem;
    background: rgba(127, 127, 127, 0.08);
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 4px;
    cursor: pointer;
    color: inherit;
    font-family: inherit;
  }
  .axis-btn.active {
    background: rgba(76, 175, 80, 0.2);
    border-color: rgba(76, 175, 80, 0.6);
  }
  .axis-id {
    font-size: 0.7rem;
    opacity: 0.6;
  }
  .axis-label {
    font-size: 0.85rem;
  }
  @media (max-width: 600px) {
    .grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
