<script lang="ts">
  /**
   * STSLauncherModal — wizard mínimo pra disparar uma run STS.
   *
   * v0 dispatch é stub (POST /sts/runs/start retorna run_id reservado,
   * spawn real ainda não wired — ver `s5-routes.ts`). Mesmo assim a UI
   * exibe progress + virtual clock pra validar a forma do contrato.
   *
   * Spec: US-S5b-02 (console-ebrota-user-stories-v0.md).
   */
  import { createEventDispatcher, onDestroy } from "svelte";
  import type {
    ApiClient,
    StsPersonaLike,
    StsScenarioLike,
    StsRunStartResultLike,
  } from "../../lib/api.js";

  export let api: ApiClient;
  export let open: boolean = false;

  const dispatch = createEventDispatcher<{ close: void; started: StsRunStartResultLike }>();

  type FormState = "idle" | "loading" | "ready" | "submitting" | "running" | "error";
  let formState: FormState = "idle";
  let personas: StsPersonaLike[] = [];
  let scenarios: StsScenarioLike[] = [];
  let errMsg = "";

  let personaId = "";
  let scenarioId = "";
  let turns = 6;

  let lastResult: StsRunStartResultLike | null = null;
  let virtualClockTickMs = 1500;
  let virtualClockTimer: ReturnType<typeof setInterval> | null = null;
  let virtualClockProgress = 0;

  $: selectedScenario = scenarios.find((s) => s.id === scenarioId) ?? null;
  $: if (selectedScenario && formState === "ready") {
    turns = selectedScenario.recommended_turns;
  }

  function close(): void {
    stopVirtualClock();
    dispatch("close");
  }

  function stopVirtualClock(): void {
    if (virtualClockTimer !== null) {
      clearInterval(virtualClockTimer);
      virtualClockTimer = null;
    }
  }

  function startVirtualClock(): void {
    stopVirtualClock();
    virtualClockProgress = 0;
    virtualClockTimer = setInterval(() => {
      virtualClockProgress = Math.min(virtualClockProgress + 1, turns);
      if (virtualClockProgress >= turns) {
        stopVirtualClock();
      }
    }, virtualClockTickMs);
  }

  async function loadOptions(): Promise<void> {
    formState = "loading";
    try {
      const [pRes, sRes] = await Promise.all([
        api.listStsPersonas(),
        api.listStsScenarios(),
      ]);
      personas = pRes.personas;
      scenarios = sRes.scenarios;
      if (personas.length > 0 && personaId === "") personaId = personas[0]!.id;
      if (scenarios.length > 0 && scenarioId === "") scenarioId = scenarios[0]!.id;
      if (selectedScenario) turns = selectedScenario.recommended_turns;
      formState = "ready";
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
      formState = "error";
    }
  }

  async function submit(): Promise<void> {
    if (personaId === "" || scenarioId === "") return;
    formState = "submitting";
    errMsg = "";
    try {
      lastResult = await api.startStsRun({
        persona_id: personaId,
        scenario_id: scenarioId,
        turns,
      });
      formState = "running";
      startVirtualClock();
      dispatch("started", lastResult);
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
      formState = "error";
    }
  }

  function reset(): void {
    stopVirtualClock();
    lastResult = null;
    virtualClockProgress = 0;
    formState = "ready";
  }

  let bootstrapped = false;
  $: if (!bootstrapped) {
    bootstrapped = true;
    void loadOptions();
  }

  $: if (!open) {
    stopVirtualClock();
  }

  onDestroy(() => stopVirtualClock());

  function formatVirtualClock(progress: number, total: number, label: string): string {
    if (total <= 0) return label;
    const frac = progress / total;
    const days = Math.round(frac * 30);
    if (label.includes("3d")) {
      return `T+${Math.min(Math.round(frac * 3), 3)}d ${Math.round((frac * 72) % 24)}h`;
    }
    return `T+${Math.min(days, 30)}d`;
  }
</script>

