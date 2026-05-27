<script lang="ts">
  /**
   * S1 — Modelo do Aprendiz (panel).
   * Pergunta: "O que o motor crê sobre [persona] agora?"
   *
   * Consome BFF:
   *   - GET /personas/:id/objectives          (declared objectives)
   *   - GET /personas/:id/objectives/:id/history
   *   - GET /personas/:id/narrative-threads   (B1)
   *   - GET /personas/:id/subject-knowledge   (agregado ledger)
   *
   * Persona ativa derivada de `$currentSessionId` (formato
   * `${persona_id}__${conversation_id}`). Quando vazio, mostra empty
   * state. Fallback gracioso pra placeholders quando endpoint falha.
   *
   * Spec parent: docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md
   */

  import {
    mapsPanelOpen,
    discoveriesPanelOpen,
    tracerSubjectId,
    currentSessionId,
  } from "../../lib/stores.js";
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";
  import PlaceholderBanner from "./PlaceholderBanner.svelte";
  import {
    createApiClient,
    type ApiClient,
    type DeclaredObjectiveLike,
    type NarrativeThreadLike,
    type SubjectKnowledgeSummary,
  } from "../../lib/api.js";

  /** Permite injetar mock em testes; default = real BFF client. */
  export let api: ApiClient = createApiClient();

  const COLOR = "#3b82f6";

  function openMaps(): void {
    mapsPanelOpen.set(true);
  }
  function openDiscoveries(): void {
    discoveriesPanelOpen.set(true);
  }

  /** SessionId = `${personaId}__${conversationId}`. Quando null, cai
   *  no tracerSubjectId (default ryo-ochiai) pra ainda mostrar algo. */
  function derivePersonaId(sessionId: string | null, fallback: string): string {
    if (sessionId === null || sessionId.length === 0) return fallback;
    const idx = sessionId.indexOf("__");
    return idx > 0 ? sessionId.slice(0, idx) : sessionId;
  }

  $: personaId = derivePersonaId($currentSessionId, $tracerSubjectId);

  type LoadState = "idle" | "loading" | "loaded" | "error";

  let objectivesState: LoadState = "idle";
  let objectives: DeclaredObjectiveLike[] = [];
  let objectivesError = "";

  let threadsState: LoadState = "idle";
  let threads: NarrativeThreadLike[] = [];
  let threadsError = "";

  let skState: LoadState = "idle";
  let sk: SubjectKnowledgeSummary | null = null;
  let skError = "";

  let expandedObjectiveId: string | null = null;
  let historyTrail: DeclaredObjectiveLike[] = [];
  let historyLoading = false;
  let historyError = "";

  async function loadObjectives(pid: string): Promise<void> {
    objectivesState = "loading";
    try {
      const res = await api.getDeclaredObjectives(pid);
      objectives = res.objectives;
      objectivesState = "loaded";
    } catch (err) {
      objectivesError = err instanceof Error ? err.message : String(err);
      objectivesState = "error";
    }
  }

  async function loadThreads(pid: string): Promise<void> {
    threadsState = "loading";
    try {
      const res = await api.getNarrativeThreads(pid);
      threads = res.threads;
      threadsState = "loaded";
    } catch (err) {
      threadsError = err instanceof Error ? err.message : String(err);
      threadsState = "error";
    }
  }

  async function loadSubjectKnowledge(pid: string): Promise<void> {
    skState = "loading";
    try {
      sk = await api.getSubjectKnowledge(pid);
      skState = "loaded";
    } catch (err) {
      skError = err instanceof Error ? err.message : String(err);
      skState = "error";
    }
  }

  async function toggleHistory(objectiveId: string): Promise<void> {
    if (expandedObjectiveId === objectiveId) {
      expandedObjectiveId = null;
      historyTrail = [];
      return;
    }
    expandedObjectiveId = objectiveId;
    historyLoading = true;
    historyError = "";
    historyTrail = [];
    try {
      const res = await api.getObjectiveHistory(personaId, objectiveId);
      historyTrail = res.trail;
    } catch (err) {
      historyError = err instanceof Error ? err.message : String(err);
    } finally {
      historyLoading = false;
    }
  }

  // Trigger inicial + re-fetch quando persona muda. Reactive `$:` dispara
  // em init e em cada change; o tracking via `lastLoadedFor` impede loop.
  let lastLoadedFor = "";
  $: if (personaId !== "" && personaId !== lastLoadedFor) {
    lastLoadedFor = personaId;
    void loadObjectives(personaId);
    void loadThreads(personaId);
    void loadSubjectKnowledge(personaId);
  }

  function formatRelative(iso: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return iso;
    const diffMs = t - Date.now();
    const absDays = Math.round(Math.abs(diffMs) / 86_400_000);
    if (absDays === 0) return "hoje";
    if (diffMs > 0) return absDays === 1 ? "amanhã" : `em ${absDays}d`;
    return absDays === 1 ? "ontem" : `há ${absDays}d`;
  }

  function formatRate(rate: number | null, total: number): string {
    if (rate === null) return "—";
    return `${Math.round(rate * 100)}% (${total} attempts)`;
  }
