<script lang="ts">
  /**
   * S5 — Motor de Avaliação (panel).
   * Pergunta: "O motor está funcionando? Como sabemos?"
   *
   * Sub-tabs:
   *   - Guardrail (S5.a) — boundary events per turn
   *   - STS (S5.b)       — run history + launcher modal
   *   - Longitudinal (S5.c) — mood trajectory, CASEL deltas, retention,
   *                           Trigger Evaluator, RecallCheck closed-loop
   *
   * Spec parent: docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md
   * User stories: US-S5a-01, US-S5b-01..03, US-S5c-01..04.
   */
  import {
    analyticsOpen,
    debugPanelOpen,
    llmXrayPanelOpen,
    llmXrayCalls,
    currentSessionId,
    tracerSubjectId,
  } from "../../lib/stores.js";
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";
  import PlaceholderBanner from "./PlaceholderBanner.svelte";
  import STSLauncherModal from "../sts/STSLauncherModal.svelte";
  import {
    createApiClient,
    type ApiClient,
    type GuardrailCheckEntryLike,
    type RecallCheckEntryLike,
    type TriggerEventEntryLike,
    type KpiLongitudinalLike,
    type StsRunSummaryLike,
    type StsRunStartResultLike,
  } from "../../lib/api.js";

  /** Permite injetar mock em testes. */
  export let api: ApiClient = createApiClient();

  const COLOR = "#ef4444";

  type Tab = "guardrail" | "sts" | "longitudinal";
  let activeTab: Tab = "guardrail";

  function setTab(t: Tab): void {
    activeTab = t;
  }

  function openAnalytics(): void { analyticsOpen.set(true); }
  function openDebug(): void { debugPanelOpen.set(true); }
  function openXray(): void {
    llmXrayCalls.set([]);
    llmXrayPanelOpen.set(true);
  }

  function derivePersonaId(sessionId: string | null, fallback: string): string {
    if (sessionId === null || sessionId.length === 0) return fallback;
    const idx = sessionId.indexOf("__");
    return idx > 0 ? sessionId.slice(0, idx) : sessionId;
  }

  $: personaId = derivePersonaId($currentSessionId, $tracerSubjectId);

  type LoadState = "idle" | "loading" | "loaded" | "error";

  // ─── S5.a Guardrail state ────────────────────────────────────────
  let guardrailState: LoadState = "idle";
  let guardrailChecks: GuardrailCheckEntryLike[] = [];
  let guardrailPassed = 0;
  let guardrailFailed = 0;
  let guardrailSource: "real" | "stub_v0" = "stub_v0";
  let guardrailError = "";

  async function loadGuardrail(pid: string): Promise<void> {
    guardrailState = "loading";
    try {
      const res = await api.getGuardrailHistory(pid, 20);
      guardrailChecks = res.checks;
      guardrailPassed = res.passed_count;
      guardrailFailed = res.failed_count;
      guardrailSource = res.source;
      guardrailState = "loaded";
    } catch (err) {
      guardrailError = err instanceof Error ? err.message : String(err);
      guardrailState = "error";
    }
  }

  // ─── S5.b STS state ──────────────────────────────────────────────
  let stsRunsState: LoadState = "idle";
  let stsRuns: StsRunSummaryLike[] = [];
  let stsRunsError = "";
  let launcherOpen = false;
  let lastDispatched: StsRunStartResultLike | null = null;

  // Filters
  let filterPersona = "";
  let filterScenario = "";

  $: filteredStsRuns = stsRuns.filter((r) => {
    if (filterPersona !== "" && r.persona_id !== filterPersona) return false;
    if (filterScenario !== "" && r.scenario_id !== filterScenario) return false;
    return true;
  });

  $: stsPersonaOptions = Array.from(new Set(stsRuns.map((r) => r.persona_id))).sort();
  $: stsScenarioOptions = Array.from(new Set(stsRuns.map((r) => r.scenario_id))).sort();

  async function loadStsRuns(): Promise<void> {
    stsRunsState = "loading";
    try {
      const res = await api.listStsRuns(50);
      stsRuns = res.runs;
      stsRunsState = "loaded";
    } catch (err) {
      stsRunsError = err instanceof Error ? err.message : String(err);
      stsRunsState = "error";
    }
  }

  function onStsStarted(ev: CustomEvent<StsRunStartResultLike>): void {
    lastDispatched = ev.detail;
    void loadStsRuns();
  }

  // ─── S5.c Longitudinal state ─────────────────────────────────────
  let kpiState: LoadState = "idle";
  let kpi: KpiLongitudinalLike | null = null;
  let kpiError = "";

  let triggerState: LoadState = "idle";
  let triggerEvents: TriggerEventEntryLike[] = [];
  let triggerTransitions: Array<{ transition: string; count: number }> = [];
  let triggerSource: "real" | "stub_v0" = "stub_v0";

  let recallState: LoadState = "idle";
  let recallEvents: RecallCheckEntryLike[] = [];
  let recallSource: "real" | "stub_v0" = "stub_v0";

  async function loadKpi(pid: string): Promise<void> {
    kpiState = "loading";
    try {
      kpi = await api.getKpiLongitudinal(pid);
      kpiState = "loaded";
    } catch (err) {
      kpiError = err instanceof Error ? err.message : String(err);
      kpiState = "error";
    }
  }

  async function loadTriggers(pid: string): Promise<void> {
    triggerState = "loading";
    try {
      const res = await api.getTriggerEvents(pid, 20);
      triggerEvents = res.events;
      triggerTransitions = res.transitions;
      triggerSource = res.source;
      triggerState = "loaded";
    } catch {
      triggerState = "error";
    }
  }

  async function loadRecall(pid: string): Promise<void> {
    recallState = "loading";
    try {
      const res = await api.getRecallCheckHistory(pid, 20);
      recallEvents = res.events;
      recallSource = res.source;
      recallState = "loaded";
    } catch {
      recallState = "error";
    }
  }

  // Trigger initial + re-fetch quando persona muda. lastLoadedFor evita loop.
  let lastLoadedFor = "";
  $: if (personaId !== "" && personaId !== lastLoadedFor) {
    lastLoadedFor = personaId;
    void loadGuardrail(personaId);
    void loadStsRuns();
    void loadKpi(personaId);
    void loadTriggers(personaId);
    void loadRecall(personaId);
  }

  // ─── Helpers ─────────────────────────────────────────────────────
  function formatRelative(iso: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return iso;
    const diffMs = Date.now() - t;
    const absSec = Math.round(Math.abs(diffMs) / 1000);
    if (absSec < 60) return `${absSec}s atrás`;
    const absMin = Math.round(absSec / 60);
    if (absMin < 60) return `${absMin}m atrás`;
    const absH = Math.round(absMin / 60);
    if (absH < 24) return `${absH}h atrás`;
    return `${Math.round(absH / 24)}d atrás`;
  }

  function formatRate(rate: number | null): string {
    if (rate === null) return "—";
    return `${Math.round(rate * 100)}%`;
  }

  function sparklineHeight(rate: number | null): string {
    if (rate === null) return "5%";
    return `${Math.max(5, Math.round(rate * 100))}%`;
  }
