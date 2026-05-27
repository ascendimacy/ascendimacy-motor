<script lang="ts">
  /**
   * S3 decision — pipeline de decisão do turno:
   * unified_assessor → planejador (pool + rationale + entropy) →
   * pragmatic_selector → strategist → tactic_decision.
   *
   * Botão X-ray filtra llm_calls por roles do pipeline de decisão
   * (assessor / planejador / strategist).
   */
  import { createEventDispatcher } from "svelte";
  import type {
    ReplayTraceTurn,
    LlmCallLike,
    ReplayScoredItemLike,
  } from "../../lib/api.js";
  import SectionShell from "./SectionShell.svelte";

  export let turn: ReplayTraceTurn;

  const COLOR = "#eab308";
  const ROLES_S3: ReadonlyArray<string> = [
    "assessor",
    "planejador",
    "strategist",
  ];

  const dispatch = createEventDispatcher<{ openXray: { roles: string[] } }>();

  $: components = turn.engineTrace?.components ?? {};
  $: assessor = components.unified_assessor;
  $: planejador = components.planejador;
  $: strategist = components.strategist;
  $: selector = components.pragmatic_selector;
  $: tacticDecision = turn.engineTrace?.tactic_decision;

  // motorTrace v1 fallback pra plan / pool / selectedContent
  $: v1Plan = turn.motorTrace?.plan ?? {};
  $: v1Drota = turn.motorTrace?.drota ?? {};
  $: pool = (planejador?.outputs?.contentPool ??
    v1Plan.contentPool ??
    []) as ReplayScoredItemLike[];
  $: rationale =
    planejador?.outputs?.strategicRationale ?? v1Plan.strategicRationale;
  $: entropy =
    planejador?.outputs?.candidateSetEntropy ?? v1Plan.candidateSetEntropy;
  $: triage = planejador?.triageDecision;
  $: critical = triage?.route === "parental"; // parental triage = critical-ish flag
  $: selectedId =
    selector?.outputs?.selected_id ??
    (typeof v1Drota.selectedContent?.item?.["id"] === "string"
      ? (v1Drota.selectedContent.item["id"] as string)
      : undefined);

  $: callsForRole = ((turn.engineTrace?.llm_calls ?? []) as LlmCallLike[])
    .filter((c) => ROLES_S3.includes(c.role));

  $: hasAny =
    assessor !== undefined ||
    planejador !== undefined ||
    strategist !== undefined ||
    selector !== undefined ||
    tacticDecision !== undefined ||
    pool.length > 0 ||
    rationale !== undefined;

  function openXray(): void {
    dispatch("openXray", { roles: [...ROLES_S3] });
  }

  function fmtScore(s: number | undefined): string {
    return typeof s === "number" ? s.toFixed(2) : "?";
  }
  function fmtMs(ms: number | undefined): string {
    if (typeof ms !== "number") return "";
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }
</script>

