<script lang="ts">
  /**
   * B2 — Drilling (panel).
   * Pergunta: "O motor está treinando automaticidades em [persona]?"
   *
   * Wiring (PR #244): consome BFF /banks, /banks/:id, /personas/:id/
   * drill-{state,due,mastered}. Mostra empty state quando persona não
   * tem drill ainda (primeiro turn dispara).
   */
  import { onMount } from "svelte";
  import { tracerSubjectId } from "../../lib/stores.js";
  import { createApiClient } from "../../lib/api.js";
  import type {
    ApiClient,
    DrillBankSummaryLike,
    DrillStateLike,
  } from "../../lib/api.js";
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";

  /** Cliente injetável pra testes. Default = createApiClient(). */
  export let api: ApiClient = createApiClient();

  const COLOR = "#6b7280";

  let loading = true;
  let error: string | null = null;
  let banks: DrillBankSummaryLike[] = [];
  let states: DrillStateLike[] = [];
  let due: DrillStateLike[] = [];
  let mastered: DrillStateLike[] = [];

  $: personaId = $tracerSubjectId;

  async function loadAll(persona: string): Promise<void> {
    loading = true;
    error = null;
    try {
      const [banksRes, statesRes, dueRes, masteredRes] = await Promise.all([
        api.listBanks(),
        api.listDrillStates(persona),
        api.listDrillDue(persona),
        api.listDrillMastered(persona),
      ]);
      banks = banksRes.banks;
      states = statesRes.states;
      due = dueRes.states;
      mastered = masteredRes.states;
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

  $: avgEasiness = (() => {
    if (states.length === 0) return null;
    const sum = states.reduce((a, s) => a + s.current_easiness, 0);
    return sum / states.length;
  })();

  $: retentionPct = (() => {
    if (states.length === 0) return null;
    const totalAttempts = states.reduce((a, s) => a + s.presented_count, 0);
    const totalCorrect = states.reduce((a, s) => a + s.correct_count, 0);
    if (totalAttempts === 0) return null;
    return (totalCorrect / totalAttempts) * 100;
  })();

  function attemptGlyph(r: string): string {
    if (r === "correct") return "✓";
    if (r === "slow_correct") return "~";
    if (r === "incorrect") return "✗";
    if (r === "timeout") return "⊘";
    return "?";
  }
</script>

<SubsystemPanelShell id="B2" title="Drilling (automaticidade)" color={COLOR}>
  {#if loading}
    <p class="status" data-testid="b2-loading">Carregando B2 para {personaId}…</p>
  {:else if error}
    <p class="status error" data-testid="b2-error">
      Erro ao carregar B2: {error}
    </p>
  {:else}
    <section class="block" data-testid="b2-banks-block">
      <h3>Banks ativos <span class="count">({banks.length})</span></h3>
      {#if banks.length === 0}
        <p class="empty">Nenhum bank registrado em fixtures/banks/.</p>
      {:else}
        <ul class="banks-list">
          {#each banks as bank (bank.bank_id)}
            <li>
              <strong>{bank.title}</strong>
              <code>{bank.bank_id}</code>
              <span class="muted small"
                >{bank.item_count} items · curator: {bank.curator}</span
              >
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="block" data-testid="b2-due-block">
      <h3>
        Due now <span class="count">({due.length})</span>
      </h3>
      {#if states.length === 0}
        <p class="empty" data-testid="b2-empty-state">
          Ainda sem drill pra {personaId} — primeiro turn dispara.
        </p>
      {:else if due.length === 0}
        <p class="empty">Nenhum item due no momento.</p>
      {:else}
        <table class="drill-table">
          <thead>
            <tr>
              <th>item</th>
              <th>next_due_at</th>
              <th>easiness</th>
              <th>últimas 5</th>
            </tr>
          </thead>
          <tbody>
            {#each due as s (s.item_id)}
              <tr>
                <td><code>{s.item_id}</code></td>
                <td><time>{s.next_due_at}</time></td>
                <td>{s.current_easiness.toFixed(2)}</td>
                <td class="attempts">
                  {#each s.last_5_attempts as r, i (i)}
                    <span class="attempt {r}">{attemptGlyph(r)}</span>
                  {/each}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section class="block" data-testid="b2-mastered-block">
      <h3>
        Mastered <span class="count">({mastered.length})</span>
      </h3>
      {#if mastered.length === 0}
        <p class="empty">Nenhum item mastered ainda.</p>
      {:else}
        <ul class="mastered-list">
          {#each mastered as s (s.item_id)}
            <li>
              <code>{s.item_id}</code>
              <span class="muted small"
                >mastered em {s.mastery_reached_at}</span
              >
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="block" data-testid="b2-stats-block">
      <h3>SR statistics</h3>
      {#if states.length === 0}
        <p class="empty">Stats indisponíveis — sem drill states.</p>
      {:else}
        <dl class="stats">
          <dt>items rastreados</dt>
          <dd>{states.length}</dd>
          <dt>avg easiness</dt>
          <dd>
            {avgEasiness !== null ? avgEasiness.toFixed(2) : "—"}
          </dd>
          <dt>retention rate</dt>
          <dd>
            {retentionPct !== null ? retentionPct.toFixed(1) + "%" : "—"}
          </dd>
        </dl>
      {/if}
    </section>
  {/if}
</SubsystemPanelShell>

<style>
  .status {
    font-size: 0.9rem;
    opacity: 0.8;
  }
  .status.error {
    color: #ef4444;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  h3 {
    margin: 0 0 0.3rem 0;
    font-size: 0.95rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
    padding-bottom: 0.2rem;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .count {
    font-size: 0.75rem;
    opacity: 0.6;
    font-weight: 400;
  }
  .empty {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.65;
    font-style: italic;
  }
  .banks-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .banks-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0.25rem 0;
    border-bottom: 1px solid rgba(127, 127, 127, 0.12);
  }
  .drill-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.78rem;
  }
  .drill-table th,
  .drill-table td {
    border-bottom: 1px solid rgba(127, 127, 127, 0.18);
    padding: 0.25rem 0.4rem;
    text-align: left;
  }
  .drill-table th {
    font-weight: 600;
    opacity: 0.75;
  }
  .attempts {
    display: flex;
    gap: 0.2rem;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  }
  .attempt {
    width: 1rem;
    text-align: center;
    border-radius: 2px;
    background: rgba(127, 127, 127, 0.15);
  }
  .attempt.correct {
    background: rgba(34, 197, 94, 0.25);
    color: #22c55e;
  }
  .attempt.slow_correct {
    background: rgba(234, 179, 8, 0.22);
    color: #ca8a04;
  }
  .attempt.incorrect {
    background: rgba(239, 68, 68, 0.22);
    color: #ef4444;
  }
  .attempt.timeout {
    background: rgba(107, 114, 128, 0.25);
  }
  .mastered-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .mastered-list li {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }
  .stats {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 0.8rem;
    row-gap: 0.2rem;
    margin: 0;
    font-size: 0.85rem;
  }
  .stats dt {
    opacity: 0.75;
  }
  .stats dd {
    margin: 0;
    font-weight: 600;
  }
  .muted {
    opacity: 0.7;
  }
  .small {
    font-size: 0.75rem;
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.78em;
    background: rgba(127, 127, 127, 0.15);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
  time {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.74rem;
    opacity: 0.85;
  }
</style>