</script>

<SubsystemPanelShell id="S5" title="Motor de Avaliação" color={COLOR}>
  <div class="tabs" role="tablist" aria-label="S5 sub-tabs">
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === "guardrail"}
      class:active={activeTab === "guardrail"}
      on:click={() => setTab("guardrail")}
      data-testid="s5-tab-guardrail"
    >
      Guardrail
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === "sts"}
      class:active={activeTab === "sts"}
      on:click={() => setTab("sts")}
      data-testid="s5-tab-sts"
    >
      STS
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === "longitudinal"}
      class:active={activeTab === "longitudinal"}
      on:click={() => setTab("longitudinal")}
      data-testid="s5-tab-longitudinal"
    >
      Longitudinal
    </button>
  </div>

  {#if activeTab === "guardrail"}
    <section class="tab-panel" data-testid="s5-pane-guardrail">
      <h3>S5.a — Guardrail (boundary events)</h3>
      {#if guardrailState === "loading"}
        <p class="muted small" data-testid="guardrail-loading">carregando…</p>
      {:else if guardrailState === "error"}
        <p class="error small" data-testid="guardrail-error">
          erro: {guardrailError}
        </p>
        <PlaceholderBanner
          label="endpoint indisponível — fallback"
          specPath="docs/specs/2026-05-26-console-ebrota-user-stories-v0.md (US-S5a-01)"
          color={COLOR}
        />
      {:else}
        <div class="summary-badge" data-testid="guardrail-summary">
          <span class="check-badge passed">✓ {guardrailPassed} passed</span>
          {#if guardrailFailed > 0}
            <span class="check-badge failed">✗ {guardrailFailed} failed</span>
          {/if}
          {#if guardrailSource === "stub_v0"}
            <span class="stub-tag">stub_v0</span>
          {/if}
        </div>

        {#if guardrailChecks.length === 0}
          <p class="muted small" data-testid="guardrail-empty">
            sem boundary events para esta persona — guardrail v0 cobre
            sanitize/bullying/scaffold/parental rule-based; eventos só
            aparecem quando trigger ocorre.
          </p>
        {:else}
          <table class="checks-table" data-testid="guardrail-table">
            <thead>
              <tr>
                <th>turn</th>
                <th>category</th>
                <th>label</th>
                <th>intensity</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {#each guardrailChecks as c (c.id)}
                <tr>
                  <td><code>{c.turn_ref}</code></td>
                  <td>{c.topic_category}</td>
                  <td class="label-cell">{c.label}</td>
                  <td>{c.intensity === null ? "—" : c.intensity.toFixed(2)}</td>
                  <td>
                    <span class="check-badge" class:passed={c.passed} class:failed={!c.passed}>
                      {c.passed ? "✓" : "✗"}
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {/if}
    </section>
  {:else if activeTab === "sts"}
    <section class="tab-panel" data-testid="s5-pane-sts">
      <h3>S5.b — STS (cross-session)</h3>
      <div class="sts-header">
        <button
          type="button"
          class="action primary"
          on:click={() => { launcherOpen = true; }}
          data-testid="sts-launch-btn"
        >
          🚀 Lançar nova run
        </button>
        <button type="button" class="action" on:click={openAnalytics}>
          📊 Analytics
        </button>
      </div>

      {#if lastDispatched !== null}
        <div class="dispatched-banner" data-testid="sts-last-dispatched">
          <strong>Última run disparada:</strong>
          <code>{lastDispatched.run_id.slice(0, 8)}…</code>
          ({lastDispatched.persona_id} / {lastDispatched.scenario_id})
        </div>
      {/if}

      <h4>Histórico de runs</h4>
      <div class="filters">
        <label>
          <span>persona</span>
          <select bind:value={filterPersona} data-testid="sts-filter-persona">
            <option value="">todas</option>
            {#each stsPersonaOptions as p (p)}
              <option value={p}>{p}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>scenario</span>
          <select bind:value={filterScenario} data-testid="sts-filter-scenario">
            <option value="">todos</option>
            {#each stsScenarioOptions as s (s)}
              <option value={s}>{s}</option>
            {/each}
          </select>
        </label>
      </div>

      {#if stsRunsState === "loading"}
        <p class="muted small" data-testid="sts-runs-loading">carregando runs…</p>
      {:else if stsRunsState === "error"}
        <p class="error small" data-testid="sts-runs-error">
          erro: {stsRunsError}
        </p>
      {:else if filteredStsRuns.length === 0}
        <p class="muted small" data-testid="sts-runs-empty">
          nenhuma run STS persistida (rode <code>node scripts/sts-group-dyad.mjs</code>
          ou use o launcher acima).
        </p>
      {:else}
        <table class="runs-table" data-testid="sts-runs-table">
          <thead>
            <tr>
              <th>run_id</th>
              <th>persona</th>
              <th>scenario</th>
              <th>started</th>
              <th>turns</th>
              <th>score</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredStsRuns as r (r.run_id)}
              <tr>
                <td><code>{r.run_id.slice(0, 8)}…</code></td>
                <td>{r.persona_id}</td>
                <td>{r.scenario_id}</td>
                <td>{formatRelative(r.started_at)}</td>
                <td>{r.turn_count}</td>
                <td>{r.score ?? "—"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {:else}
    <section class="tab-panel" data-testid="s5-pane-longitudinal">
      <h3>S5.c — Longitudinal</h3>
      <p class="spec-ref">
        spec: <code>docs/specs/2026-05-26-s5c-longitudinal-v0.md</code>
      </p>

      {#if kpiState === "loading"}
        <p class="muted small" data-testid="kpi-loading">carregando KPIs…</p>
      {:else if kpiState === "error"}
        <p class="error small" data-testid="kpi-error">erro: {kpiError}</p>
      {:else if kpi !== null}
        {#if kpi.source !== "real"}
          <p class="stub-note">
            ⚠ KPI source: <code>{kpi.source}</code> — algumas métricas ainda
            não calculáveis (mood detector + CASEL aggregator pendentes).
          </p>
        {/if}

        <div class="kpi-block" data-testid="kpi-mood">
          <h4>Mood trajectory (últimas {kpi.mood_trajectory.length} sessões)</h4>
          {#if kpi.mood_trajectory.length === 0}
            <p class="muted small">sem sessões registradas</p>
          {:else}
            <div class="sparkline" aria-hidden="true">
              {#each kpi.mood_trajectory.slice().reverse() as point (point.session_id)}
                <span
                  class="spark-bar"
                  style:height={sparklineHeight(point.mood !== null ? point.mood / 10 : 0.3)}
                  title={`${point.session_id} @ ${point.started_at} mood=${point.mood ?? "?"}`}
                ></span>
              {/each}
            </div>
            <p class="muted small">
              mood pendente — sparkline mostra altura uniforme (0.3) até writer
              de mood escrever em `sessions.mood_average`.
            </p>
          {/if}
        </div>

        <div class="kpi-block" data-testid="kpi-casel">
          <h4>CASEL deltas (mensal 5×4)</h4>
          {#if kpi.casel_deltas.length === 0}
            <p class="muted small">
              heatmap CASEL pendente — aggregator não wired em v0.
            </p>
            <PlaceholderBanner
              label="CASEL heatmap v0 — orthogonal a doctrine pivot"
              specPath="docs/specs/2026-05-26-s5c-longitudinal-v0.md"
              color={COLOR}
            />
          {:else}
            <table class="casel-heatmap">
              <tbody>
                {#each kpi.casel_deltas as d (d.month + d.axis)}
                  <tr>
                    <td>{d.month}</td>
                    <td>{d.axis}</td>
                    <td>{d.delta.toFixed(2)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>

        <div class="kpi-block" data-testid="kpi-retention">
          <h4>Concept retention (recall + closed loop)</h4>
          <p>
            total attempts: <strong>{kpi.concept_retention.total_attempts}</strong>
            · positive rate: <strong>{formatRate(kpi.concept_retention.positive_rate)}</strong>
          </p>
          {#if kpi.concept_retention.positive_rate_by_week.length > 0}
            <div class="sparkline" aria-hidden="true">
              {#each kpi.concept_retention.positive_rate_by_week as w (w.week_start)}
                <span
                  class="spark-bar retention"
                  style:height={sparklineHeight(w.rate)}
                  title={`${w.week_start}: ${formatRate(w.rate)} (${w.total})`}
                ></span>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <div class="kpi-block" data-testid="kpi-trigger">
        <h4>Trigger Evaluator (read-only)</h4>
        {#if triggerState === "loading"}
          <p class="muted small">carregando…</p>
        {:else}
          {#if triggerSource === "stub_v0"}
            <p class="stub-note">
              ⚠ source: <code>stub_v0</code> — TriggerEvaluator events
              vivem em <code>engineTrace.components.planejador.triggerEvaluation</code>
              mas ainda não persistem em SQL pra agregação cross-session.
            </p>
          {/if}
          {#if triggerTransitions.length === 0}
            <p class="muted small">sem transições registradas</p>
          {:else}
            <ul class="transitions">
              {#each triggerTransitions as t (t.transition)}
                <li><code>{t.transition}</code> × {t.count}</li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>

      <div class="kpi-block" data-testid="kpi-recall">
        <h4>RecallCheck closed-loop</h4>
        {#if recallState === "loading"}
          <p class="muted small">carregando…</p>
        {:else if recallEvents.length === 0}
          <p class="muted small">
            {recallSource === "stub_v0" ? "sem recall events ainda" : "vazio"}
          </p>
        {:else}
          <ul class="recall-list">
            {#each recallEvents.slice(0, 8) as e (e.id)}
              <li>
                <span class="outcome-badge" class:positive={e.outcome === "positive"} class:negative={e.outcome === "negative"}>
                  {e.outcome}
                </span>
                <code>{e.concept_id}</code>
                <span class="muted small">{formatRelative(e.created_at)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="actions">
        <button type="button" class="action" on:click={openDebug}>
          🔬 DebugPanel
        </button>
      </div>
    </section>
  {/if}

  <div class="actions">
    <button
      type="button"
      class="xray"
      on:click={openXray}
      data-testid="s5-xray-btn"
    >
      🔬 X-ray (motor-execucao)
    </button>
  </div>
</SubsystemPanelShell>

<STSLauncherModal
  {api}
  open={launcherOpen}
  on:close={() => { launcherOpen = false; }}
  on:started={onStsStarted}
/>

<style>
  .tabs {
    display: flex;
    gap: 0.4rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.3);
    padding-bottom: 0.4rem;
  }
  .tabs button {
    background: transparent;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 4px 4px 0 0;
    padding: 0.3rem 0.8rem;
    font: inherit;
    font-size: 0.85rem;
    color: inherit;
    cursor: pointer;
  }
  .tabs button.active {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.6);
    color: #ef4444;
    font-weight: 600;
  }
  .tab-panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  h3 {
    margin: 0;
    font-size: 0.95rem;
  }
  h4 {
    margin: 0.4rem 0 0.2rem 0;
    font-size: 0.85rem;
    opacity: 0.9;
  }
  .summary-badge {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .check-badge {
    display: inline-block;
    min-width: 1.3rem;
    text-align: center;
    border-radius: 3px;
    padding: 0.1rem 0.4rem;
    font-size: 0.78rem;
    font-weight: 700;
  }
  .check-badge.passed {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
  }
  .check-badge.failed {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }
  .stub-tag {
    background: rgba(245, 158, 11, 0.2);
    color: #f59e0b;
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-weight: 600;
  }
  .stub-note {
    background: rgba(245, 158, 11, 0.1);
    border-left: 3px solid #f59e0b;
    padding: 0.4rem 0.6rem;
    font-size: 0.8rem;
    margin: 0.3rem 0;
    border-radius: 3px;
  }
  .checks-table,
  .runs-table,
  .casel-heatmap {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  .checks-table th,
  .checks-table td,
  .runs-table th,
  .runs-table td,
  .casel-heatmap td {
    text-align: left;
    padding: 0.25rem 0.4rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.18);
  }
  .checks-table th,
  .runs-table th {
    font-weight: 600;
    opacity: 0.75;
  }
  .label-cell {
    font-size: 0.78rem;
    opacity: 0.85;
  }
  .sts-header {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .dispatched-banner {
    background: rgba(16, 185, 129, 0.1);
    border-left: 3px solid #10b981;
    padding: 0.4rem 0.6rem;
    font-size: 0.82rem;
    border-radius: 3px;
  }
  .filters {
    display: flex;
    gap: 0.7rem;
    align-items: center;
  }
  .filters label {
    display: flex;
    gap: 0.3rem;
    align-items: center;
    font-size: 0.8rem;
  }
  .filters select {
    font: inherit;
    padding: 0.2rem;
    background: transparent;
    color: inherit;
    border: 1px solid rgba(127, 127, 127, 0.35);
    border-radius: 3px;
  }
  .kpi-block {
    border-top: 1px solid rgba(127, 127, 127, 0.18);
    padding-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .sparkline {
    display: flex;
    gap: 2px;
    align-items: flex-end;
    height: 50px;
    padding: 0.2rem 0;
  }
  .spark-bar {
    flex: 1;
    min-width: 4px;
    background: linear-gradient(
      to top,
      rgba(239, 68, 68, 0.35),
      rgba(239, 68, 68, 0.9)
    );
    border-radius: 2px;
  }
  .spark-bar.retention {
    background: linear-gradient(
      to top,
      rgba(16, 185, 129, 0.35),
      rgba(16, 185, 129, 0.9)
    );
  }
  .transitions,
  .recall-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.8rem;
  }
  .recall-list li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  .outcome-badge {
    background: rgba(127, 127, 127, 0.2);
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .outcome-badge.positive {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
  }
  .outcome-badge.negative {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }
  .muted {
    opacity: 0.6;
  }
  .spec-ref {
    margin: 0;
    font-size: 0.78rem;
    opacity: 0.7;
  }
  .small {
    font-size: 0.78rem;
  }
  .error {
    color: #d97706;
  }
  .actions {
    margin-top: 0.4rem;
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  .action {
    padding: 0.3rem 0.7rem;
    background: transparent;
    border: 1px solid rgba(239, 68, 68, 0.6);
    border-radius: 4px;
    font: inherit;
    font-size: 0.8rem;
    color: inherit;
    cursor: pointer;
  }
  .action:hover {
    background: rgba(239, 68, 68, 0.12);
  }
  .action.primary {
    background: rgba(239, 68, 68, 0.18);
    font-weight: 600;
  }
  .xray {
    background: transparent;
    border: 1px solid rgba(239, 68, 68, 0.6);
    border-radius: 4px;
    padding: 0.4rem 0.8rem;
    font: inherit;
    font-size: 0.85rem;
    color: inherit;
    cursor: pointer;
  }
  .xray:hover {
    background: rgba(239, 68, 68, 0.12);
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.82em;
    background: rgba(127, 127, 127, 0.18);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
