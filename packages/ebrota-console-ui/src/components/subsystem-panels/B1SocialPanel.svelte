<script lang="ts">
  /**
   * B1 — Camada Social (panel).
   * Pergunta: "Como o motor está atraindo/retendo [persona]?"
   *
   * Wiring (PR #243): consome BFF /personas/:id/{temporal-windows,
   * pulso-events, sacrifice-budget, cards, dyad}. Mantém placeholders
   * em stubs ainda não persistidos (dyad, pulso) com badge `(stub v0)`.
   */
  import { onMount } from "svelte";
  import { tracerSubjectId } from "../../lib/stores.js";
  import { createApiClient } from "../../lib/api.js";
  import type {
    ApiClient,
    EmittedCardLike,
    SacrificeBudgetSnapshotLike,
    TemporalWindowLike,
    PulsoEventLike,
    DyadConfigLike,
  } from "../../lib/api.js";
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";

  /** Cliente injetável pra testes. Default = createApiClient(). */
  export let api: ApiClient = createApiClient();

  const COLOR = "#8b5cf6";

  let loading = true;
  let error: string | null = null;
  let cards: EmittedCardLike[] = [];
  let budget: SacrificeBudgetSnapshotLike | null = null;
  let dyad: DyadConfigLike | null = null;
  let windows: TemporalWindowLike | null = null;
  let pulso: PulsoEventLike[] = [];

  $: personaId = $tracerSubjectId;

  async function loadAll(persona: string): Promise<void> {
    loading = true;
    error = null;
    try {
      const [cardsRes, budgetRes, dyadRes, windowsRes, pulsoRes] =
        await Promise.all([
          api.listEmittedCards(persona),
          api.getSacrificeBudget(persona),
          api.getDyad(persona),
          api.getTemporalWindows(persona),
          api.listPulsoEvents(persona),
        ]);
      cards = cardsRes.cards;
      budget = budgetRes;
      dyad = dyadRes;
      windows = windowsRes;
      pulso = pulsoRes.events;
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

  function budgetPercent(b: SacrificeBudgetSnapshotLike): number {
    if (b.baseline === 0) return 0;
    return Math.max(0, Math.min(100, (b.current / b.baseline) * 100));
  }

  function formatCardTitle(c: EmittedCardLike): string {
    const t = c.front?.title;
    if (typeof t === "string" && t.length > 0) return t;
    return c.archetype_id;
  }
</script>

<SubsystemPanelShell id="B1" title="Camada Social" color={COLOR}>
  {#if loading}
    <p class="status" data-testid="b1-loading">Carregando dados de {personaId}…</p>
  {:else if error}
    <p class="status error" data-testid="b1-error">
      Erro ao carregar B1: {error}
    </p>
  {:else}
    <section class="block" data-testid="b1-cards-block">
      <h3>Cards emitidos <span class="count">({cards.length})</span></h3>
      {#if cards.length === 0}
        <p class="empty">Nenhum card emitido ainda pra {personaId}.</p>
      {:else}
        <div class="cards-grid">
          {#each cards as card (card.card_id)}
            <article class="card" data-testid="b1-card">
              <header class="card-header">
                <span class="rarity" title="rarity"
                  >{card.front?.rarity ?? "—"}</span
                >
                <span class="archetype">{card.archetype_id}</span>
              </header>
              <h4 class="card-title">{formatCardTitle(card)}</h4>
              <div class="card-meta">
                <code class="serial"
                  >{card.back?.serial_number ?? card.card_id}</code
                >
                {#if card.back?.cheat_code}
                  <code class="cheat" title="cheat-code"
                    >{card.back.cheat_code}</code
                  >
                {/if}
              </div>
              <div class="qr" aria-hidden="true">QR</div>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="block" data-testid="b1-budget-block">
      <h3>
        Sacrifice budget
        {#if budget?.source === "stub_v0"}
          <span class="badge-stub">stub v0</span>
        {/if}
      </h3>
      {#if budget}
        <div class="budget-row">
          <div class="gauge">
            <div
              class="gauge-fill"
              style:width={budgetPercent(budget) + "%"}
            ></div>
          </div>
          <span class="budget-numeric"
            >{budget.current} / {budget.baseline}</span
          >
        </div>
        <ul class="modifiers">
          {#each budget.modifiers as m, i (i)}
            <li class:active={m.active}>
              <span class="dot" class:on={m.active}></span>
              {m.label}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="block" data-testid="b1-dyad-block">
      <h3>
        Dyad
        {#if dyad?.source === "stub_v0"}
          <span class="badge-stub">stub v0</span>
        {/if}
      </h3>
      {#if dyad?.dyad === null}
        <p class="empty">Sem dyad ativo no momento.</p>
      {:else if dyad?.dyad}
        <pre class="json">{JSON.stringify(dyad.dyad, null, 2)}</pre>
      {/if}
    </section>

    <section class="block" data-testid="b1-windows-block">
      <h3>Janelas temporais</h3>
      {#if windows === null}
        <p class="empty">
          Sem fixture <code>fixtures/temporal-windows/{personaId}.yaml</code>.
        </p>
      {:else}
        <p class="muted small">
          timezone: <code>{windows.timezone}</code>
        </p>
        <table class="windows">
          <thead>
            <tr>
              <th>nome</th>
              <th>dias</th>
              <th>início</th>
              <th>fim</th>
              <th>cap/dia</th>
              <th>parental?</th>
            </tr>
          </thead>
          <tbody>
            {#each windows.windows as w (w.name)}
              <tr>
                <td>{w.name}</td>
                <td>{w.weekday.join(", ")}</td>
                <td><code>{w.start_local}</code></td>
                <td><code>{w.end_local}</code></td>
                <td>{w.max_hooks_per_day}</td>
                <td>{w.requires_parental_ok ? "sim" : "não"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if windows.school_window || windows.sleep_window}
          <p class="muted small">
            exclusões —
            {#if windows.school_window}
              escola <code
                >{windows.school_window.start_local}–{windows.school_window
                  .end_local}</code
              >
            {/if}
            {#if windows.school_window && windows.sleep_window} · {/if}
            {#if windows.sleep_window}
              sono <code
                >{windows.sleep_window.start_local}–{windows.sleep_window
                  .end_local}</code
              >
            {/if}
          </p>
        {/if}
      {/if}
    </section>

    <section class="block" data-testid="b1-pulso-block">
      <h3>
        Pulso events
        <span class="badge-stub">stub v0</span>
      </h3>
      {#if pulso.length === 0}
        <p class="empty">
          Sem eventos pulso ainda (persistência pendente — scheduler
          ainda não loga emissões).
        </p>
      {:else}
        <ul class="pulso-list">
          {#each pulso as ev, i (i)}
            <li>
              <time>{ev.emitted_at}</time>
              <span class="trigger">{ev.trigger}</span>
              <span class="text">{ev.text}</span>
            </li>
          {/each}
        </ul>
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
  .badge-stub {
    font-size: 0.65rem;
    background: rgba(139, 92, 246, 0.18);
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #a78bfa;
    font-weight: 600;
  }
  .empty {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.65;
    font-style: italic;
  }
  .cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.6rem;
  }
  .card {
    border: 1px solid rgba(139, 92, 246, 0.4);
    border-left: 3px solid #8b5cf6;
    border-radius: 5px;
    padding: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    background: rgba(139, 92, 246, 0.04);
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
    opacity: 0.75;
  }
  .rarity {
    font-weight: 700;
    text-transform: uppercase;
    color: #a78bfa;
  }
  .card-title {
    margin: 0;
    font-size: 0.88rem;
    font-weight: 600;
  }
  .card-meta {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .serial {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.7rem;
    opacity: 0.75;
  }
  .cheat {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.72rem;
    background: rgba(127, 127, 127, 0.18);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    align-self: flex-start;
  }
  .qr {
    align-self: flex-start;
    width: 28px;
    height: 28px;
    border: 1px dashed rgba(139, 92, 246, 0.5);
    border-radius: 3px;
    font-size: 0.6rem;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6;
  }
  .budget-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .gauge {
    flex: 1;
    height: 12px;
    background: rgba(127, 127, 127, 0.18);
    border-radius: 6px;
    overflow: hidden;
  }
  .gauge-fill {
    height: 100%;
    background: linear-gradient(to right, #8b5cf6, #a78bfa);
    transition: width 0.2s;
  }
  .budget-numeric {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .modifiers {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .modifiers li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    opacity: 0.55;
  }
  .modifiers li.active {
    opacity: 1;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(127, 127, 127, 0.3);
  }
  .dot.on {
    background: #8b5cf6;
  }
  .json {
    margin: 0;
    font-size: 0.78rem;
    background: rgba(127, 127, 127, 0.12);
    padding: 0.4rem;
    border-radius: 3px;
    overflow: auto;
  }
  .windows {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.78rem;
  }
  .windows th,
  .windows td {
    border-bottom: 1px solid rgba(127, 127, 127, 0.18);
    padding: 0.25rem 0.4rem;
    text-align: left;
  }
  .windows th {
    font-weight: 600;
    opacity: 0.75;
  }
  .muted {
    opacity: 0.65;
  }
  .small {
    font-size: 0.75rem;
    margin: 0;
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.78em;
    background: rgba(127, 127, 127, 0.15);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
  .pulso-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .pulso-list li {
    display: grid;
    grid-template-columns: max-content max-content 1fr;
    gap: 0.5rem;
    align-items: baseline;
    font-size: 0.82rem;
  }
  .pulso-list time {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.7rem;
    opacity: 0.7;
  }
  .trigger {
    font-size: 0.7rem;
    opacity: 0.75;
    text-transform: uppercase;
  }
</style>