{#if open}
  <div
    class="backdrop"
    role="presentation"
    on:click|self={close}
    data-testid="sts-launcher-backdrop"
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sts-launcher-title"
      data-testid="sts-launcher-modal"
    >
      <header>
        <h2 id="sts-launcher-title">🚀 Lançar nova run STS</h2>
        <button
          type="button"
          class="close-x"
          on:click={close}
          aria-label="fechar"
          data-testid="sts-launcher-close"
        >
          ×
        </button>
      </header>

      {#if formState === "loading" || formState === "idle"}
        <p class="muted" data-testid="sts-launcher-loading">
          carregando personas + scenarios…
        </p>
      {:else if formState === "error"}
        <p class="error" data-testid="sts-launcher-error">
          erro: {errMsg}
        </p>
        <button type="button" class="action" on:click={loadOptions}>
          tentar de novo
        </button>
      {:else if formState === "running" && lastResult !== null}
        <div class="running-block" data-testid="sts-launcher-running">
          <p>
            <strong>Run em andamento</strong>
            — run_id <code>{lastResult.run_id.slice(0, 8)}…</code>
          </p>
          <p class="muted small">{lastResult.note}</p>
          <div class="virtual-clock" data-testid="sts-launcher-clock">
            <span class="vc-label">virtual clock:</span>
            <span class="vc-value">
              {formatVirtualClock(
                virtualClockProgress,
                turns,
                selectedScenario?.duration_label ?? "T+?",
              )}
            </span>
            <span class="vc-progress">
              ({virtualClockProgress}/{turns} turns)
            </span>
          </div>
          <progress max={turns} value={virtualClockProgress} class="progress" />
          <div class="actions">
            <button type="button" class="action" on:click={reset}>
              ↻ nova run
            </button>
            <button type="button" class="action primary" on:click={close}>
              fechar
            </button>
          </div>
        </div>
      {:else}
        <form
          on:submit|preventDefault={submit}
          data-testid="sts-launcher-form"
        >
          <label>
            <span>Persona</span>
            <select
              bind:value={personaId}
              disabled={formState === "submitting"}
              data-testid="sts-launcher-persona"
            >
              {#each personas as p (p.id)}
                <option value={p.id}>{p.display_name} — {p.archetype}</option>
              {/each}
            </select>
          </label>

          <label>
            <span>Scenario</span>
            <select
              bind:value={scenarioId}
              disabled={formState === "submitting"}
              data-testid="sts-launcher-scenario"
            >
              {#each scenarios as s (s.id)}
                <option value={s.id}>{s.label} ({s.duration_label})</option>
              {/each}
            </select>
            {#if selectedScenario}
              <small class="hint">{selectedScenario.description}</small>
            {/if}
          </label>

          <label>
            <span>Turns ({turns})</span>
            <input
              type="range"
              min="1"
              max={Math.max(selectedScenario?.recommended_turns ?? 30, 60)}
              bind:value={turns}
              disabled={formState === "submitting"}
              data-testid="sts-launcher-turns"
            />
          </label>

          <div class="actions">
            <button
              type="button"
              class="action"
              on:click={close}
              disabled={formState === "submitting"}
            >
              cancelar
            </button>
            <button
              type="submit"
              class="action primary"
              disabled={formState === "submitting" || personaId === "" || scenarioId === ""}
              data-testid="sts-launcher-submit"
            >
              {formState === "submitting" ? "disparando…" : "🚀 disparar run"}
            </button>
          </div>
        </form>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--color-bg, #1f1f1f);
    color: var(--color-fg, #f5f5f5);
    border: 1px solid rgba(239, 68, 68, 0.5);
    border-left: 4px solid #ef4444;
    border-radius: 6px;
    padding: 1rem 1.2rem;
    width: min(440px, 92vw);
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
    padding-bottom: 0.4rem;
  }
  header h2 {
    margin: 0;
    font-size: 1rem;
  }
  .close-x {
    background: transparent;
    border: none;
    color: inherit;
    font-size: 1.4rem;
    cursor: pointer;
    line-height: 1;
    padding: 0 0.3rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  label > span {
    font-weight: 600;
  }
  select,
  input[type="range"] {
    font: inherit;
    padding: 0.3rem;
    border-radius: 4px;
    border: 1px solid rgba(127, 127, 127, 0.4);
    background: transparent;
    color: inherit;
  }
  .hint {
    opacity: 0.7;
    font-size: 0.78rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.3rem;
  }
  .action {
    background: transparent;
    border: 1px solid rgba(239, 68, 68, 0.5);
    border-radius: 4px;
    padding: 0.35rem 0.8rem;
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .action:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.12);
  }
  .action.primary {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.8);
    font-weight: 600;
  }
  .action:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .muted {
    opacity: 0.6;
    font-size: 0.85rem;
    margin: 0;
  }
  .error {
    color: #ef4444;
    font-size: 0.85rem;
    margin: 0;
  }
  .running-block {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .virtual-clock {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.85rem;
  }
  .vc-label {
    opacity: 0.7;
  }
  .vc-value {
    font-weight: 700;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    color: #ef4444;
  }
  .vc-progress {
    opacity: 0.6;
    font-size: 0.78rem;
  }
  .progress {
    width: 100%;
    height: 6px;
  }
  .small {
    font-size: 0.78rem;
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    background: rgba(127, 127, 127, 0.2);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    font-size: 0.82em;
  }
</style>
