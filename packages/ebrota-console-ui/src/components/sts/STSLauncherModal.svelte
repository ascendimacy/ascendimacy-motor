<script lang="ts">
  /**
   * STSLauncherModal — wizard pra disparar uma run STS.
   *
   * Backend (s5-routes.ts) faz spawn real de scripts/run-sts.mjs.
   * UI poll-a `GET /sts/runs/:id/status` a cada 2s até status terminal
   * (succeeded/failed/cancelled). Botão "cancelar" envia SIGTERM.
   *
   * Spec: US-S5b-02 (console-ebrota-user-stories-v0.md).
   */
  import { createEventDispatcher, onDestroy } from "svelte";
  import type {
    ApiClient,
    StsPersonaLike,
    StsScenarioLike,
    StsRunStartResultLike,
    StsRunStatusResultLike,
    StsRunStatus,
  } from "../../lib/api.js";

  export let api: ApiClient;
  export let open: boolean = false;
  /** Polling interval em ms — exposto pra testes. */
  export let pollMs: number = 2000;

  const dispatch = createEventDispatcher<{ close: void; started: StsRunStartResultLike }>();

  type FormState =
    | "idle"
    | "loading"
    | "ready"
    | "submitting"
    | "running"
    | "finished"
    | "error";
  let formState: FormState = "idle";
  let personas: StsPersonaLike[] = [];
  let scenarios: StsScenarioLike[] = [];
  let errMsg = "";

  let personaId = "";
  let scenarioId = "";
  let turns = 6;

  let lastResult: StsRunStartResultLike | null = null;
  let lastStatus: StsRunStatusResultLike | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  $: selectedScenario = scenarios.find((s) => s.id === scenarioId) ?? null;
  $: if (selectedScenario && formState === "ready") {
    turns = selectedScenario.recommended_turns;
  }

  $: runStatus = (lastStatus?.status ?? lastResult?.status ?? "pending") as StsRunStatus;
  $: turnsCompleted = lastStatus?.turns_completed ?? 0;

  function close(): void {
    stopPolling();
    dispatch("close");
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pollOnce(): Promise<void> {
    if (lastResult === null) return;
    try {
      const status = await api.getStsRunStatus(lastResult.run_id);
      lastStatus = status;
      if (
        status.status === "succeeded" ||
        status.status === "failed" ||
        status.status === "cancelled"
      ) {
        formState = "finished";
        stopPolling();
      }
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
    }
  }

  function startPolling(): void {
    stopPolling();
    // Primeiro poll imediato + intervalo
    void pollOnce();
    pollTimer = setInterval(() => void pollOnce(), pollMs);
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
    lastStatus = null;
    try {
      lastResult = await api.startStsRun({
        persona_id: personaId,
        scenario_id: scenarioId,
        turns,
      });
      formState = "running";
      startPolling();
      dispatch("started", lastResult);
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
      formState = "error";
    }
  }

  async function cancelRun(): Promise<void> {
    if (lastResult === null) return;
    try {
      const res = await api.cancelStsRun(lastResult.run_id);
      // Force a status refresh so tail/exit info loads.
      void pollOnce();
      if (res.cancelled) {
        formState = "finished";
        stopPolling();
      }
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
    }
  }

  function reset(): void {
    stopPolling();
    lastResult = null;
    lastStatus = null;
    formState = "ready";
  }

  let bootstrapped = false;
  $: if (!bootstrapped) {
    bootstrapped = true;
    void loadOptions();
  }

  $: if (!open) {
    stopPolling();
  }

  onDestroy(() => stopPolling());

  function statusLabel(s: StsRunStatus): string {
    switch (s) {
      case "pending":
        return "⏳ pending";
      case "running":
        return "▶ running";
      case "succeeded":
        return "✓ succeeded";
      case "failed":
        return "✗ failed";
      case "cancelled":
        return "⊘ cancelled";
      default:
        return s;
    }
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
      {:else if (formState === "running" || formState === "finished") && lastResult !== null}
        <div
          class="running-block"
          data-testid={formState === "running" ? "sts-launcher-running" : "sts-launcher-finished"}
        >
          <p>
            <strong>{statusLabel(runStatus)}</strong>
            — run_id <code>{lastResult.run_id.slice(0, 8)}…</code>
            {#if lastResult.pid !== null && lastResult.pid !== undefined}
              <span class="muted small">pid {lastResult.pid}</span>
            {/if}
          </p>
          <div class="virtual-clock" data-testid="sts-launcher-clock">
            <span class="vc-label">progress:</span>
            <span class="vc-value" data-testid="sts-launcher-progress">
              {turnsCompleted}/{turns} turns
            </span>
          </div>
          <progress
            max={turns}
            value={turnsCompleted}
            class="progress"
            data-testid="sts-launcher-progress-bar"
          />
          {#if lastStatus !== null && lastStatus.exit_code !== null}
            <p class="muted small" data-testid="sts-launcher-exit-code">
              exit code: <code>{lastStatus.exit_code}</code>
            </p>
          {/if}
          {#if lastStatus !== null && lastStatus.error_message !== null}
            <p class="error small" data-testid="sts-launcher-error-message">
              {lastStatus.error_message}
            </p>
          {/if}
          {#if formState === "finished" && lastStatus !== null && (lastStatus.stdout_tail.length > 0 || lastStatus.stderr_tail.length > 0)}
            <details class="logs" data-testid="sts-launcher-logs">
              <summary>logs (tail)</summary>
              {#if lastStatus.stdout_tail.length > 0}
                <pre class="log-block">{lastStatus.stdout_tail.join("\n")}</pre>
              {/if}
              {#if lastStatus.stderr_tail.length > 0}
                <pre class="log-block stderr">{lastStatus.stderr_tail.join("\n")}</pre>
              {/if}
            </details>
          {/if}
          <div class="actions">
            {#if formState === "running"}
              <button
                type="button"
                class="action"
                on:click={cancelRun}
                data-testid="sts-launcher-cancel"
              >
                ⊘ cancelar
              </button>
            {:else}
              <button type="button" class="action" on:click={reset}>
                ↻ nova run
              </button>
            {/if}
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
  .progress {
    width: 100%;
    height: 6px;
  }
  .logs {
    font-size: 0.78rem;
    background: rgba(127, 127, 127, 0.1);
    border-radius: 3px;
    padding: 0.4rem;
  }
  .logs summary {
    cursor: pointer;
    opacity: 0.75;
  }
  .log-block {
    margin: 0.3rem 0 0 0;
    padding: 0.4rem;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 3px;
    overflow-x: auto;
    max-height: 160px;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.72rem;
    line-height: 1.3;
    white-space: pre;
  }
  .log-block.stderr {
    border-left: 3px solid #ef4444;
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
