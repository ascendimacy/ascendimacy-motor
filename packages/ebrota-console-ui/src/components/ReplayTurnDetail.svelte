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

  // ─── v2 engine trace (sub-fase TV2-6) ──────────────────────────────────
  $: engineV2 = turn.engineTrace;
  $: hasV2 = engineV2 !== undefined;
  $: v2StateDiff = engineV2?.state_diff;
  $: v2Components = engineV2?.components ?? {};
  $: v2SkWrites = engineV2?.subject_knowledge_writes ?? [];
  $: v2Warnings = engineV2?.warnings ?? [];

  $: hasEngineData =
    hasV2 ||
    pool.length > 0 ||
    selected !== null ||
    skEvents.length > 0 ||
    plan.strategicRationale !== undefined ||
    plan.instruction_addition !== undefined ||
    exec.eventLogged !== undefined;

  function fmtDelta(d: number | undefined): string {
    if (typeof d !== "number") return "?";
    const sign = d > 0 ? "+" : "";
    return `${sign}${d.toFixed(2)}`;
  }

  function joinSignals(s: string[] | undefined): string {
    if (!s || s.length === 0) return "(none)";
    return s.join(", ");
  }

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
        {#if hasV2}
          <span class="badge v2" data-testid="v2-badge">v2</span>
        {/if}
      </span>
    </button>

    {#if expanded}
      <div class="sections">
        {#if hasV2}
          <section class="v2" data-testid="v2-section">
            <h4>🆕 v2 engine trace</h4>
            {#if turn.motorTrace !== undefined}
              <p class="v2-note" data-testid="v2-coexist-note">
                v2 engine trace available — v1 motorTrace abaixo permanece como fallback.
              </p>
            {/if}

            {#if v2StateDiff}
              <div class="v2-state-diff" data-testid="v2-state-diff">
                <strong>state diff:</strong>
                <span class="badges">
                  {#if v2StateDiff.trust_delta !== undefined && v2StateDiff.trust_delta !== 0}
                    <span class="badge" data-testid="v2-trust-delta"
                      >Δtrust={fmtDelta(v2StateDiff.trust_delta)}</span
                    >
                  {/if}
                  {#if v2StateDiff.budget_delta !== undefined && v2StateDiff.budget_delta !== 0}
                    <span class="badge" data-testid="v2-budget-delta"
                      >Δbudget={fmtDelta(v2StateDiff.budget_delta)}</span
                    >
                  {/if}
                  {#if v2StateDiff.journey_stage_transition}
                    <span class="badge journey" data-testid="v2-journey-transition">
                      journey: {v2StateDiff.journey_stage_transition.from} →
                      {v2StateDiff.journey_stage_transition.to}
                    </span>
                  {/if}
                  {#if v2StateDiff.helix_advance}
                    <span class="badge helix" data-testid="v2-helix-advance">
                      helix
                      {#if v2StateDiff.helix_advance.dimension_changed}·dim{/if}
                      {#if v2StateDiff.helix_advance.level_changed}·lvl{/if}
                      {#if v2StateDiff.helix_advance.cycle_completed}·cycle{/if}
                    </span>
                  {/if}
                  {#if v2StateDiff.session_phase_transition}
                    <span class="badge phase" data-testid="v2-phase-transition">
                      phase: {v2StateDiff.session_phase_transition.from} →
                      {v2StateDiff.session_phase_transition.to}
                    </span>
                  {/if}
                  {#if v2StateDiff.subject_knowledge_added_count !== undefined && v2StateDiff.subject_knowledge_added_count > 0}
                    <span class="badge sk" data-testid="v2-sk-added"
                      >+{v2StateDiff.subject_knowledge_added_count} sk</span
                    >
                  {/if}
                </span>
              </div>
            {/if}

            {#if v2Components.unified_assessor}
              {@const a = v2Components.unified_assessor}
              <details class="v2-comp" data-testid="v2-comp-assessor">
                <summary>🧪 assessor</summary>
                <div class="v2-comp-body">
                  {#if a.outputs?.mood !== undefined}
                    <p><strong>mood:</strong> <code>{a.outputs.mood.toFixed(2)}</code></p>
                  {/if}
                  {#if a.mood_method}
                    <p><strong>method:</strong> <code>{a.mood_method}</code></p>
                  {/if}
                  {#if a.outputs?.engagement}
                    <p><strong>engagement:</strong> <code>{a.outputs.engagement}</code></p>
                  {/if}
                  <p><strong>signals:</strong> {joinSignals(a.outputs?.signals)}</p>
                  {#if a.duration_ms !== undefined}
                    <p class="muted-row"><code>{fmtMs(a.duration_ms)}</code></p>
                  {/if}
                </div>
              </details>
            {/if}

            {#if v2Components.planejador}
              {@const p = v2Components.planejador}
              <details class="v2-comp" data-testid="v2-comp-planejador">
                <summary>🧠 planejador</summary>
                <div class="v2-comp-body">
                  {#if p.outputs?.strategicRationale}
                    <p><strong>rationale:</strong> {p.outputs.strategicRationale}</p>
                  {/if}
                  {#if p.outputs?.candidateSetEntropy !== undefined}
                    <p>
                      <strong>entropy:</strong>
                      <code>{p.outputs.candidateSetEntropy.toFixed(3)}</code>
                    </p>
                  {/if}
                  {#if p.triageDecision}
                    <p>
                      <strong>triage:</strong>
                      <code>{p.triageDecision.route ?? "?"}</code>
                      — {p.triageDecision.reason ?? ""}
                    </p>
                  {/if}
                  {#if p.duration_ms !== undefined}
                    <p class="muted-row"><code>{fmtMs(p.duration_ms)}</code></p>
                  {/if}
                </div>
              </details>
            {/if}

            {#if v2Components.strategist}
              {@const s = v2Components.strategist}
              <details class="v2-comp" data-testid="v2-comp-strategist">
                <summary>🎯 strategist</summary>
                <div class="v2-comp-body">
                  {#if s.inputs?.journey_stage}
                    <p>
                      <strong>journey_stage:</strong>
                      <code>{s.inputs.journey_stage}</code>
                    </p>
                  {/if}
                  <p>
                    <strong>target_demos:</strong>
                    {(s.outputs?.target_demonstrations ?? []).length}
                  </p>
                  {#if s.composition_method}
                    <p>
                      <strong>method:</strong>
                      <code>{s.composition_method}</code>
                    </p>
                  {/if}
                  {#if s.duration_ms !== undefined}
                    <p class="muted-row"><code>{fmtMs(s.duration_ms)}</code></p>
                  {/if}
                </div>
              </details>
            {/if}

            {#if v2Components.pragmatic_selector}
              {@const sel = v2Components.pragmatic_selector}
              <details class="v2-comp" data-testid="v2-comp-selector">
                <summary>🎲 pragmatic_selector</summary>
                <div class="v2-comp-body">
                  {#if sel.outputs?.selected_id}
                    <p>
                      <strong>selected:</strong>
                      <code>{sel.outputs.selected_id}</code>
                    </p>
                  {/if}
                  {#if sel.filters_applied && sel.filters_applied.length > 0}
                    <p><strong>filters_applied:</strong></p>
                    <ul class="v2-filters">
                      {#each sel.filters_applied as f}
                        <li>
                          <code>{f.name}</code>
                          {#if f.items_removed && f.items_removed.length > 0}
                            — removed {f.items_removed.length}
                          {/if}
                          {#if f.reason}<span class="muted-row"> ({f.reason})</span>{/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                  {#if sel.duration_ms !== undefined}
                    <p class="muted-row"><code>{fmtMs(sel.duration_ms)}</code></p>
                  {/if}
                </div>
              </details>
            {/if}

            {#if v2Components.constrained_materializer}
              {@const m = v2Components.constrained_materializer}
              <details class="v2-comp" data-testid="v2-comp-materializer">
                <summary>✍️ constrained_materializer</summary>
                <div class="v2-comp-body">
                  {#if m.inputs?.selected_item_id}
                    <p>
                      <strong>item_id:</strong>
                      <code>{m.inputs.selected_item_id}</code>
                    </p>
                  {/if}
                  {#if m.stable_prefix_hash}
                    <p>
                      <strong>stable_prefix_hash:</strong>
                      <code class="hash">{m.stable_prefix_hash}</code>
                    </p>
                  {/if}
                  {#if m.llm_call_ref}
                    <p>
                      <strong>llm_call_ref:</strong>
                      <code>{m.llm_call_ref}</code>
                    </p>
                  {/if}
                  {#if m.duration_ms !== undefined}
                    <p class="muted-row"><code>{fmtMs(m.duration_ms)}</code></p>
                  {/if}
                </div>
              </details>
            {/if}

            {#if v2SkWrites.length > 0}
              <div class="v2-sk-writes" data-testid="v2-sk-writes">
                <h5>🔍 Subject Knowledge writes ({v2SkWrites.length})</h5>
                <ul>
                  {#each v2SkWrites as w}
                    <li>
                      <span
                        class="badge"
                        style="background: {eventBadge(w.type)}; color: white"
                        >{w.type}</span
                      >
                      {#if w.writer}
                        <span class="muted-row">writer=<code>{w.writer}</code></span>
                      {/if}
                      {#if w.triggered_by}
                        <span class="muted-row"
                          >triggered_by=<code>{w.triggered_by}</code></span
                        >
                      {/if}
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}

            {#if v2Warnings.length > 0}
              <div class="v2-warnings" data-testid="v2-warnings">
                <h5>⚠️ warnings ({v2Warnings.length})</h5>
                <ul>
                  {#each v2Warnings as w}
                    <li>
                      <span class="badge warn">{w.component}</span>
                      <span class="warn-msg">{w.message}</span>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          </section>
        {/if}

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
  /* ── v2 engine trace (TV2-6) ──────────────────────────────────────── */
  .badge.v2 {
    background: rgba(0, 121, 107, 0.25);
    color: #00695c;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .badge.journey { background: rgba(123, 31, 162, 0.22); }
  .badge.helix { background: rgba(245, 124, 0, 0.22); }
  .badge.phase { background: rgba(46, 125, 50, 0.22); }
  .badge.warn {
    background: rgba(183, 28, 28, 0.18);
    color: #b71c1c;
    font-weight: 600;
  }
  .v2 .v2-note {
    font-style: italic;
    opacity: 0.75;
    font-size: 0.72rem;
    margin: 0 0 0.3rem 0;
  }
  .v2-state-diff {
    margin: 0.2rem 0 0.5rem 0;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .v2-state-diff .badges {
    margin-left: 0;
  }
  .v2-comp {
    margin: 0.2rem 0;
    padding: 0.15rem 0;
  }
  .v2-comp > summary {
    cursor: pointer;
    font-size: 0.78rem;
    opacity: 0.85;
  }
  .v2-comp-body {
    padding: 0.2rem 0 0.2rem 1rem;
  }
  .v2-comp-body p {
    margin: 0.1rem 0;
    font-size: 0.78rem;
  }
  .v2-filters {
    list-style: none;
    margin: 0.15rem 0;
    padding: 0 0 0 1rem;
    font-size: 0.75rem;
  }
  .v2-filters li {
    padding: 0.1rem 0;
  }
  .muted-row {
    opacity: 0.6;
    font-size: 0.7rem;
  }
  .hash {
    font-size: 0.7rem;
    word-break: break-all;
  }
  .v2-sk-writes,
  .v2-warnings {
    margin-top: 0.5rem;
  }
  .v2-sk-writes h5,
  .v2-warnings h5 {
    margin: 0 0 0.3rem 0;
    font-size: 0.78rem;
  }
  .v2-sk-writes ul,
  .v2-warnings ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .v2-sk-writes li,
  .v2-warnings li {
    padding: 0.15rem 0;
    display: flex;
    gap: 0.4rem;
    align-items: center;
    flex-wrap: wrap;
    font-size: 0.75rem;
  }
  .v2-sk-writes .badge {
    padding: 0.05rem 0.4rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .warn-msg {
    color: #b71c1c;
  }
</style>
