<script lang="ts">
  import type { WizardState } from "../../lib/wizard-types.js";

  export let state: WizardState;

  $: checklist = [
    {
      label: `Família — ${state.family.children.length} criança(s)`,
      done: state.family.children.length > 0,
    },
    {
      label: `Telos — ${state.telos.tags.length} tags`,
      done: state.telos.text.trim().length > 0,
    },
    {
      label: `Forbidden zones — ${state.forbiddenZones.length}`,
      done: true,
    },
    {
      label: "Budget constraints",
      done: true,
    },
    {
      label: "Virtudes propostas",
      done: state.family.children.every(
        (c) => (state.virtuesByChild[c.id]?.length ?? 0) > 0,
      ),
    },
    {
      label: "Janelas temporais",
      done: true,
    },
    {
      label: "Consent ledger",
      done:
        state.consents.storeTrace &&
        state.consents.emitPhysicalCards &&
        state.consents.activeHoursMessaging &&
        state.consents.confirmIsAi,
    },
    {
      label: state.dyad === null
        ? "Dyad — não aplicável"
        : `Dyad — ${state.dyad.pairChildIds.length} crianças`,
      done: true,
    },
    {
      label: `MC1 aprovadas — ${state.mc1Approvals.filter((a) => a.approved).length}/${state.family.children.length}`,
      done:
        state.family.children.length > 0 &&
        state.family.children.every((c) =>
          state.mc1Approvals.some(
            (a) => a.childId === c.id && a.approved,
          ),
        ),
    },
  ];

  $: eta = "primeira mensagem agendada para próxima janela livre";
</script>

<div class="step" data-testid="step-11">
  <h3>Resumo final</h3>

  <ul class="checklist">
    {#each checklist as item}
      <li class:done={item.done}>
        <span class="check">{item.done ? "✓" : "○"}</span>
        {item.label}
      </li>
    {/each}
  </ul>

  {#if state.readyForPilot}
    <div class="ready-banner" data-testid="ready-banner">
      🌳 Família pronta! Brota foi notificado. {eta}.
    </div>
  {:else}
    <p class="hint">
      Clique em <strong>Iniciar piloto</strong> para criar o evento
      <code>persona_ready_for_pilot</code> e notificar Jun.
    </p>
  {/if}
</div>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  h3 {
    font-size: 1rem;
    margin: 0;
  }
  .checklist {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .checklist li {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.9rem;
    opacity: 0.6;
  }
  .checklist li.done {
    opacity: 1;
  }
  .check {
    font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
    color: #4caf50;
    width: 1rem;
    text-align: center;
  }
  .hint {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.75;
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
    background: rgba(127, 127, 127, 0.15);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    font-size: 0.85em;
  }
  .ready-banner {
    background: rgba(76, 175, 80, 0.15);
    border: 1px solid rgba(76, 175, 80, 0.5);
    border-radius: 5px;
    padding: 0.75rem 1rem;
    font-size: 0.95rem;
    color: #2e7d32;
  }
</style>
