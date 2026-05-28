<script lang="ts">
  /**
   * S4 — Motor de Expressão (panel agregado por persona).
   * Pergunta: "Como o motor está falando (custo, latência, qualidade)?"
   *
   * 3 blocos:
   *   - Metrics card (cache hit, fallback, avg latency, avg cost, byModel)
   *   - Tactic distribution (collapsible — só visível se split ativo)
   *   - Recent samples (last N — table com final_text truncado + badges)
   *
   * Data source: BFF /personas/:id/expression-{metrics,samples} +
   * /personas/:id/tactic-decision-distribution (engineTrace v2 agregado).
   */
  import { onMount } from "svelte";
  import { tracerSubjectId } from "../../lib/stores.js";
  import { createApiClient } from "../../lib/api.js";
  import type {
    ApiClient,
    ExpressionMetricsLike,
    TacticDecisionDistributionLike,
    ExpressionSampleLike,
  } from "../../lib/api.js";
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";

  /** Cliente injetável pra testes. Default = createApiClient(). */
  export let api: ApiClient = createApiClient();

  const COLOR = "#f97316";
  const SAMPLE_LIMIT = 10;
  const TRUNCATE_CHARS = 80;

  let loading = true;
  let error: string | null = null;
  let metrics: ExpressionMetricsLike | null = null;
  let distribution: TacticDecisionDistributionLike | null = null;
  let samples: ExpressionSampleLike[] = [];
  let samplesStub = false;
  let distributionOpen = false;
  let expandedSampleRef: string | null = null;

  $: personaId = $tracerSubjectId;

  async function loadAll(persona: string): Promise<void> {
    loading = true;
    error = null;
    try {
      const [m, d, s] = await Promise.all([
        api.getExpressionMetrics(persona),
        api.getTacticDecisionDistribution(persona),
        api.getExpressionSamples(persona, SAMPLE_LIMIT),
      ]);
      metrics = m;
      distribution = d;
      samples = s.samples;
      samplesStub = s.developmentStub;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void loadAll(personaId);
  });

  $: if (personaId) void loadAll(personaId);

  function pct(rate: number): string {
    return `${(rate * 100).toFixed(1)}%`;
  }
  function fmtMs(ms: number): string {
    return `${Math.round(ms)}ms`;
  }
  function fmtCostPer1k(usd: number): string {
    // avgCostUsd é per-call; multiplica por 1000 pra dar dimensão visível.
    return `$${(usd * 1000).toFixed(3)}/1k`;
  }
  function fmtTokens(n: number): string {
    return Math.round(n).toString();
  }
  function truncate(text: string): string {
    if (text.length <= TRUNCATE_CHARS) return text;
    return `${text.slice(0, TRUNCATE_CHARS)}…`;
  }
  function toggleSample(turnRef: string): void {
    expandedSampleRef = expandedSampleRef === turnRef ? null : turnRef;
  }
</script>

