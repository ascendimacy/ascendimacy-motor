<script lang="ts">
  import type { WizardState } from "../../lib/wizard-types.js";

  export let state: WizardState;

  $: minutesPerSession = state.budget.sessionMinutesCap;
  $: sessionsPerDay = Math.max(
    1,
    Math.floor(
      state.budget.sacrificeBudgetCap /
        (state.budget.sessionMinutesCap * 2),
    ),
  );
</script>

<div class="step" data-testid="step-05">
  <p class="intro">
    Limites que protegem a criança do excesso. Valores se aplicam a todas as
    crianças cadastradas; ajustes finos por kid acontecem no console depois.
  </p>

  <label class="slider-row">
    <span class="label">Sacrifice budget cap diário</span>
    <input
      type="range"
      min="20"
      max="300"
      step="10"
      bind:value={state.budget.sacrificeBudgetCap}
      data-testid="budget-cap"
    />
    <span class="value">{state.budget.sacrificeBudgetCap}</span>
  </label>

  <label class="slider-row">
    <span class="label">Off-screen ratio (mínimo)</span>
    <input
      type="range"
      min="1"
      max="5"
      step="0.5"
      bind:value={state.budget.offScreenRatio}
      data-testid="offscreen-ratio"
    />
    <span class="value">{state.budget.offScreenRatio}:1</span>
  </label>

  <label class="slider-row">
    <span class="label">Tempo max por sessão (min)</span>
    <input
      type="range"
      min="5"
      max="60"
      step="1"
      bind:value={state.budget.sessionMinutesCap}
      data-testid="session-cap"
    />
    <span class="value">{state.budget.sessionMinutesCap}</span>
  </label>

  <section class="preview">
    <strong>Preview:</strong>
    Cada criança terá ~{sessionsPerDay} sessões/dia, cada ≤{minutesPerSession} minutos.
  </section>
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
  .slider-row {
    display: grid;
    grid-template-columns: 1fr 2fr auto;
    gap: 0.75rem;
    align-items: center;
    font-size: 0.85rem;
  }
  .label {
    opacity: 0.8;
  }
  .value {
    font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
    min-width: 3rem;
    text-align: right;
  }
  .preview {
    background: rgba(76, 175, 80, 0.08);
    border-left: 3px solid rgba(76, 175, 80, 0.5);
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
  }
</style>