<SectionShell id="S3" title="Decisão do turno" color={COLOR}>
  <span slot="meta">
    {#if pool.length > 0}
      <span class="badge pool" data-testid="section-S3-pool">{pool.length} pool</span>
    {/if}
    {#if critical}
      <span class="badge critical" data-testid="section-S3-critical">⚠ critical</span>
    {/if}
    {#if callsForRole.length > 0}
      <button
        type="button"
        class="xray-btn"
        on:click|stopPropagation|preventDefault={openXray}
        data-testid="section-S3-xray-btn"
        title={`Abrir LLM x-ray (roles: ${ROLES_S3.join(", ")})`}
      >
        🔬 X-ray ({callsForRole.length})
      </button>
    {/if}
    {#if !hasAny}
      <span class="badge muted">sem dado</span>
    {/if}
  </span>

  {#if !hasAny}
    <p class="empty">não houve decisão capturada</p>
  {/if}

  {#if assessor}
    <details class="sub" data-testid="s3-assessor">
      <summary>🧪 unified_assessor</summary>
      <div class="sub-body">
        {#if assessor.outputs?.mood !== undefined}
          <p><strong>mood:</strong> <code>{assessor.outputs.mood.toFixed(2)}</code>
            {#if assessor.mood_method}<span class="muted-row">· method: {assessor.mood_method}</span>{/if}
          </p>
        {/if}
        {#if assessor.outputs?.engagement}
          <p><strong>engagement:</strong> <code>{assessor.outputs.engagement}</code></p>
        {/if}
        {#if assessor.outputs?.signals && assessor.outputs.signals.length > 0}
          <p><strong>signals:</strong> {assessor.outputs.signals.join(", ")}</p>
        {/if}
        {#if assessor.duration_ms !== undefined}
          <p class="muted-row">{fmtMs(assessor.duration_ms)}</p>
        {/if}
      </div>
    </details>
  {/if}

  {#if planejador || rationale || entropy !== undefined || triage}
    <details class="sub" data-testid="s3-planejador">
      <summary>🧠 planejador</summary>
      <div class="sub-body">
        {#if rationale}
          <p><strong>rationale:</strong> {rationale}</p>
        {/if}
        {#if entropy !== undefined}
          <p><strong>entropy:</strong> <code>{entropy.toFixed(3)}</code></p>
        {/if}
        {#if triage}
          <p>
            <strong>triage:</strong> <code>{triage.route ?? "?"}</code>
            {#if triage.reason}— {triage.reason}{/if}
          </p>
        {/if}
        {#if planejador?.triggerEvaluation?.fired}
          <p>
            <strong>trigger fired:</strong>
            <code>{planejador.triggerEvaluation.fired}</code>
          </p>
        {/if}
        {#if planejador?.duration_ms !== undefined}
          <p class="muted-row">{fmtMs(planejador.duration_ms)}</p>
        {/if}
      </div>
    </details>
  {/if}

  {#if pool.length > 0}
    <details class="sub" data-testid="s3-pool" open>
      <summary>🎯 pool top-{Math.min(pool.length, 5)} (selected ↗)</summary>
      <ol class="pool">
        {#each pool.slice(0, 5) as scored}
          {@const id = typeof scored.item?.["id"] === "string" ? scored.item["id"] : "?"}
          <li class:selected={id === selectedId}>
            <span class="iid">{id}</span>
            <span class="score">score={fmtScore(scored.score)}</span>
            {#if id === selectedId}
              <span class="picked">↗ SELECTED</span>
            {/if}
          </li>
        {/each}
      </ol>
    </details>
  {/if}

  {#if selector}
    <details class="sub" data-testid="s3-selector">
      <summary>🎲 pragmatic_selector</summary>
      <div class="sub-body">
        {#if selector.outputs?.selected_id}
          <p><strong>selected:</strong> <code>{selector.outputs.selected_id}</code></p>
        {/if}
        {#if selector.filters_applied && selector.filters_applied.length > 0}
          <p><strong>filters_applied:</strong></p>
          <ul class="filters">
            {#each selector.filters_applied as f}
              <li>
                <code>{f.name}</code>
                {#if f.items_removed && f.items_removed.length > 0}
                  — removed {f.items_removed.length}
                {/if}
                {#if f.reason}<span class="muted-row">({f.reason})</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if selector.duration_ms !== undefined}
          <p class="muted-row">{fmtMs(selector.duration_ms)}</p>
        {/if}
      </div>
    </details>
  {/if}

  {#if strategist}
    <details class="sub" data-testid="s3-strategist">
      <summary>🎯 strategist</summary>
      <div class="sub-body">
        {#if strategist.inputs?.journey_stage}
          <p><strong>journey_stage:</strong> <code>{strategist.inputs.journey_stage}</code></p>
        {/if}
        <p><strong>target_demos:</strong> {(strategist.outputs?.target_demonstrations ?? []).length}</p>
        {#if strategist.composition_method}
          <p><strong>method:</strong> <code>{strategist.composition_method}</code></p>
        {/if}
        {#if strategist.duration_ms !== undefined}
          <p class="muted-row">{fmtMs(strategist.duration_ms)}</p>
        {/if}
      </div>
    </details>
  {/if}

  {#if tacticDecision}
    <details class="sub" data-testid="s3-tactic-decision" open>
      <summary>♟️ tactic_decision</summary>
      <div class="sub-body">
        {#if tacticDecision.jogada}
          <p><strong>jogada:</strong> <code>{tacticDecision.jogada}</code></p>
        {/if}
        {#if tacticDecision.selected_item_id}
          <p><strong>item:</strong> <code>{tacticDecision.selected_item_id}</code></p>
        {/if}
        {#if tacticDecision.angle}
          <p><strong>angle:</strong> <em>{tacticDecision.angle}</em></p>
        {/if}
        {#if tacticDecision.rationale}
          <p><strong>rationale:</strong> {tacticDecision.rationale}</p>
        {/if}
        {#if tacticDecision.constraints}
          <p>
            <strong>constraints:</strong>
            {#if tacticDecision.constraints.register}register=<code>{tacticDecision.constraints.register}</code>{/if}
            {#if tacticDecision.constraints.must_include}· must=<code>{tacticDecision.constraints.must_include}</code>{/if}
            {#if tacticDecision.constraints.avoid && tacticDecision.constraints.avoid.length > 0}
              · avoid={tacticDecision.constraints.avoid.length}
            {/if}
          </p>
        {/if}
      </div>
    </details>
  {/if}
</SectionShell>

<style>
  .badge {
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .badge.pool {
    background: rgba(234, 179, 8, 0.22);
    color: #854d0e;
  }
  .badge.critical {
    background: rgba(176, 0, 32, 0.2);
    color: #b00020;
  }
  .badge.muted {
    background: rgba(127, 127, 127, 0.18);
    opacity: 0.6;
    font-weight: 400;
  }
  .xray-btn {
    background: rgba(123, 31, 162, 0.22);
    color: #6a1b9a;
    border: none;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .xray-btn:hover {
    background: rgba(123, 31, 162, 0.35);
  }
  .xray-btn:focus-visible {
    outline: 2px solid #6a1b9a;
    outline-offset: 1px;
  }
  .sub {
    margin: 0.2rem 0;
  }
  .sub > summary {
    cursor: pointer;
    font-size: 0.78rem;
    opacity: 0.88;
    padding: 0.1rem 0;
  }
  .sub-body {
    padding: 0.1rem 0 0.2rem 1rem;
  }
  .sub-body p {
    margin: 0.1rem 0;
  }
  .pool {
    list-style: none;
    padding: 0 0 0 1rem;
    margin: 0.15rem 0;
  }
  .pool li {
    padding: 0.15rem 0;
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .pool li.selected {
    background: rgba(76, 175, 80, 0.12);
    border-left: 2px solid #388e3c;
    padding-left: 0.3rem;
  }
  .iid {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    word-break: break-all;
  }
  .score {
    opacity: 0.75;
    font-size: 0.72rem;
  }
  .picked {
    color: #388e3c;
    font-weight: 600;
    font-size: 0.7rem;
  }
  .filters {
    list-style: none;
    margin: 0.15rem 0;
    padding: 0 0 0 1rem;
    font-size: 0.75rem;
  }
  .muted-row {
    opacity: 0.7;
    font-size: 0.72rem;
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