<SubsystemPanelShell id="S4" title="Motor de Expressão" color={COLOR}>
  {#if loading}
    <p class="empty" data-testid="s4-loading">Carregando métricas…</p>
  {:else if error !== null}
    <p class="error" data-testid="s4-error">Erro: {error}</p>
  {:else}
    <!-- Metrics card -->
    <section class="block" data-testid="s4-metrics-block">
      <h3>
        Métricas de geração
        {#if metrics?.developmentStub === true}
          <span class="badge stub" title="Sem engineTrace v2 ainda — wiring pendente">
            stub_v0
          </span>
        {/if}
      </h3>
      {#if metrics === null || metrics.totalTurns === 0}
        <p class="muted">Sem turnos registrados pra esta persona.</p>
      {:else}
        <dl class="metrics-grid">
          <div class="metric">
            <dt>Total turns</dt>
            <dd>{metrics.totalTurns}</dd>
          </div>
          <div class="metric">
            <dt>Cache hit</dt>
            <dd data-testid="s4-cache-hit">{pct(metrics.cacheHitRate)}</dd>
          </div>
          <div class="metric">
            <dt>Fallback rate</dt>
            <dd data-testid="s4-fallback-rate">{pct(metrics.fallbackRate)}</dd>
          </div>
          <div class="metric">
            <dt>Avg latency</dt>
            <dd data-testid="s4-avg-latency">{fmtMs(metrics.avgLatencyMs)}</dd>
          </div>
          <div class="metric">
            <dt>Avg cost</dt>
            <dd data-testid="s4-avg-cost">{fmtCostPer1k(metrics.avgCostUsd)}</dd>
          </div>
          <div class="metric">
            <dt>Tokens in / out</dt>
            <dd>
              {fmtTokens(metrics.avgTokensIn)} / {fmtTokens(metrics.avgTokensOut)}
            </dd>
          </div>
          <div class="metric">
            <dt>Sanitize</dt>
            <dd>{pct(metrics.sanitizationAppliedRate)}</dd>
          </div>
          <div class="metric">
            <dt>Retried (fallback)</dt>
            <dd>{pct(metrics.retriedWithFallbackRate)}</dd>
          </div>
        </dl>

        {#if Object.keys(metrics.byModel).length > 0}
          <div class="by-model" data-testid="s4-by-model">
            <h4>Por modelo</h4>
            <ul>
              {#each Object.entries(metrics.byModel) as [model, data]}
                <li>
                  <code>{model}</code>
                  — {data.calls} calls · avg {fmtMs(data.avgLatencyMs)}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {/if}
    </section>

    <!-- Tactic distribution (collapsible) -->
    {#if distribution !== null}
      <section class="block" data-testid="s4-tactic-block">
        <button
          type="button"
          class="collapse-btn"
          on:click={() => (distributionOpen = !distributionOpen)}
          data-testid="s4-tactic-toggle"
        >
          {distributionOpen ? "▼" : "▶"} Tactic distribution
          {#if !distribution.splitDrotaActive}
            <span class="badge stub">USE_SPLIT_DROTA=false</span>
          {:else}
            <span class="count">({distribution.totalDecisions} decisões)</span>
          {/if}
        </button>
        {#if distributionOpen}
          {#if !distribution.splitDrotaActive}
            <p class="muted">
              Split Drota inativo — Tactician não emite TacticDecision nos
              traces atuais. Ative com env <code>USE_SPLIT_DROTA=true</code>
              no orchestrator.
            </p>
          {:else}
            <div class="dist-row">
              <h4>Por jogada</h4>
              <ul>
                {#each Object.entries(distribution.byJogada) as [k, v]}
                  <li><code>{k}</code> — {v}</li>
                {/each}
              </ul>
            </div>
            <div class="dist-row">
              <h4>Por register</h4>
              <ul>
                {#each Object.entries(distribution.byRegister) as [k, v]}
                  <li><code>{k}</code> — {v}</li>
                {/each}
              </ul>
            </div>
            <div class="dist-row">
              <h4>Por method</h4>
              <ul>
                {#each Object.entries(distribution.byMethod) as [k, v]}
                  <li><code>{k}</code> — {v}</li>
                {/each}
              </ul>
            </div>
            <div class="dist-row averages">
              avg angle: {distribution.averages.angleCharsAvg.toFixed(0)} chars
              · avg max_length: {distribution.averages.maxLengthCharsAvg.toFixed(0)} chars
            </div>
          {/if}
        {/if}
      </section>
    {/if}

    <!-- Recent samples -->
    <section class="block" data-testid="s4-samples-block">
      <h3>
        Últimas amostras
        {#if samplesStub}
          <span class="badge stub">stub_v0</span>
        {/if}
      </h3>
      {#if samples.length === 0}
        <p class="muted">Sem amostras de fala ainda.</p>
      {:else}
        <table class="samples">
          <thead>
            <tr>
              <th>turn_ref</th>
              <th>final_text</th>
              <th>model</th>
              <th>latency</th>
              <th>badges</th>
            </tr>
          </thead>
          <tbody>
            {#each samples as s (s.turnRef)}
              <tr
                class="sample-row"
                class:expanded={expandedSampleRef === s.turnRef}
                on:click={() => toggleSample(s.turnRef)}
                data-testid="s4-sample-row"
              >
                <td class="ref"><code>{s.turnRef}</code></td>
                <td class="text">
                  {#if expandedSampleRef === s.turnRef}
                    <span data-testid="s4-sample-full">{s.finalText}</span>
                  {:else}
                    {truncate(s.finalText)}
                  {/if}
                </td>
                <td class="model">
                  {#if s.model !== null}<code>{s.model}</code>{:else}—{/if}
                </td>
                <td>{s.latencyMs !== null ? fmtMs(s.latencyMs) : "—"}</td>
                <td class="badges-cell">
                  {#if s.jogada !== null}
                    <span class="badge jogada">{s.jogada}</span>
                  {/if}
                  {#if s.fallbackTriggered}
                    <span class="badge fallback" title="speaker retried_with_fallback">
                      fallback
                    </span>
                  {/if}
                  {#if s.sanitizationApplied}
                    <span class="badge sanitize">sanitize</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}
</SubsystemPanelShell>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 1rem;
  }
  h3 {
    margin: 0 0 0.3rem 0;
    font-size: 0.95rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
    padding-bottom: 0.2rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  h4 {
    margin: 0.4rem 0 0.2rem 0;
    font-size: 0.82rem;
    opacity: 0.8;
  }
  .empty,
  .error,
  .muted {
    margin: 0;
    font-size: 0.88rem;
    opacity: 0.75;
  }
  .error {
    color: #ef4444;
  }
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.5rem;
    margin: 0;
  }
  .metric {
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-left: 3px solid #f97316;
    border-radius: 4px;
    padding: 0.4rem 0.6rem;
  }
  .metric dt {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.65;
    margin-bottom: 0.15rem;
  }
  .metric dd {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .by-model {
    margin-top: 0.4rem;
  }
  .by-model ul,
  .dist-row ul {
    margin: 0;
    padding-left: 1.2rem;
    font-size: 0.82rem;
  }
  .collapse-btn {
    align-self: flex-start;
    background: transparent;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 4px;
    padding: 0.3rem 0.6rem;
    font: inherit;
    font-size: 0.85rem;
    color: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .dist-row {
    padding: 0.3rem 0.4rem;
    background: rgba(127, 127, 127, 0.08);
    border-radius: 4px;
  }
  .dist-row.averages {
    font-size: 0.82rem;
    opacity: 0.85;
  }
  .count {
    font-size: 0.75rem;
    opacity: 0.7;
  }
  .badge {
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    border: 1px solid rgba(127, 127, 127, 0.4);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .badge.stub {
    color: #d97706;
    border-color: rgba(217, 119, 6, 0.5);
  }
  .badge.fallback {
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.5);
  }
  .badge.sanitize {
    color: #6366f1;
    border-color: rgba(99, 102, 241, 0.5);
  }
  .badge.jogada {
    color: #10b981;
    border-color: rgba(16, 185, 129, 0.5);
  }
  table.samples {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }
  table.samples th {
    text-align: left;
    font-weight: 600;
    border-bottom: 1px solid rgba(127, 127, 127, 0.3);
    padding: 0.3rem 0.4rem;
    opacity: 0.7;
  }
  table.samples td {
    padding: 0.3rem 0.4rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.15);
    vertical-align: top;
  }
  .sample-row {
    cursor: pointer;
  }
  .sample-row:hover {
    background: rgba(249, 115, 22, 0.08);
  }
  .sample-row.expanded {
    background: rgba(249, 115, 22, 0.12);
  }
  td.text {
    max-width: 380px;
    word-break: break-word;
  }
  td.ref code,
  td.model code {
    font-size: 0.72rem;
  }
  .badges-cell {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.82em;
    background: rgba(127, 127, 127, 0.18);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