</script>

<SubsystemPanelShell id="S1" title="Modelo do Aprendiz" color={COLOR}>
  <section class="block">
    <h3>Identity</h3>
    <dl class="identity">
      <dt>persona_id</dt><dd>{personaId}</dd>
      <dt>age</dt><dd>— <span class="muted">(v0 hardcoded)</span></dd>
      <dt>language</dt><dd>pt-BR · ja</dd>
      <dt>household</dt><dd>— <span class="muted">(v0 hardcoded)</span></dd>
      <dt>parental_telos</dt><dd>— <span class="muted">(v0 hardcoded)</span></dd>
    </dl>
  </section>

  <section class="block">
    <h3>Competências (CASEL × Dreyfus + Tree + Helix)</h3>
    <p class="hint">
      Visualização ao vivo via <code>MapsPanel</code> (Status bar → 🗺️).
    </p>
    <button type="button" class="action" on:click={openMaps}>
      Abrir MapsPanel
    </button>
  </section>

  <section class="block" data-testid="s1-subject-knowledge">
    <h3>Subject Knowledge</h3>
    {#if skState === "loading"}
      <p class="muted small" data-testid="sk-loading">carregando ledger…</p>
    {:else if skState === "error"}
      <p class="error small" data-testid="sk-error">
        falha ao carregar ledger: {skError}
      </p>
      <PlaceholderBanner
        label="ledger indisponível — fallback"
        specPath="docs/specs/2026-05-25-subject-knowledge-bridge.md"
        color={COLOR}
      />
    {:else if sk !== null && (sk.conceptsPresentedCount > 0 || sk.recallTotal > 0)}
      <ul class="sk-stats" data-testid="sk-stats">
        <li>
          <span class="sk-label">presented</span>
          <span class="sk-value">{sk.conceptsPresentedCount}</span>
        </li>
        <li>
          <span class="sk-label">recall+</span>
          <span class="sk-value">{formatRate(sk.recallPositiveRate, sk.recallTotal)}</span>
        </li>
      </ul>
      {#if sk.topConcepts.length > 0}
        <ol class="top-concepts" data-testid="sk-top-concepts">
          {#each sk.topConcepts as c (c.concept_id)}
            <li>
              <code>{c.concept_id}</code>
              <span class="muted small">×{c.presentedCount} · {formatRelative(c.lastSeenAt)}</span>
            </li>
          {/each}
        </ol>
      {/if}
    {:else}
      <p class="muted small" data-testid="sk-empty">
        nenhum conceito apresentado ainda
      </p>
    {/if}
    <p class="hint">
      Detalhes via <code>DiscoveriesPanel</code> (Status bar → 🔍).
    </p>
    <button type="button" class="action" on:click={openDiscoveries}>
      Abrir DiscoveriesPanel
    </button>
  </section>

  <section class="block">
    <h3>Mood</h3>
    <div class="sparkline-placeholder" aria-hidden="true">
      <span class="bar" style="height:30%"></span>
      <span class="bar" style="height:55%"></span>
      <span class="bar" style="height:70%"></span>
      <span class="bar" style="height:60%"></span>
      <span class="bar" style="height:75%"></span>
    </div>
    <p class="muted small">
      sparkline placeholder — TODO link com trace v2 (US-S1-04)
    </p>
  </section>

  <section class="block" data-testid="s1-objectives">
    <h3>Objetivos declarados</h3>
    {#if objectivesState === "loading"}
      <p class="muted small" data-testid="objectives-loading">carregando…</p>
    {:else if objectivesState === "error"}
      <p class="error small" data-testid="objectives-error">
        falha: {objectivesError}
      </p>
      <PlaceholderBanner
        label="endpoint indisponível — fallback"
        specPath="docs/specs/2026-05-26-s1-objetivos-declarados-v0.md"
        color={COLOR}
      />
    {:else if objectives.length === 0}
      <p class="muted small" data-testid="objectives-empty">
        nenhum objetivo declarado ainda
      </p>
    {:else}
      <ul class="objective-list" data-testid="objective-list">
        {#each objectives as obj (obj.id)}
          <li class="objective-card" data-testid="objective-card">
            <button
              type="button"
              class="objective-toggle"
              on:click={() => toggleHistory(obj.id)}
              aria-expanded={expandedObjectiveId === obj.id}
              data-testid={`objective-toggle-${obj.id}`}
            >
              <div class="objective-head">
                <span class="objective-statement">{obj.statement}</span>
                <span class={`status-badge status-${obj.status}`}>{obj.status}</span>
              </div>
              <div class="objective-meta">
                <span>target {formatRelative(obj.target_date)}</span>
                {#if obj.axis}<span class="axis-chip">{obj.axis}</span>{/if}
              </div>
            </button>
            {#if expandedObjectiveId === obj.id}
              <div class="history" data-testid={`objective-history-${obj.id}`}>
                {#if historyLoading}
                  <p class="muted small">carregando histórico…</p>
                {:else if historyError}
                  <p class="error small">{historyError}</p>
                {:else if historyTrail.length === 0}
                  <p class="muted small">sem histórico</p>
                {:else}
                  <ol class="history-trail">
                    {#each historyTrail as h (h.id)}
                      <li>
                        <code class="history-status">{h.status}</code>
                        <span>{h.statement}</span>
                        <span class="muted small">{formatRelative(h.declared_at)}</span>
                      </li>
                    {/each}
                  </ol>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="block" data-testid="s1-threads">
    <h3>Narrative Threads</h3>
    {#if threadsState === "loading"}
      <p class="muted small" data-testid="threads-loading">carregando…</p>
    {:else if threadsState === "error"}
      <p class="error small" data-testid="threads-error">
        falha: {threadsError}
      </p>
      <PlaceholderBanner
        label="endpoint indisponível — fallback"
        specPath="docs/specs/2026-05-26-b1-hooks-temporais-v0.md"
        color={COLOR}
      />
    {:else if threads.length === 0}
      <p class="muted small" data-testid="threads-empty">
        nenhum thread aberto
      </p>
    {:else}
      <ul class="thread-list" data-testid="thread-list">
        {#each threads as t (t.id)}
          <li class="thread-card" data-testid="thread-card">
            <div class="thread-head">
              <span class="thread-text">{t.thread_text}</span>
              <span class={`status-badge status-${t.status}`}>{t.status}</span>
            </div>
            <div class="thread-meta">
              <span>aberto {formatRelative(t.opened_at)}</span>
              {#if t.axis}<span class="axis-chip">{t.axis}</span>{/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</SubsystemPanelShell>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  h3 {
    margin: 0 0 0.3rem 0;
    font-size: 0.95rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
    padding-bottom: 0.2rem;
  }
  .identity {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 0.8rem;
    row-gap: 0.2rem;
    margin: 0;
    font-size: 0.85rem;
  }
  .identity dt {
    font-weight: 600;
    opacity: 0.8;
  }
  .identity dd {
    margin: 0;
  }
  .hint {
    font-size: 0.85rem;
    opacity: 0.85;
    margin: 0;
  }
  .muted {
    opacity: 0.55;
    font-size: 0.78rem;
  }
  .small {
    font-size: 0.75rem;
    margin: 0;
  }
  .error {
    color: #d97706;
    font-size: 0.78rem;
    margin: 0;
  }
  .action {
    align-self: flex-start;
    padding: 0.3rem 0.7rem;
    background: transparent;
    border: 1px solid rgba(59, 130, 246, 0.6);
    border-radius: 4px;
    font: inherit;
    font-size: 0.8rem;
    color: inherit;
    cursor: pointer;
  }
  .action:hover {
    background: rgba(59, 130, 246, 0.12);
  }
  .sparkline-placeholder {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 40px;
    padding: 0.2rem 0;
  }
  .bar {
    width: 8px;
    background: linear-gradient(to top, rgba(59, 130, 246, 0.35), rgba(59, 130, 246, 0.9));
    border-radius: 2px;
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.82em;
    background: rgba(127, 127, 127, 0.18);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
  .sk-stats {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 1.2rem;
    font-size: 0.85rem;
  }
  .sk-stats li {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .sk-label {
    opacity: 0.6;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sk-value {
    font-weight: 600;
  }
  .top-concepts {
    list-style: decimal inside;
    margin: 0;
    padding: 0;
    font-size: 0.82rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .top-concepts li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  .objective-list,
  .thread-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .objective-card,
  .thread-card {
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-left: 3px solid rgba(59, 130, 246, 0.7);
    border-radius: 4px;
    background: rgba(59, 130, 246, 0.05);
  }
  .objective-toggle {
    width: 100%;
    background: transparent;
    border: none;
    text-align: left;
    padding: 0.5rem 0.65rem;
    font: inherit;
    color: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .objective-toggle:hover {
    background: rgba(59, 130, 246, 0.08);
  }
  .thread-card {
    padding: 0.5rem 0.65rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .objective-head,
  .thread-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
  }
  .objective-statement,
  .thread-text {
    font-weight: 500;
    font-size: 0.88rem;
  }
  .status-badge {
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    background: rgba(127, 127, 127, 0.2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .status-active,
  .status-open {
    background: rgba(34, 197, 94, 0.22);
  }
  .status-achieved,
  .status-closed_natural {
    background: rgba(59, 130, 246, 0.22);
  }
  .status-abandoned,
  .status-closed_abandoned {
    background: rgba(127, 127, 127, 0.28);
    opacity: 0.7;
  }
  .status-drift_flagged,
  .status-stale {
    background: rgba(245, 158, 11, 0.28);
  }
  .status-revised,
  .status-resumed {
    background: rgba(168, 85, 247, 0.22);
  }
  .objective-meta,
  .thread-meta {
    display: flex;
    gap: 0.6rem;
    font-size: 0.78rem;
    opacity: 0.8;
  }
  .axis-chip {
    background: rgba(59, 130, 246, 0.15);
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.72rem;
  }
  .history {
    padding: 0.4rem 0.65rem 0.6rem;
    border-top: 1px dashed rgba(127, 127, 127, 0.3);
  }
  .history-trail {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.8rem;
  }
  .history-trail li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  .history-status {
    font-size: 0.68rem;
    flex-shrink: 0;
  }
</style>
