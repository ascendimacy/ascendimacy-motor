<script lang="ts">
  /**
   * S2 — Modelo Pedagógico (panel).
   * Pergunta: "Como o motor crê que deve ensinar [persona] agora?"
   *
   * Wired (não mais hardcoded):
   *   - GET /personas/:id/active-playbook   (id+name+version+reason)
   *   - GET /personas/:id/journey-stage     (timeline 3 stages)
   *   - GET /personas/:id/drota-config      (profile + split toggle)
   *
   * Persona ativa derivada de `$currentSessionId` (split `__`) com
   * fallback pra `$tracerSubjectId`. Padrão `lastLoadedFor` evita
   * re-fetch em loop. Jogadas catalog + transitions/phases placeholders
   * permanecem hardcoded (escopo S2 fora deste wiring).
   *
   * Spec parent: docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md
   */
  import {
    journeyPanelOpen,
    tracerSubjectId,
    currentSessionId,
  } from "../../lib/stores.js";
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";
  import PlaceholderBanner from "./PlaceholderBanner.svelte";
  import {
    createApiClient,
    type ApiClient,
    type ActivePlaybookLike,
    type JourneyStageInfoLike,
    type DrotaConfigLike,
  } from "../../lib/api.js";

  /** Permite injetar mock em testes; default = real BFF client. */
  export let api: ApiClient = createApiClient();

  const COLOR = "#10b981";

  type Jogada = {
    id: string;
    name: string;
    short: string;
  };

  const JOGADAS: Jogada[] = [
    { id: "bridge", name: "Bridge", short: "abrir ponte do mundo externo pro tema" },
    { id: "espelho", name: "Espelho", short: "refletir afeto/intenção do aprendiz" },
    { id: "canal", name: "Canal", short: "guiar fluxo de atenção em direção alvo" },
    { id: "diamante", name: "Diamante", short: "consolidar insight em fact memorável" },
    { id: "arena", name: "Arena", short: "convidar prática direta e risco produtivo" },
    { id: "recovery", name: "Recovery", short: "voltar ao seguro quando tensão cresce" },
  ];

  const JOURNEY_STAGES: Array<{
    id: "discovery_only" | "mapping_ready" | "applied_double_helix";
    label: string;
  }> = [
    { id: "discovery_only", label: "Discovery" },
    { id: "mapping_ready", label: "Mapping" },
    { id: "applied_double_helix", label: "Applied" },
  ];

  function openJourney(): void {
    journeyPanelOpen.set(true);
  }

  function derivePersonaId(sessionId: string | null, fallback: string): string {
    if (sessionId === null || sessionId.length === 0) return fallback;
    const idx = sessionId.indexOf("__");
    return idx > 0 ? sessionId.slice(0, idx) : sessionId;
  }

  $: personaId = derivePersonaId($currentSessionId, $tracerSubjectId);

  type LoadState = "idle" | "loading" | "loaded" | "error";

  let playbookState: LoadState = "idle";
  let playbook: ActivePlaybookLike | null = null;
  let playbookError = "";

  let stageState: LoadState = "idle";
  let stageInfo: JourneyStageInfoLike | null = null;
  let stageError = "";

  let drotaState: LoadState = "idle";
  let drota: DrotaConfigLike | null = null;
  let drotaError = "";

  async function loadPlaybook(pid: string): Promise<void> {
    playbookState = "loading";
    try {
      playbook = await api.getActivePlaybook(pid);
      playbookState = "loaded";
    } catch (err) {
      playbookError = err instanceof Error ? err.message : String(err);
      playbookState = "error";
    }
  }

  async function loadStage(pid: string): Promise<void> {
    stageState = "loading";
    try {
      stageInfo = await api.getJourneyStage(pid);
      stageState = "loaded";
    } catch (err) {
      stageError = err instanceof Error ? err.message : String(err);
      stageState = "error";
    }
  }

  async function loadDrota(pid: string): Promise<void> {
    drotaState = "loading";
    try {
      drota = await api.getDrotaConfig(pid);
      drotaState = "loaded";
    } catch (err) {
      drotaError = err instanceof Error ? err.message : String(err);
      drotaState = "error";
    }
  }

  // Trigger inicial + re-fetch quando persona muda. Mesmo padrão S1.
  let lastLoadedFor = "";
  $: if (personaId !== "" && personaId !== lastLoadedFor) {
    lastLoadedFor = personaId;
    void loadPlaybook(personaId);
    void loadStage(personaId);
    void loadDrota(personaId);
  }

  function stageIndex(
    id: "discovery_only" | "mapping_ready" | "applied_double_helix",
  ): number {
    return JOURNEY_STAGES.findIndex((s) => s.id === id);
  }

  function isCurrent(
    id: "discovery_only" | "mapping_ready" | "applied_double_helix",
    current: JourneyStageInfoLike | null,
  ): boolean {
    return current !== null && current.stage === id;
  }

  function isNextHint(
    id: "discovery_only" | "mapping_ready" | "applied_double_helix",
    current: JourneyStageInfoLike | null,
  ): boolean {
    return current !== null && current.nextStageHint === id;
  }

  function reasonLabel(reason: ActivePlaybookLike["appliedReason"]): string {
    switch (reason) {
      case "wizard_complete":
        return "wizard";
      case "manual_override":
        return "override";
      default:
        return "default";
    }
  }

  function blockedLabel(blocked: JourneyStageInfoLike["blockedBy"]): string {
    switch (blocked) {
      case "insufficient_discoveries":
        return "aguarda discoveries";
      case "consent_required":
        return "aguarda ratificação parental";
      default:
        return "";
    }
  }
