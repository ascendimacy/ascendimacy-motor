<script lang="ts">
  /**
   * S3 — Motor de Decisão (panel, per-persona aggregate).
   * Pergunta: "Como persona X tem decidido ao longo das sessões?"
   *
   * 3 sub-blocks:
   *   - Decision history table (colapsável, click-expand pra detalhes)
   *   - Jogada histogram (bar chart CSS, no lib externa)
   *   - Stats card (totais agregados)
   *
   * Per-turn drill-down → S3DecisaoTurnPanel (vive separado, mesmo COLOR).
   *
   * Spec: docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md
   */
  import { currentSessionId, tracerSubjectId } from "../../lib/stores.js";
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";
  import {
    createApiClient,
    type ApiClient,
    type DecisionRowLike,
    type JogadaDistributionLike,
    type DecisionStatsLike,
  } from "../../lib/api.js";

  export let api: ApiClient = createApiClient();

  const COLOR = "#eab308";

  type LoadState = "idle" | "loading" | "loaded" | "error";

  function derivePersonaId(sessionId: string | null, fallback: string): string {
    if (sessionId === null || sessionId.length === 0) return fallback;
    const idx = sessionId.indexOf("__");
    return idx > 0 ? sessionId.slice(0, idx) : sessionId;
  }

  $: personaId = derivePersonaId($currentSessionId, $tracerSubjectId);

  let historyState: LoadState = "idle";
  let history: DecisionRowLike[] = [];
  let historyError = "";

  let distState: LoadState = "idle";
  let distribution: JogadaDistributionLike | null = null;

  let statsState: LoadState = "idle";
  let stats: DecisionStatsLike | null = null;

  let expandedRow: string | null = null;

  function toggleRow(ref: string): void {
    expandedRow = expandedRow === ref ? null : ref;
  }

  async function loadHistory(pid: string): Promise<void> {
    historyState = "loading";
    try {
      const res = await api.getDecisionHistory(pid, 20);
      history = res.decisions;
      historyState = "loaded";
    } catch (err) {
      historyError = err instanceof Error ? err.message : String(err);
      historyState = "error";
    }
  }

  async function loadDistribution(pid: string): Promise<void> {
    distState = "loading";
    try {
      distribution = await api.getJogadaDistribution(pid);
      distState = "loaded";
    } catch {
      distState = "error";
    }
  }

  async function loadStats(pid: string): Promise<void> {
    statsState = "loading";
    try {
      stats = await api.getDecisionStats(pid);
      statsState = "loaded";
    } catch {
      statsState = "error";
    }
  }

  let lastLoadedFor = "";
  $: if (personaId !== "" && personaId !== lastLoadedFor) {
    lastLoadedFor = personaId;
    void loadHistory(personaId);
    void loadDistribution(personaId);
    void loadStats(personaId);
  }

  function formatRate(v: number): string {
    return `${Math.round(v * 100)}%`;
  }

  function formatScore(v: number | null): string {
    return v === null ? "—" : v.toFixed(2);
  }

  function jogadaBarWidth(count: number, max: number): string {
    if (max === 0) return "0%";
    return `${Math.round((count / max) * 100)}%`;
  }

  $: histogramMax = distribution
    ? Math.max(1, ...Object.values(distribution.byJogada))
    : 1;
</script>

