<script lang="ts">
  /**
   * ReplayTurnDetail — engine x-ray expansível por turn no Replay.
   *
   * Surfaces o que já existe em trace.json (motorTrace.{plan, drota, exec}
   * + subjectKnowledgeEvents + flags do turn). Não busca dados extras do
   * BFF — render puro do trace.
   *
   * Out of scope (v1): LLM calls raw (entries vazias nos STS traces), Journey
   * snapshots por turn (não capturados — necessitaria estender writers).
   */
  import type { ReplayTraceTurn, ReplayScoredItemLike } from "../lib/api.js";

  export let turn: ReplayTraceTurn;

  let expanded = false;

  $: motor = turn.motorTrace ?? {};
  $: plan = motor.plan ?? {};
  $: drota = motor.drota ?? {};
  $: exec = motor.exec ?? {};
  $: pool = (plan.contentPool ?? []) as ReplayScoredItemLike[];
  $: selected = drota.selectedContent ?? null;
  $: selectedId =
    selected?.item && typeof selected.item.id === "string"
      ? selected.item.id
      : null;
  // Subject Knowledge events: turn-level OR drota nested (legacy)
  $: skEvents = (turn.subjectKnowledgeEvents ??
    drota.subjectKnowledgeEvents ??
    []) as Array<Record<string, unknown>>;
  $: hasEngineData =
    pool.length > 0 ||
    selected !== null ||
    skEvents.length > 0 ||
    plan.strategicRationale !== undefined ||
    plan.instruction_addition !== undefined ||
    exec.eventLogged !== undefined;

  function fmtScore(s: number | undefined): string {
    if (typeof s !== "number") return "?";
    return s.toFixed(2);
  }

  function fmtMs(ms: number | undefined): string {
    if (typeof ms !== "number") return "?";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function eventBadge(type: string): string {
    if (type === "interest") return "#1976d2";
    if (type === "value") return "#388e3c";
    if (type === "need") return "#f57c00";
    if (type === "discovery") return "#7b1fa2";
    if (type === "boundary_event") return "#b00020";
    if (type === "presented_concept") return "#00897b";
    if (type === "recall_check_attempt") return "#ef6c00";
    if (type === "axis_attempt_outcome") return "#5d4037";
    return "#666";
  }

  function eventLabel(e: Record<string, unknown>): string {
    const payload = (e["payload"] ?? {}) as Record<string, unknown>;
    if (typeof payload["label"] === "string") return payload["label"];
    if (typeof payload["concept_id"] === "string") return payload["concept_id"];
    if (typeof payload["item_id"] === "string") return String(payload["item_id"]);
    if (typeof payload["topic_category"] === "string")
      return `topic=${payload["topic_category"]}`;
    return JSON.stringify(payload).slice(0, 80);
  }
</script>

{#if hasEngineData || turn.trustLevel !== undefined}
  <div class="engine-detail" data-testid="engine-detail">
    <button
      type="button"
      class="toggle"
      on:click={() => (expanded = !expanded)}
      aria-expanded={expanded}
      data-testid="engine-toggle"
    >
      <span class="caret">{expanded ? "▼" : "▶"}</span>
      Engine x-ray
      <span class="badges">
        {#if turn.trustLevel !== undefined}
          <span class="badge">trust={turn.trustLevel.toFixed(2)}</span>
        {/if}
        {#if turn.budgetRemaining !== undefined}
          <span class="badge">budget={turn.budgetRemaining}</span>
        {/if}
        {#if turn.playbookId}
          <span class="badge mono">{turn.playbookId}</span>
        {/if}
        {#if turn.durationMs !== undefined}
          <span class="badge">{fmtMs(turn.durationMs)}</span>
        {/if}
        {#if skEvents.length > 0}
          <span class="badge sk">{skEvents.length} sk</span>
        {/if}
        {#if pool.length > 0}
          <span class="badge pool">{pool.length} pool</span>
        {/if}
      </span>
    </button>

    {#if expanded}
      <div class="sections">
        {#if plan.strategicRationale || plan.instruction_addition || plan.candidateSetEntropy !== undefined}
          <section class="plan">
            <h4>🧠 Plan</h4>
            {#if plan.strategicRationale}
              <p><strong>rationale:</strong> {plan.strategicRationale}</p>
            {/if}
            {#if plan.instruction_addition}
              <p><strong>instruction:</strong> {plan.instruction_addition}</p>
            {/if}
            {#if plan.candidateSetEntropy !== undefined}
              <p>
                <strong>entropy:</strong>
                <code>{plan.candidateSetEntropy.toFixed(3)}</code>
              </p>
            {/if}
            {#if plan.contextHints}
              <details class="raw">
                <summary>contextHints (JSON)</summary>
                <pre>{JSON.stringify(plan.contextHints, null, 2)}</pre>
              </details>
            {/if}
          </section>
        {/if}

        {#if pool.length > 0}
          <section class="pool" data-testid="pool-section">
            <h4>🎯 Pool top-{Math.min(pool.length, 5)} (selected ↗)</h4>
            <ol>
              {#each pool.slice(0, 5) as scored}
                {@const id =
                  typeof scored.item?.["id"] === "string"
                    ? scored.item["id"]
                    : "?"}
                <li class:selected={id === selectedId}>
                  <span class="iid">{id}</span>
                  <span class="score">score={fmtScore(scored.score)}</span>
                  {#if id === selectedId}<span class="picked">↗ SELECTED</span>{/if}
                  {#if scored.reasons && scored.reasons.length > 0}
                    <details class="reasons">
                      <summary>reasons ({scored.reasons.length})</summary>
                      <ul>
                        {#each scored.reasons as r}
                          <li><code>{r}</code></li>
                        {/each}
                      </ul>
                    </details>
                  {/if}
                </li>
              {/each}
            </ol>
            {#if drota.selectionRationale}
              <p class="sel-rationale">
                <strong>selectionRationale:</strong> {drota.selectionRationale}
              </p>
            {/if}
          </section>
        {/if}

        {#if skEvents.length > 0}
          <section class="sk" data-testid="sk-section">
            <h4>🔍 Subject Knowledge writes ({skEvents.length})</h4>
            <ul>
              {#each skEvents as e}
                {@const type =
                  typeof e["type"] === "string" ? e["type"] : "unknown"}
                <li>
                  <span
                    class="badge"
                    style="background: {eventBadge(type)}; color: white">{type}</span
                  >
                  <span class="ev-label">{eventLabel(e)}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if exec.eventLogged || exec.newState}
          <section class="exec">
            <h4>⚙️ Exec</h4>
            {#if exec.eventLogged}
              <details class="raw">
                <summary>eventLogged</summary>
                <pre>{JSON.stringify(exec.eventLogged, null, 2)}</pre>
              </details>
            {/if}
            {#if exec.newState}
              <details class="raw">
                <summary>newState</summary>
                <pre>{JSON.stringify(exec.newState, null, 2)}</pre>
              </details>
            {/if}
          </section>
        {/if}

        {#if turn.cardEmissionSkipReason}
          <p class="card-skip">
            <strong>card emission skipped:</strong> {turn.cardEmissionSkipReason}
          </p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .engine-detail {
    margin-top: 0.4rem;
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: 4px;
    background: rgba(127, 127, 127, 0.04);
    font-size: 0.8rem;
  }
  .toggle {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0.4rem 0.6rem;
    color: inherit;
    font-family: inherit;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .toggle:hover {
    background: rgba(127, 127, 127, 0.1);
  }
  .caret {
    opacity: 0.6;
    width: 0.8rem;
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
  .badge.mono {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  }
  .badge.sk { background: rgba(123, 31, 162, 0.2); }
  .badge.pool { background: rgba(25, 118, 210, 0.2); }
  .sections {
    padding: 0.5rem 0.7rem;
    border-top: 1px solid rgba(127, 127, 127, 0.2);
  }
  .sections section {
    margin-bottom: 0.7rem;
  }
  .sections h4 {
    margin: 0 0 0.3rem 0;
    font-size: 0.8rem;
  }
  .sections p {
    margin: 0.15rem 0;
    line-height: 1.4;
  }
  .pool ol {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .pool li {
    padding: 0.2rem 0;
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.4rem;
    align-items: baseline;
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
    font-size: 0.75rem;
    opacity: 0.75;
  }
  .picked {
    color: #388e3c;
    font-weight: 600;
    font-size: 0.7rem;
  }
  .reasons {
    grid-column: 1 / -1;
    margin-left: 0.8rem;
  }
  .reasons summary {
    cursor: pointer;
    font-size: 0.7rem;
    opacity: 0.7;
  }
  .reasons ul {
    list-style: none;
    padding: 0.2rem 0 0.2rem 1rem;
    margin: 0;
  }
  .reasons code {
    font-size: 0.7rem;
  }
  .sel-rationale {
    margin-top: 0.4rem;
    font-style: italic;
    opacity: 0.85;
  }
  .sk ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .sk li {
    padding: 0.15rem 0;
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .sk .badge {
    padding: 0.05rem 0.4rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .ev-label {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    word-break: break-all;
  }
  .raw {
    margin-top: 0.3rem;
  }
  .raw summary {
    cursor: pointer;
    font-size: 0.75rem;
    opacity: 0.7;
  }
  .raw pre {
    background: rgba(127, 127, 127, 0.08);
    padding: 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    overflow-x: auto;
    margin: 0.2rem 0 0 0;
    max-height: 200px;
  }
  .card-skip {
    color: #b00020;
    font-size: 0.75rem;
  }
</style>
