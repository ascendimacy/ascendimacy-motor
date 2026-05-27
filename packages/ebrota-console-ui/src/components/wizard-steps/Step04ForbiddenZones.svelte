<script lang="ts">
  import type {
    WizardState,
    WizardForbiddenZone,
  } from "../../lib/wizard-types.js";

  export let state: WizardState;

  let newTopic = "";

  function addZone(): void {
    const topic = newTopic.trim();
    if (topic.length === 0) return;
    const zone: WizardForbiddenZone = {
      topic,
      policy: "never",
      reason: "custom",
    };
    state.forbiddenZones = [...state.forbiddenZones, zone];
    newTopic = "";
    state = state;
  }

  function removeZone(idx: number): void {
    state.forbiddenZones = state.forbiddenZones.filter((_, i) => i !== idx);
    state = state;
  }

  function setPolicy(
    idx: number,
    policy: WizardForbiddenZone["policy"],
  ): void {
    state.forbiddenZones[idx].policy = policy;
    state.forbiddenZones = state.forbiddenZones;
    state = state;
  }
</script>

<div class="step" data-testid="step-04">
  <p class="intro">
    Assuntos que Brota deve evitar. Defaults seguros já estão marcados como
    "nunca abordar". Custom adicionados ficam abaixo.
  </p>

  <ul class="zones">
    {#each state.forbiddenZones as zone, idx (zone.topic)}
      <li class="zone">
        <span class="topic">{zone.topic}</span>
        <div class="policy-toggle">
          {#each ["never", "soft", "open"] as p}
            <button
              type="button"
              class="policy-btn"
              class:active={zone.policy === p}
              on:click={() =>
                setPolicy(idx, p)}
            >
              {p === "never"
                ? "Nunca"
                : p === "soft"
                  ? "Só se kid abordar"
                  : "OK"}
            </button>
          {/each}
        </div>
        <button
          type="button"
          class="btn-remove"
          on:click={() => removeZone(idx)}
          aria-label="Remover"
        >
          ×
        </button>
      </li>
    {/each}
  </ul>

  <div class="add-row">
    <input
      type="text"
      bind:value={newTopic}
      placeholder="Ex: discussão de divórcio"
      data-testid="new-zone-topic"
      on:keydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addZone();
        }
      }}
    />
    <button
      type="button"
      on:click={addZone}
      class="btn-add"
      data-testid="add-zone"
    >
      + Adicionar
    </button>
  </div>
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
  .zones {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .zone {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.5rem;
    align-items: center;
    padding: 0.4rem 0.6rem;
    background: rgba(127, 127, 127, 0.08);
    border-radius: 4px;
  }
  .topic {
    font-size: 0.9rem;
  }
  .policy-toggle {
    display: flex;
    gap: 0.2rem;
  }
  .policy-btn {
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
    background: rgba(127, 127, 127, 0.1);
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 3px;
    cursor: pointer;
    color: inherit;
    font-family: inherit;
  }
  .policy-btn.active {
    background: rgba(176, 0, 32, 0.2);
    border-color: rgba(176, 0, 32, 0.5);
  }
  .btn-remove {
    background: transparent;
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 3px;
    padding: 0.15rem 0.45rem;
    cursor: pointer;
    color: inherit;
  }
  .add-row {
    display: flex;
    gap: 0.5rem;
  }
  .add-row input {
    flex: 1;
    padding: 0.35rem 0.5rem;
    background: rgba(127, 127, 127, 0.1);
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 3px;
    font-family: inherit;
    color: inherit;
  }
  .btn-add {
    background: rgba(33, 150, 243, 0.2);
    border: 1px solid rgba(33, 150, 243, 0.5);
    border-radius: 3px;
    padding: 0.35rem 0.7rem;
    cursor: pointer;
    color: inherit;
    font-family: inherit;
    font-size: 0.85rem;
  }
</style>