</script>

<SubsystemPanelShell id="S2" title="Modelo Pedagógico" color={COLOR}>
  <section class="block" data-testid="s2-playbook">
    <h3>Playbook ativo</h3>
    {#if playbookState === "loading"}
      <p class="muted small" data-testid="playbook-loading">carregando…</p>
    {:else if playbookState === "error"}
      <p class="error small" data-testid="playbook-error">
        falha: {playbookError}
      </p>
      <PlaceholderBanner
        label="endpoint indisponível — fallback"
        specPath="docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md"
        color={COLOR}
      />
    {:else if playbook !== null}
      <article class="card playbook-card" data-testid="playbook-card">
        <div class="card-head">
          <strong class="playbook-name">{playbook.playbookName}</strong>
          <span
            class="reason-badge"
            data-testid="playbook-reason"
            class:reason-default={playbook.appliedReason === "default_at_persona_create"}
            class:reason-wizard={playbook.appliedReason === "wizard_complete"}
            class:reason-override={playbook.appliedReason === "manual_override"}
          >
            {reasonLabel(playbook.appliedReason)}
          </span>
        </div>
        <dl class="card-meta">
          <dt>id</dt><dd><code>{playbook.playbookId}</code></dd>
          <dt>version</dt><dd>{playbook.version}</dd>
        </dl>
        {#if playbook.developmentStub}
          <p class="muted small" data-testid="playbook-stub-note">
            (development stub — YAML não resolvido)
          </p>
        {/if}
      </article>
    {/if}
  </section>

  <section class="block" data-testid="s2-journey">
    <h3>Journey stage</h3>
    {#if stageState === "loading"}
      <p class="muted small" data-testid="stage-loading">carregando…</p>
    {:else if stageState === "error"}
      <p class="error small" data-testid="stage-error">
        falha: {stageError}
      </p>
      <PlaceholderBanner
        label="endpoint indisponível — fallback"
        specPath="docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md"
        color={COLOR}
      />
    {:else if stageInfo !== null}
      <ol
        class="stage-timeline"
        data-testid="stage-timeline"
        aria-label="journey stage timeline"
      >
        {#each JOURNEY_STAGES as st, i (st.id)}
          <li
            class="stage-pill"
            class:stage-current={isCurrent(st.id, stageInfo)}
            class:stage-next-hint={isNextHint(st.id, stageInfo) && !isCurrent(st.id, stageInfo)}
            class:stage-past={stageIndex(stageInfo.stage) > i}
            data-testid={`stage-${st.id}`}
            data-current={isCurrent(st.id, stageInfo) ? "true" : "false"}
          >
            <span class="stage-num">{i + 1}</span>
            <span class="stage-label">{st.label}</span>
          </li>
        {/each}
      </ol>
      <dl class="card-meta">
        <dt>turnos no stage</dt><dd>{stageInfo.turnsInStage}</dd>
        {#if stageInfo.blockedBy}
          <dt>bloqueio</dt>
          <dd data-testid="stage-blocked">{blockedLabel(stageInfo.blockedBy)}</dd>
        {/if}
      </dl>
      <button type="button" class="action" on:click={openJourney}>
        Abrir JourneyPanel
      </button>
    {/if}
  </section>

  <section class="block" data-testid="s2-drota">
    <h3>Drota config</h3>
    {#if drotaState === "loading"}
      <p class="muted small" data-testid="drota-loading">carregando…</p>
    {:else if drotaState === "error"}
      <p class="error small" data-testid="drota-error">
        falha: {drotaError}
      </p>
      <PlaceholderBanner
        label="endpoint indisponível — fallback"
        specPath="docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md"
        color={COLOR}
      />
    {:else if drota !== null}
      <article class="card drota-card" data-testid="drota-card">
        <div class="card-head">
          <strong>{drota.drotaProfile}</strong>
          <span
            class="split-badge"
            data-testid="drota-split-badge"
            class:split-on={drota.splitDrotaEnabled}
            class:split-off={!drota.splitDrotaEnabled}
          >
            split: {drota.splitDrotaEnabled ? "on" : "off"}
          </span>
        </div>
        <dl class="card-meta">
          <dt>register</dt><dd>{drota.registerDefault}</dd>
          <dt>fonte split</dt><dd><code>{drota.splitDrotaSource}</code></dd>
        </dl>
        {#if drota.developmentStub}
          <p class="muted small" data-testid="drota-stub-note">
            (development stub — idade desconhecida)
          </p>
        {/if}
      </article>
    {/if}
  </section>

  <section class="block">
    <h3>Jogadas catalog (5 + Recovery)</h3>
    <div class="jogadas-grid">
      {#each JOGADAS as j (j.id)}
        <article class="jogada-card" data-jogada-id={j.id}>
          <h4>{j.name}</h4>
          <p>{j.short}</p>
        </article>
      {/each}
    </div>
  </section>

  <section class="block">
    <h3>Transitions (4)</h3>
    <PlaceholderBanner
      label="lista de transitions ao vivo — feature ainda não wired no painel"
      specPath="content/profiles/kids.transitions.yaml"
      color={COLOR}
    />
  </section>

  <section class="block">
    <h3>Session phases</h3>
    <PlaceholderBanner
      label="icebreaker → helix → fechamento — feature ainda não wired"
      specPath="content/profiles/kids.session-phases.yaml"
      color={COLOR}
    />
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
  .card {
    border: 1px solid rgba(16, 185, 129, 0.4);
    border-left: 3px solid #10b981;
    border-radius: 4px;
    padding: 0.5rem 0.65rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    background: rgba(16, 185, 129, 0.05);
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
  }
  .playbook-name {
    font-size: 0.92rem;
  }
  .card-meta {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 0.8rem;
    row-gap: 0.15rem;
    margin: 0;
    font-size: 0.82rem;
  }
  .card-meta dt {
    font-weight: 600;
    opacity: 0.75;
  }
  .card-meta dd {
    margin: 0;
  }
  .reason-badge {
    font-size: 0.7rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: rgba(127, 127, 127, 0.2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .reason-wizard {
    background: rgba(34, 197, 94, 0.22);
  }
  .reason-override {
    background: rgba(168, 85, 247, 0.22);
  }
  .reason-default {
    background: rgba(127, 127, 127, 0.22);
  }
  .stage-timeline {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 0.4rem;
    align-items: stretch;
  }
  .stage-pill {
    flex: 1;
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: 4px;
    padding: 0.4rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    opacity: 0.45;
    background: rgba(127, 127, 127, 0.05);
  }
  .stage-pill.stage-current {
    opacity: 1;
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.18);
    font-weight: 600;
  }
  .stage-pill.stage-next-hint {
    opacity: 0.75;
    border-style: dashed;
    border-color: rgba(16, 185, 129, 0.6);
  }
  .stage-pill.stage-past {
    opacity: 0.6;
  }
  .stage-num {
    font-size: 0.7rem;
    opacity: 0.7;
  }
  .stage-label {
    font-size: 0.82rem;
  }
  .split-badge {
    font-size: 0.7rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .split-on {
    background: rgba(34, 197, 94, 0.22);
  }
  .split-off {
    background: rgba(127, 127, 127, 0.22);
  }
  .jogadas-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0.5rem;
  }
  .jogada-card {
    border: 1px solid rgba(16, 185, 129, 0.4);
    border-left: 3px solid #10b981;
    border-radius: 4px;
    padding: 0.5rem 0.6rem;
  }
  .jogada-card h4 {
    margin: 0 0 0.2rem 0;
    font-size: 0.85rem;
    color: #10b981;
  }
  .jogada-card p {
    margin: 0;
    font-size: 0.75rem;
    opacity: 0.85;
  }
  .action {
    align-self: flex-start;
    padding: 0.3rem 0.7rem;
    background: transparent;
    border: 1px solid rgba(16, 185, 129, 0.6);
    border-radius: 4px;
    font: inherit;
    font-size: 0.8rem;
    color: inherit;
    cursor: pointer;
  }
  .action:hover {
    background: rgba(16, 185, 129, 0.12);
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.82em;
    background: rgba(127, 127, 127, 0.18);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
