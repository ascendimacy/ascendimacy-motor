<script lang="ts">
  /**
   * S5 — Motor de Avaliação (panel).
   * Pergunta: "O motor está funcionando? Como sabemos?"
   *
   * Estrutura em 3 sub-tabs: Guardrail (S5.a) · STS (S5.b) · Longitudinal
   * (S5.c). Envelopa Analytics + DebugPanel via toggles.
   */
  import {
    analyticsOpen,
    debugPanelOpen,
    llmXrayPanelOpen,
    llmXrayCalls,
  } from "../../lib/stores.js";
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";
  import PlaceholderBanner from "./PlaceholderBanner.svelte";

  const COLOR = "#ef4444";

  type Tab = "guardrail" | "sts" | "longitudinal";
  let activeTab: Tab = "guardrail";

  function setTab(t: Tab): void {
    activeTab = t;
  }

  function openAnalytics(): void {
    analyticsOpen.set(true);
  }
  function openDebug(): void {
    debugPanelOpen.set(true);
  }
  function openXray(): void {
    // S5 → role=motor-execucao (evaluators).
    llmXrayCalls.set([]);
    llmXrayPanelOpen.set(true);
  }

  type GuardrailCheck = { id: string; label: string; passed: boolean };
  // v0 hardcoded — TODO: ligar com trace v2.
  const guardrailChecks: GuardrailCheck[] = [
    { id: "sanitize", label: "sanitize: items removidos", passed: true },
    { id: "bullying", label: "bullying check (PT+JA): 0/5 patterns", passed: true },
    { id: "scaffold", label: "scaffold guard: ok", passed: true },
    { id: "parental", label: "parental authorization: 3 camadas ✓", passed: true },
  ];
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
      <h3>S5.a — Guardrail (per turn)</h3>
      <ul class="checks">
        {#each guardrailChecks as c (c.id)}
          <li>
            <span class="check-badge" class:passed={c.passed} class:failed={!c.passed}>
              {c.passed ? "✓" : "✗"}
            </span>
            <span>{c.label}</span>
          </li>
        {/each}
      </ul>
      <p class="hint">
        v0: status hardcoded — TODO ligar com trace v2 guardrail events.
      </p>
    </section>
  {:else if activeTab === "sts"}
    <section class="tab-panel" data-testid="s5-pane-sts">
      <h3>S5.b — STS (cross-session)</h3>
      <p class="hint">
        STS run history + rubric G1-G5 — envelopado por
        <code>Analytics</code> quando aberto (Status bar → 📊).
      </p>
      <button type="button" class="action" on:click={openAnalytics}>
        Abrir Analytics
      </button>
    </section>
  {:else}
    <section class="tab-panel" data-testid="s5-pane-longitudinal">
      <h3>S5.c — Longitudinal</h3>
      <PlaceholderBanner
        label="S5.c em rascunho — KPI dashboard + RecallCheck + Trigger Evaluator"
        specPath="docs/specs/2026-05-26-s5c-longitudinal-v0.md"
        color={COLOR}
      />
      <p class="hint">
        Eventos verbose via <code>DebugPanel</code> (Status bar → 🔬 Debug).
      </p>
      <button type="button" class="action" on:click={openDebug}>
        Abrir DebugPanel
      </button>
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
    gap: 0.5rem;
  }
  h3 {
    margin: 0;
    font-size: 0.95rem;
  }
  .checks {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .checks li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
  }
  .check-badge {
    display: inline-block;
    min-width: 1.3rem;
    text-align: center;
    border-radius: 3px;
    padding: 0.1rem 0.3rem;
    font-size: 0.8rem;
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
  .hint {
    font-size: 0.82rem;
    opacity: 0.78;
    margin: 0;
  }
  .action {
    align-self: flex-start;
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
  .actions {
    margin-top: auto;
    display: flex;
    justify-content: flex-end;
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
