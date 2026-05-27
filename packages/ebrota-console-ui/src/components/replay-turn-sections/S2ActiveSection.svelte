<script lang="ts">
  /**
   * S2 active — doutrina ativa no turno: journey stage, playbookId, jogada usada.
   */
  import type { ReplayTraceTurn } from "../../lib/api.js";
  import SectionShell from "./SectionShell.svelte";

  export let turn: ReplayTraceTurn;

  const COLOR = "#10b981";

  $: pre = (turn.engineTrace?.pre_state ?? {}) as Record<string, unknown>;
  $: post = (turn.engineTrace?.post_state ?? {}) as Record<string, unknown>;
  $: journeyPre = (pre["journey_state"] ?? null) as { stage?: string } | null;
  $: journeyPost = (post["journey_state"] ?? null) as { stage?: string } | null;

  $: tacticDecision = turn.engineTrace?.tactic_decision;
  $: tactician = turn.engineTrace?.components?.tactician;
  $: jogada =
    tacticDecision?.jogada ??
    tactician?.outputs?.jogada ??
    undefined;
  $: angle = tacticDecision?.angle ?? tactician?.outputs?.angle;
  $: targetAxis = tacticDecision?.target_axis;
  $: register = tacticDecision?.constraints?.register;

  $: stageTransition = turn.engineTrace?.state_diff?.journey_stage_transition;

  $: hasAny =
    turn.playbookId !== undefined ||
    jogada !== undefined ||
    journeyPre !== null ||
    journeyPost !== null;
</script>

<SectionShell id="S2" title="Doutrina ativa" color={COLOR}>
  <span slot="meta">
    {#if jogada}
      <span class="badge s2" data-testid="section-S2-jogada">{jogada}</span>
    {/if}
    {#if turn.playbookId}
      <span class="badge mono">{turn.playbookId}</span>
    {/if}
    {#if !hasAny}
      <span class="badge muted">sem dado</span>
    {/if}
  </span>

  {#if !hasAny}
    <p class="empty">não houve doutrina capturada (turn legacy ou parental_triage route)</p>
  {/if}

  {#if turn.playbookId}
    <div class="row">
      <strong>playbook:</strong> <code>{turn.playbookId}</code>
    </div>
  {/if}

  {#if stageTransition}
    <div class="row">
      <strong>journey:</strong>
      <code>{stageTransition.from}</code> →
      <code>{stageTransition.to}</code>
      {#if stageTransition.trigger}
        <span class="muted-row">(trigger: {stageTransition.trigger})</span>
      {/if}
    </div>
  {:else if journeyPre?.stage}
    <div class="row">
      <strong>journey:</strong> <code>{journeyPre.stage}</code>
      <span class="muted-row">(estável neste turno)</span>
    </div>
  {/if}

  {#if jogada}
    <div class="row">
      <strong>jogada:</strong> <code>{jogada}</code>
      {#if targetAxis}<span class="muted-row">· axis: <code>{targetAxis}</code></span>{/if}
      {#if register}<span class="muted-row">· register: <code>{register}</code></span>{/if}
    </div>
    {#if angle}
      <div class="row">
        <strong>angle:</strong> <em>{angle}</em>
      </div>
    {/if}
  {/if}
</SectionShell>

<style>
  .badge {
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .badge.s2 {
    background: rgba(16, 185, 129, 0.18);
    color: #047857;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .badge.mono {
    background: rgba(127, 127, 127, 0.18);
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-weight: 400;
  }
  .badge.muted {
    background: rgba(127, 127, 127, 0.18);
    opacity: 0.6;
    font-weight: 400;
  }
  .row {
    margin: 0.2rem 0;
    line-height: 1.5;
  }
  .muted-row {
    opacity: 0.7;
    font-size: 0.75rem;
    margin-left: 0.3rem;
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
  em {
    font-style: italic;
    opacity: 0.9;
  }
</style>