<SubsystemPanelShell id="S3" title="Motor de Decisão (histórico)" color={COLOR}>
  <section class="block" data-testid="s3-history">
    <h3>Histórico de decisões</h3>
    {#if historyState === "loading"}
      <p class="muted small" data-testid="s3-history-loading">carregando…</p>
    {:else if historyState === "error"}
      <p class="error small" data-testid="s3-history-error">
        erro: {historyError}
      </p>
    {:else if history.length === 0}
      <p class="muted small" data-testid="s3-history-empty">
        Persona ainda não tem decisões registradas
      </p>
    {:else}
      <table class="history-table" data-testid="s3-history-table">
        <thead>
          <tr>
            <th>turn</th>
            <th>jogada</th>
            <th>method</th>
            <th>item</th>
            <th>score</th>
          </tr>
        </thead>
        <tbody>
          {#each history as row (row.turnRef)}
            <tr
              class="history-row"
              class:expanded={expandedRow === row.turnRef}
              on:click={() => toggleRow(row.turnRef)}
              data-testid="s3-history-row"
            >
              <td><code>{row.turnRef.split("__turn_")[1] ?? "?"}</code></td>
              <td>{row.tacticDecision?.jogada ?? "—"}</td>
              <td>{row.tacticDecision?.method ?? "—"}</td>
              <td class="item-cell"><code>{row.selectedItemId}</code></td>
              <td>{formatScore(row.selectedScore)}</td>
            </tr>
            {#if expandedRow === row.turnRef}
              <tr class="history-detail" data-testid="s3-history-detail">
                <td colspan="5">
                  <dl>
                    <dt>decisionPath</dt>
                    <dd><code>{row.decisionPath}</code></dd>
                    <dt>poolSize</dt>
                    <dd>{row.poolSize}</dd>
                    <dt>topNScores</dt>
                    <dd>{row.topNScores.map((s) => s.toFixed(2)).join(", ")}</dd>
                    <dt>cacheHit</dt>
                    <dd>{row.cacheHit ? "✓" : "✗"}</dd>
                    {#if row.skipReason !== null}
                      <dt>skipReason</dt>
                      <dd><code>{row.skipReason}</code></dd>
                    {/if}
                    {#if row.tacticDecision !== null}
                      <dt>angle</dt>
                      <dd>{row.tacticDecision.angle}</dd>
                      <dt>register</dt>
                      <dd>{row.tacticDecision.register}</dd>
                    {/if}
                  </dl>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <section class="block" data-testid="s3-histogram">
    <h3>Jogada distribution</h3>
    {#if distState === "loading"}
      <p class="muted small">carregando…</p>
    {:else if distribution !== null}
      {#if distribution.developmentStub}
        <p class="muted small" data-testid="s3-histogram-stub">
          sem decisões agregáveis (tactic_decision ausente)
        </p>
      {/if}
      <div class="histogram" data-testid="s3-histogram-bars">
        {#each Object.entries(distribution.byJogada) as [name, count] (name)}
          <div class="bar-row" data-testid="s3-bar-{name}">
            <span class="bar-label">{name}</span>
            <div class="bar-track">
              <div
                class="bar-fill"
                style:width={jogadaBarWidth(count, histogramMax)}
              ></div>
            </div>
            <span class="bar-count">{count}</span>
          </div>
        {/each}
      </div>
      <p class="small muted" data-testid="s3-histogram-meta">
        total decisões: <strong>{distribution.totalDecisions}</strong>
        · rule: {distribution.byMethod.rule}
        · llm: {distribution.byMethod.llm}
        · fallback: {distribution.byMethod.fallback}
      </p>
    {/if}
  </section>

  <section class="block stats-block" data-testid="s3-stats">
    <h3>Stats</h3>
    {#if statsState === "loading"}
      <p class="muted small">carregando…</p>
    {:else if stats !== null}
      <div class="stats-grid">
        <div class="stat">
          <span class="stat-label">total turns</span>
          <span class="stat-value">{stats.totalTurns}</span>
        </div>
        <div class="stat">
          <span class="stat-label">cache hit</span>
          <span class="stat-value">{formatRate(stats.cacheHitRate)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">fallback</span>
          <span class="stat-value">{formatRate(stats.fallbackRate)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">avg pool</span>
          <span class="stat-value">{stats.avgPoolSize.toFixed(1)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">avg top score</span>
          <span class="stat-value">{stats.avgTopScore.toFixed(2)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">escalations</span>
          <span class="stat-value">{stats.selectorEscalations}</span>
        </div>
      </div>
    {/if}
  </section>
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
  .muted {
    opacity: 0.6;
  }
  .small {
    font-size: 0.78rem;
  }
  .error {
    color: #d97706;
  }

  .history-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  .history-table th,
  .history-table td {
    text-align: left;
    padding: 0.25rem 0.4rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.18);
  }
  .history-table th {
    font-weight: 600;
    opacity: 0.75;
  }
  .history-row {
    cursor: pointer;
  }
  .history-row:hover {
    background: rgba(234, 179, 8, 0.08);
  }
  .history-row.expanded {
    background: rgba(234, 179, 8, 0.12);
  }
  .item-cell {
    font-size: 0.75rem;
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .history-detail dl {
    display: grid;
    grid-template-columns: 8rem 1fr;
    gap: 0.2rem 0.5rem;
    margin: 0.3rem 0;
    font-size: 0.78rem;
  }
  .history-detail dt {
    opacity: 0.65;
    font-weight: 500;
  }
  .history-detail dd {
    margin: 0;
  }

  .histogram {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .bar-row {
    display: grid;
    grid-template-columns: 5rem 1fr 2rem;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.78rem;
  }
  .bar-label {
    opacity: 0.85;
  }
  .bar-track {
    background: rgba(127, 127, 127, 0.18);
    height: 14px;
    border-radius: 3px;
    overflow: hidden;
  }
  .bar-fill {
    background: linear-gradient(
      to right,
      rgba(234, 179, 8, 0.5),
      rgba(234, 179, 8, 0.95)
    );
    height: 100%;
    transition: width 0.2s ease;
  }
  .bar-count {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.4rem;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid rgba(127, 127, 127, 0.2);
    border-radius: 4px;
    background: rgba(234, 179, 8, 0.05);
  }
  .stat-label {
    font-size: 0.72rem;
    opacity: 0.7;
  }
  .stat-value {
    font-size: 1rem;
    font-weight: 600;
    color: #eab308;
    font-variant-numeric: tabular-nums;
  }

  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.82em;
    background: rgba(127, 127, 127, 0.18);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
