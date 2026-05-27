<script lang="ts">
  /**
   * S4 — Motor de Expressão (panel, per turn).
   * Pergunta: "Como o motor falou esse turno e por quê?"
   *
   * v0: proposed text vs final (diff visual simples) + materializer
   * prompt collapsible + cache/fallback badges + link ApprovalGate
   * (gate aparece como overlay separado).
   */
  import {
    currentTurnSnapshot,
    llmXrayPanelOpen,
    llmXrayCalls,
  } from "../../lib/stores.js";
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";
  import type { TurnSnapshot } from "../../lib/types.js";

  export let turn: TurnSnapshot | null = null;
  const COLOR = "#f97316";

  $: snap = turn ?? $currentTurnSnapshot;

  let promptOpen = false;

  function openXray(): void {
    // S4 → role=motor-drota (constrained-materializer).
    llmXrayCalls.set([]);
    llmXrayPanelOpen.set(true);
  }
</script>

<SubsystemPanelShell id="S4" title="Motor de Expressão (per turn)" color={COLOR}>
  {#if snap === null}
    <p class="empty">Sem turno ativo. Inicie uma sessão ou abra um Replay.</p>
  {:else}
    <div class="turn-header">
      <span class="turn-badge">turn {snap.turn}</span>
      <span class="phase">phase: <code>{snap.lastPhase}</code></span>
    </div>

    <section class="block">
      <h3>Proposed vs Final</h3>
      <div class="diff">
        <div class="diff-side proposed">
          <header>proposed (raw LLM)</header>
          <p>{snap.proposedText ?? "—"}</p>
        </div>
        <div class="diff-side final">
          <header>final (post-sanitize)</header>
          <p class="muted">
            sanitização aplicada em S5.a guardrail — diff visível no MotorView
            quando trace v2 expandido.
          </p>
        </div>
      </div>
    </section>

    <section class="block">
      <h3>Materializer prompt</h3>
      <button
        type="button"
        class="collapse-btn"
        on:click={() => (promptOpen = !promptOpen)}
      >
        {promptOpen ? "▼" : "▶"} ver prompt completo
      </button>
      {#if promptOpen}
        <pre class="prompt">
prompt completo — disponível via X-ray (call role=motor-drota,
operation=constrained-materializer) quando turno é replay.
        </pre>
      {/if}
    </section>

    <section class="block badges-block">
      <h3>Badges</h3>
      <div class="badges">
        <span class="badge cache" title="STABLE_MATERIALIZER_PREFIX cache">
          cache: <code>hit?/miss?</code> · ver X-ray
        </span>
        <span
          class="badge instruction"
          class:on={snap.instructionAdditionApplied === true}
        >
          instruction_addition: {snap.instructionAdditionApplied === true ? "✓" : "—"}
        </span>
        <span class="badge fallback" title="Speaker fallback (parse error → contentPool[0])">
          speaker fallback: <code>—</code> · ver X-ray
        </span>
      </div>
    </section>

    <section class="block">
      <h3>ApprovalGate</h3>
      <p class="hint">
        Gate semi-auto aparece como overlay separado (no-op aqui). Aprovar /
        editar / rejeitar ocorre no <code>ApprovalGate</code> modal global.
      </p>
    </section>
  {/if}

  <div class="actions">
    <button
      type="button"
      class="xray"
      on:click={openXray}
      data-testid="s4-xray-btn"
    >
      🔬 X-ray (motor-drota)
    </button>
  </div>
</SubsystemPanelShell>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  h3 {
    margin: 0 0 0.3rem 0;
    font-size: 0.95rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
    padding-bottom: 0.2rem;
  }
  .empty {
    opacity: 0.6;
    font-size: 0.9rem;
    text-align: center;
    padding: 2rem 0;
  }
  .turn-header {
    display: flex;
    gap: 0.8rem;
    align-items: center;
    font-size: 0.85rem;
  }
  .turn-badge {
    background: rgba(249, 115, 22, 0.2);
    color: #f97316;
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-weight: 600;
  }
  .phase {
    opacity: 0.8;
  }
  .diff {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .diff-side {
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 4px;
    padding: 0.5rem 0.6rem;
  }
  .diff-side header {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
    margin-bottom: 0.3rem;
  }
  .diff-side p {
    margin: 0;
    font-size: 0.85rem;
  }
  .diff-side.proposed {
    border-left: 3px solid #f97316;
  }
  .diff-side.final {
    border-left: 3px solid #10b981;
  }
  .collapse-btn {
    align-self: flex-start;
    background: transparent;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 4px;
    padding: 0.25rem 0.6rem;
    font: inherit;
    font-size: 0.8rem;
    color: inherit;
    cursor: pointer;
  }
  .prompt {
    margin: 0;
    padding: 0.6rem;
    background: rgba(127, 127, 127, 0.12);
    border-radius: 4px;
    font-size: 0.78rem;
    white-space: pre-wrap;
  }
  .badges-block .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .badge {
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    border-radius: 3px;
    border: 1px solid rgba(127, 127, 127, 0.4);
  }
  .badge.instruction.on {
    border-color: rgba(16, 185, 129, 0.7);
    color: #10b981;
  }
  .hint {
    font-size: 0.85rem;
    opacity: 0.85;
    margin: 0;
  }
  .muted {
    opacity: 0.6;
    margin: 0;
    font-size: 0.85rem;
  }
  .actions {
    margin-top: auto;
    display: flex;
    justify-content: flex-end;
  }
  .xray {
    background: transparent;
    border: 1px solid rgba(249, 115, 22, 0.6);
    border-radius: 4px;
    padding: 0.4rem 0.8rem;
    font: inherit;
    font-size: 0.85rem;
    color: inherit;
    cursor: pointer;
  }
  .xray:hover {
    background: rgba(249, 115, 22, 0.12);
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.82em;
    background: rgba(127, 127, 127, 0.18);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
