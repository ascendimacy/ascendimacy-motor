<script lang="ts">
  /**
   * S3 — Motor de Decisão (panel, per turn).
   * Pergunta: "Por que o motor escolheu esse movimento no turno N?"
   *
   * v0: lê `currentTurnSnapshot` store (live SSE); X-ray button abre
   * LlmXrayPanel (calls vêm do Replay turn detail — vazio quando live).
   *
   * Placeholders pra Strategist/Tactician (specs em rascunho).
   */
  import {
    currentTurnSnapshot,
    llmXrayPanelOpen,
    llmXrayCalls,
  } from "../../lib/stores.js";
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";
  import PlaceholderBanner from "./PlaceholderBanner.svelte";
  import type { TurnSnapshot } from "../../lib/types.js";

  export let turn: TurnSnapshot | null = null;
  const COLOR = "#eab308";

  $: snap = turn ?? $currentTurnSnapshot;

  function openXray(): void {
    // S3 → role=planejador + motor-drota (unified-assessor). v0 sem
    // filtro porque calls são populados via Replay turn detail.
    llmXrayCalls.set([]);
    llmXrayPanelOpen.set(true);
  }

  function moodLabel(): string {
    if (snap === null || snap.contextHints === undefined) return "—";
    const m = snap.contextHints["mood"];
    return typeof m === "string" || typeof m === "number" ? String(m) : "—";
  }
</script>

<SubsystemPanelShell id="S3" title="Motor de Decisão (per turn)" color={COLOR}>
  {#if snap === null}
    <p class="empty">Sem turno ativo. Inicie uma sessão ou abra um Replay.</p>
  {:else}
    <div class="turn-header">
      <span class="turn-badge">turn {snap.turn}</span>
      <span class="phase">phase: <code>{snap.lastPhase}</code></span>
    </div>

    <section class="block">
      <h3>Unified Assessor</h3>
      <div class="kv">
        <span class="k">mood</span><span class="v">{moodLabel()}</span>
      </div>
      <p class="hint">signals chips — visível no MotorView quando trace v2 expandido.</p>
    </section>

    <section class="block">
      <h3>Planejador</h3>
      <div class="kv">
        <span class="k">contentPool</span>
        <span class="v">{snap.contentPoolSize ?? 0} items</span>
      </div>
      <div class="kv">
        <span class="k">strategicRationale</span>
        <span class="v rationale">{snap.strategicRationale ?? "—"}</span>
      </div>
      <div class="kv">
        <span class="k">transitionEvaluations</span>
        <span class="v">{snap.transitionEvaluationsCount ?? 0}</span>
      </div>
    </section>

    <section class="block">
      <h3>Pragmatic Selector</h3>
      <div class="kv">
        <span class="k">selected</span>
        <span class="v"><code>{snap.selectedContentId ?? "—"}</code></span>
      </div>
      <div class="kv">
        <span class="k">score</span>
        <span class="v">{snap.selectedContentScore?.toFixed(3) ?? "—"}</span>
      </div>
      <div class="kv">
        <span class="k">rationale</span>
        <span class="v rationale">{snap.selectionRationale ?? "—"}</span>
      </div>
    </section>

    <section class="block">
      <h3>Critical</h3>
      <p class="hint">
        Badge <code>is_critical</code> aparece via MotorView quando trace v2
        expandido (TV2-7).
      </p>
    </section>

    <section class="block">
      <h3>Strategist (applied_double_helix)</h3>
      <PlaceholderBanner
        label="StrategyPlan card — só renderiza quando journey=applied_double_helix"
        specPath="docs/specs/2026-05-24-strategist-applied-double-helix.md"
        color={COLOR}
      />
    </section>

    <section class="block">
      <h3>Tactician (USE_SPLIT_DROTA)</h3>
      <PlaceholderBanner
        label="TacticDecision card — só renderiza quando USE_SPLIT_DROTA=true"
        specPath="docs/specs/2026-05-26-s4-split-tactician-speaker-v0.md"
        color={COLOR}
      />
    </section>
  {/if}

  <div class="actions">
    <button
      type="button"
      class="xray"
      on:click={openXray}
      data-testid="s3-xray-btn"
    >
      🔬 X-ray (planejador)
    </button>
  </div>
</SubsystemPanelShell>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
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
    background: rgba(234, 179, 8, 0.2);
    color: #eab308;
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-weight: 600;
  }
  .phase {
    opacity: 0.8;
  }
  .kv {
    display: grid;
    grid-template-columns: 11rem 1fr;
    gap: 0.5rem;
    font-size: 0.85rem;
  }
  .k {
    opacity: 0.7;
    font-weight: 500;
  }
  .v {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.82rem;
  }
  .rationale {
    font-family: inherit;
    font-size: 0.85rem;
  }
  .hint {
    font-size: 0.82rem;
    opacity: 0.75;
    margin: 0;
  }
  .actions {
    margin-top: auto;
    display: flex;
    justify-content: flex-end;
  }
  .xray {
    background: transparent;
    border: 1px solid rgba(234, 179, 8, 0.6);
    border-radius: 4px;
    padding: 0.4rem 0.8rem;
    font: inherit;
    font-size: 0.85rem;
    color: inherit;
    cursor: pointer;
  }
  .xray:hover {
    background: rgba(234, 179, 8, 0.12);
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.82em;
    background: rgba(127, 127, 127, 0.18);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
