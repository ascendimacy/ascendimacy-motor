<script lang="ts">
  /**
   * S1 read — snapshot do learner pré-turn (mood, helix, journey, trust/budget).
   *
   * Lê pre_state do engineTrace v2 quando disponível; fallback minimal
   * pra turn fields top-level (trustLevel, budgetRemaining).
   */
  import type { ReplayTraceTurn } from "../../lib/api.js";
  import SectionShell from "./SectionShell.svelte";

  export let turn: ReplayTraceTurn;

  const COLOR = "#3b82f6";

  $: pre = (turn.engineTrace?.pre_state ?? {}) as Record<string, unknown>;
  $: journey = (pre["journey_state"] ?? null) as {
    stage?: string;
    discoveries_count?: number;
    families_covered?: string[];
  } | null;
  $: helix = (pre["helix_state"] ?? null) as {
    activeDimension?: string;
    activeLevel?: number;
    cycleDay?: number;
    progress?: number;
  } | null;
  $: trustLevel =
    typeof pre["trust_level"] === "number"
      ? (pre["trust_level"] as number)
      : turn.trustLevel;
  $: budgetRemaining =
    typeof pre["budget_remaining"] === "number"
      ? (pre["budget_remaining"] as number)
      : turn.budgetRemaining;
  $: cyclePhase =
    typeof pre["cycle_phase"] === "string"
      ? (pre["cycle_phase"] as string)
      : undefined;
  $: sessionPhase =
    typeof pre["current_session_phase"] === "string"
      ? (pre["current_session_phase"] as string)
      : undefined;

  $: hasAny =
    journey !== null ||
    helix !== null ||
    trustLevel !== undefined ||
    budgetRemaining !== undefined;

  $: badgeCount = [
    journey !== null,
    helix !== null,
    trustLevel !== undefined,
    budgetRemaining !== undefined,
  ].filter(Boolean).length;
</script>

<SectionShell id="S1" title="Aprendiz no turno" color={COLOR}>
  <span slot="meta">
    {#if badgeCount > 0}
      <span class="badge s1" data-testid="section-S1-count">{badgeCount} signals</span>
    {:else}
      <span class="badge muted">sem dado</span>
    {/if}
  </span>

  {#if !hasAny}
    <p class="empty">não houve snapshot pré-turn capturado (engineTrace v1 ou ausente)</p>
  {/if}

  {#if trustLevel !== undefined || budgetRemaining !== undefined || sessionPhase}
    <div class="row">
      {#if trustLevel !== undefined}
        <span class="kv"><strong>trust:</strong> <code>{trustLevel.toFixed(2)}</code></span>
      {/if}
      {#if budgetRemaining !== undefined}
        <span class="kv"><strong>budget:</strong> <code>{budgetRemaining}</code></span>
      {/if}
      {#if sessionPhase}
        <span class="kv"><strong>phase:</strong> <code>{sessionPhase}</code></span>
      {/if}
    </div>
  {/if}

  {#if journey}
    <div class="row">
      <strong>journey:</strong>
      <code>{journey.stage ?? "?"}</code>
      {#if journey.discoveries_count !== undefined}
        <span class="muted-row">· {journey.discoveries_count} discoveries</span>
      {/if}
      {#if journey.families_covered && journey.families_covered.length > 0}
        <span class="muted-row">· families: {journey.families_covered.join(", ")}</span>
      {/if}
    </div>
  {/if}

  {#if helix}
    <div class="row">
      <strong>helix:</strong>
      <code>{helix.activeDimension ?? "?"}</code>
      {#if helix.activeLevel !== undefined}
        <span class="muted-row">· level {helix.activeLevel}</span>
      {/if}
      {#if helix.cycleDay !== undefined}
        <span class="muted-row">· day {helix.cycleDay}</span>
      {/if}
      {#if helix.progress !== undefined}
        <span class="muted-row">· progress {(helix.progress * 100).toFixed(0)}%</span>
      {/if}
      {#if cyclePhase}
        <span class="muted-row">· phase {cyclePhase}</span>
      {/if}
    </div>
  {/if}
</SectionShell>

<style>
  .badge {
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .badge.s1 {
    background: rgba(59, 130, 246, 0.18);
    color: #1e40af;
  }
  .badge.muted {
    background: rgba(127, 127, 127, 0.18);
    color: inherit;
    opacity: 0.6;
    font-weight: 400;
  }
  .row {
    margin: 0.2rem 0;
    line-height: 1.5;
  }
  .kv {
    margin-right: 0.6rem;
  }
  .muted-row {
    opacity: 0.7;
    font-size: 0.75rem;
  }
  .empty {
    opacity: 0.6;
    font-style: italic;
    margin: 0.15rem 0;
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.78em;
    background: rgba(127, 127, 127, 0.15);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
