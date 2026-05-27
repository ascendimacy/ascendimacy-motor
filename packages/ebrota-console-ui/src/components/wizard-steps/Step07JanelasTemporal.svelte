<script lang="ts">
  import type {
    WizardState,
    DayKey,
    WindowZone,
  } from "../../lib/wizard-types.js";

  export let state: WizardState;

  const DAYS: ReadonlyArray<{ key: DayKey; label: string }> = [
    { key: "mon", label: "Seg" },
    { key: "tue", label: "Ter" },
    { key: "wed", label: "Qua" },
    { key: "thu", label: "Qui" },
    { key: "fri", label: "Sex" },
    { key: "sat", label: "Sáb" },
    { key: "sun", label: "Dom" },
  ];

  const ZONES: ReadonlyArray<{
    key: WindowZone;
    label: string;
    color: string;
  }> = [
    { key: "school", label: "Escola", color: "#9e9e9e" },
    { key: "sleep", label: "Sono", color: "#3f51b5" },
    { key: "window1", label: "Pós-escola", color: "#4caf50" },
    { key: "window2", label: "Noite", color: "#ff9800" },
    { key: "free", label: "Livre", color: "#03a9f4" },
  ];

  let selectedZone: WindowZone = "window1";

  function setCell(childId: string, day: DayKey): void {
    if (!state.windowsByChild[childId]) {
      state.windowsByChild[childId] = {};
    }
    state.windowsByChild[childId][day] = selectedZone;
    state.windowsByChild = state.windowsByChild;
    state = state;
  }

  function getCellColor(childId: string, day: DayKey): string {
    const zone = state.windowsByChild[childId]?.[day];
    if (!zone) return "transparent";
    return ZONES.find((z) => z.key === zone)?.color ?? "transparent";
  }

  function getCellLabel(childId: string, day: DayKey): string {
    const zone = state.windowsByChild[childId]?.[day];
    if (!zone) return "—";
    return ZONES.find((z) => z.key === zone)?.label ?? "—";
  }
</script>

<div class="step" data-testid="step-07">
  <p class="intro">
    Marque zones temporais por criança. Clique numa célula pra aplicar a zone
    selecionada. Brota só envia mensagens em janelas <strong>livre</strong> ou
    <strong>pós-escola/noite</strong>.
  </p>

  <div class="zone-palette">
    {#each ZONES as zone}
      <button
        type="button"
        class="zone-swatch"
        class:active={selectedZone === zone.key}
        style="--swatch-color: {zone.color}"
        on:click={() => (selectedZone = zone.key)}
      >
        {zone.label}
      </button>
    {/each}
  </div>

  {#each state.family.children as child (child.id)}
    <section class="child-cal">
      <h3>{child.name}</h3>
      <div class="grid">
        {#each DAYS as day}
          <div class="day-col">
            <div class="day-label">{day.label}</div>
            <button
              type="button"
              class="cell"
              style="background: {getCellColor(child.id, day.key)}"
              on:click={() => setCell(child.id, day.key)}
              data-testid="cell-{child.id}-{day.key}"
            >
              {getCellLabel(child.id, day.key)}
            </button>
          </div>
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
  .intro {
    margin: 0;
    opacity: 0.8;
    font-size: 0.9rem;
  }
  .zone-palette {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .zone-swatch {
    padding: 0.3rem 0.7rem;
    border-radius: 4px;
    border: 2px solid transparent;
    cursor: pointer;
    background: var(--swatch-color);
    color: white;
    font-family: inherit;
    font-size: 0.8rem;
  }
  .zone-swatch.active {
    border-color: white;
    box-shadow: 0 0 0 2px var(--swatch-color);
  }
  .child-cal h3 {
    font-size: 0.95rem;
    margin: 0 0 0.4rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 0.25rem;
  }
  .day-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
  }
  .day-label {
    font-size: 0.7rem;
    opacity: 0.6;
  }
  .cell {
    width: 100%;
    aspect-ratio: 1;
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    color: white;
    font-size: 0.7rem;
    text-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
  }
</style>
