<script lang="ts">
  import type { WizardState, WizardChild } from "../../lib/wizard-types.js";

  export let state: WizardState;

  function addChild(): void {
    const newChild: WizardChild = {
      id: `child-${state.family.children.length + 1}-${Date.now()}`,
      name: "",
      age: 0,
      primaryLanguage: "pt",
    };
    state.family.children = [...state.family.children, newChild];
    state = state;
  }

  function removeChild(id: string): void {
    state.family.children = state.family.children.filter((c) => c.id !== id);
    state = state;
  }

  function toggleCoParent(): void {
    if (state.family.coParent === null) {
      state.family.coParent = {
        name: "",
        relation: "co-parent",
        permissions: "full",
      };
    } else {
      state.family.coParent = null;
    }
    state = state;
  }
</script>

<div class="step" data-testid="step-02">
  <section>
    <h3>Adquirente (responsável principal)</h3>
    <label>
      <span>Nome</span>
      <input
        type="text"
        bind:value={state.family.acquirer.name}
        data-testid="acquirer-name"
        placeholder="Yuji"
      />
    </label>
    <label>
      <span>Relação</span>
      <input
        type="text"
        bind:value={state.family.acquirer.relation}
        placeholder="pai"
      />
    </label>
  </section>

  <section>
    <h3>Co-parental</h3>
    <button
      type="button"
      class="btn-small"
      on:click={toggleCoParent}
      data-testid="toggle-coparent"
    >
      {state.family.coParent === null
        ? "+ Adicionar co-parental"
        : "Remover co-parental"}
    </button>
    {#if state.family.coParent !== null}
      <label>
        <span>Nome</span>
        <input
          type="text"
          bind:value={state.family.coParent.name}
          placeholder="Yuko"
        />
      </label>
      <label>
        <span>Relação</span>
        <input
          type="text"
          bind:value={state.family.coParent.relation}
          placeholder="mãe"
        />
      </label>
      <label>
        <span>Permissões</span>
        <select bind:value={state.family.coParent.permissions}>
          <option value="full">Acesso total</option>
          <option value="view-only">Apenas visualização</option>
        </select>
      </label>
    {/if}
  </section>

  <section>
    <h3>Crianças</h3>
    {#each state.family.children as child (child.id)}
      <div class="child-row">
        <input
          type="text"
          bind:value={child.name}
          placeholder="Nome"
          data-testid="child-name"
        />
        <input
          type="number"
          bind:value={child.age}
          min="1"
          max="18"
          placeholder="Idade"
          data-testid="child-age"
        />
        <select bind:value={child.primaryLanguage}>
          <option value="pt">PT</option>
          <option value="jp">JP</option>
          <option value="en">EN</option>
        </select>
        <button
          type="button"
          class="btn-remove"
          on:click={() => removeChild(child.id)}
          aria-label="Remover criança"
        >
          ×
        </button>
      </div>
    {/each}
    <button
      type="button"
      class="btn-small"
      on:click={addChild}
      data-testid="add-child"
    >
      + Adicionar criança
    </button>
  </section>
</div>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  h3 {
    font-size: 0.95rem;
    margin: 0;
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
  input,
  select {
    padding: 0.35rem 0.5rem;
    background: rgba(127, 127, 127, 0.1);
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 3px;
    font-family: inherit;
    color: inherit;
  }
  .child-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr auto;
    gap: 0.5rem;
    align-items: center;
  }
  .btn-small,
  .btn-remove {
    background: rgba(127, 127, 127, 0.15);
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 4px;
    padding: 0.3rem 0.6rem;
    cursor: pointer;
    color: inherit;
    font-family: inherit;
    font-size: 0.85rem;
    align-self: flex-start;
  }
  .btn-remove {
    padding: 0.2rem 0.5rem;
  }
</style>
