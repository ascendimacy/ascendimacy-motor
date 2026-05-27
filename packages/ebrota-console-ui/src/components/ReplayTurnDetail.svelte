<script lang="ts">
  /**
   * ReplayTurnDetail — engine x-ray per turn, organizado em 7 sub-seções
   * colapsáveis (S1 read · S2 active · S3 decision · S4 expression ·
   * S5 guard+recall · B1 social · B2 drill).
   *
   * Spec Fase 2: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-7-subsistemas-redesign-v0.md
   *
   * Cada sub-seção é um componente standalone em ./replay-turn-sections/
   * que lê o turn record (v2 engineTrace preferido; v1 motorTrace fallback).
   * S3/S4/S5 dispatch `openXray` com roles filter — wired aqui pro store
   * global llmXrayCalls/llmXrayPanelOpen consumed by LlmXrayPanel.
   */
  import type { ReplayTraceTurn, LlmCallLike } from "../lib/api.js";
  import { llmXrayCalls, llmXrayPanelOpen } from "../lib/stores.js";
  import S1ReadSection from "./replay-turn-sections/S1ReadSection.svelte";
  import S2ActiveSection from "./replay-turn-sections/S2ActiveSection.svelte";
  import S3DecisionSection from "./replay-turn-sections/S3DecisionSection.svelte";
  import S4ExpressionSection from "./replay-turn-sections/S4ExpressionSection.svelte";
  import S5GuardRecallSection from "./replay-turn-sections/S5GuardRecallSection.svelte";
  import B1SocialSection from "./replay-turn-sections/B1SocialSection.svelte";
  import B2DrillSection from "./replay-turn-sections/B2DrillSection.svelte";

  export let turn: ReplayTraceTurn;

  function openXrayByRoles(event: CustomEvent<{ roles: string[] }>): void {
    const roles = event.detail.roles;
    const allCalls = (turn.engineTrace?.llm_calls ?? []) as LlmCallLike[];
    const filtered = allCalls.filter((c) => roles.includes(c.role));
    llmXrayCalls.set(filtered);
    llmXrayPanelOpen.set(true);
  }

  $: hasV2 = turn.engineTrace !== undefined;
  $: hasV1 = turn.motorTrace !== undefined;
  $: stateDiff = turn.engineTrace?.state_diff;

  function fmtDelta(d: number | undefined): string {
    if (typeof d !== "number") return "?";
    const sign = d > 0 ? "+" : "";
    return `${sign}${d.toFixed(2)}`;
  }

  function fmtMs(ms: number | undefined): string {
    if (typeof ms !== "number") return "?";
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }
</script>

<div class="engine-detail" data-testid="engine-detail">
  <header class="top">
    <span class="caption">Engine x-ray</span>
    <span class="badges">
      {#if turn.trustLevel !== undefined}
        <span class="badge">trust={turn.trustLevel.toFixed(2)}</span>
      {/if}
      {#if turn.budgetRemaining !== undefined}
        <span class="badge">budget={turn.budgetRemaining}</span>
      {/if}
      {#if turn.durationMs !== undefined}
        <span class="badge">{fmtMs(turn.durationMs)}</span>
      {/if}
      {#if hasV2}
        <span class="badge v2" data-testid="v2-badge">v2</span>
      {/if}
      {#if hasV1 && hasV2}
        <span class="badge v1-fallback" title="v1 motorTrace presente como fallback"
          >v1</span
        >
      {/if}
      {#if hasV1 && !hasV2}
        <span class="badge v1-only" title="apenas v1 motorTrace presente">v1</span>
      {/if}
    </span>
  </header>

  {#if stateDiff}
    <div class="state-diff" data-testid="state-diff">
      {#if stateDiff.trust_delta !== undefined && stateDiff.trust_delta !== 0}
        <span class="badge" data-testid="state-trust-delta"
          >Δtrust={fmtDelta(stateDiff.trust_delta)}</span
        >
      {/if}
      {#if stateDiff.budget_delta !== undefined && stateDiff.budget_delta !== 0}
        <span class="badge" data-testid="state-budget-delta"
          >Δbudget={fmtDelta(stateDiff.budget_delta)}</span
        >
      {/if}
      {#if stateDiff.helix_advance}
        <span class="badge helix">
          helix
          {#if stateDiff.helix_advance.dimension_changed}·dim{/if}
          {#if stateDiff.helix_advance.level_changed}·lvl{/if}
          {#if stateDiff.helix_advance.cycle_completed}·cycle{/if}
        </span>
      {/if}
      {#if stateDiff.subject_knowledge_added_count !== undefined && stateDiff.subject_knowledge_added_count > 0}
        <span class="badge sk">+{stateDiff.subject_knowledge_added_count} sk</span>
      {/if}
    </div>
  {/if}

  <div class="sections" data-testid="sections">
    <S1ReadSection {turn} />
    <S2ActiveSection {turn} />
    <S3DecisionSection {turn} on:openXray={openXrayByRoles} />
    <S4ExpressionSection {turn} on:openXray={openXrayByRoles} />
    <S5GuardRecallSection {turn} on:openXray={openXrayByRoles} />
    <B1SocialSection {turn} />
    <B2DrillSection {turn} />
  </div>
</div>

<style>
  .engine-detail {
    margin-top: 0.4rem;
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: 4px;
    background: rgba(127, 127, 127, 0.04);
    font-size: 0.8rem;
    padding: 0.5rem 0.6rem;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding-bottom: 0.3rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.18);
    margin-bottom: 0.4rem;
  }
  .caption {
    font-weight: 600;
    font-size: 0.82rem;
    opacity: 0.85;
  }
  .badges {
    display: inline-flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    margin-left: auto;
  }
  .badge {
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    background: rgba(127, 127, 127, 0.15);
    font-size: 0.7rem;
  }
  .badge.v2 {
    background: rgba(0, 121, 107, 0.25);
    color: #00695c;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .badge.v1-fallback,
  .badge.v1-only {
    background: rgba(245, 124, 0, 0.18);
    color: #c2410c;
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .badge.helix {
    background: rgba(245, 124, 0, 0.22);
  }
  .badge.sk {
    background: rgba(123, 31, 162, 0.2);
  }
  .state-diff {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    margin-bottom: 0.4rem;
  }
  .sections {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  @media (max-width: 640px) {
    .top {
      gap: 0.3rem;
    }
    .badges {
      margin-left: 0;
      width: 100%;
    }
  }
</style>
