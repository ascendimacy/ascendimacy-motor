<script lang="ts">
  /**
   * LLM x-ray sub-panel (TV2-7).
   *
   * Modal que drilla em `engineTrace.llm_calls[]` do turno selecionado no
   * Replay. Parent popula `llmXrayCalls` store; toggle abre via
   * `llmXrayPanelOpen`. Sem fetch interno em v1 — TV2-6 (ReplayTurnDetail)
   * empurra os calls do turno.
   *
   * Spec: ascendimacy-ops/docs/specs/2026-05-26-trace-v2-full-engine-telemetry.md
   */
  import { llmXrayPanelOpen, llmXrayCalls } from "../lib/stores.js";
  import type { LlmCallLike } from "../lib/api.js";

  let expandedIds = new Set<string>();
  let roleFilter: string = "all";
  let copiedId: string | null = null;

  $: calls = $llmXrayCalls;
  $: roles = Array.from(new Set(calls.map((c) => c.role)));
  $: filteredCalls =
    roleFilter === "all"
      ? calls
      : calls.filter((c) => c.role === roleFilter);
  $: totalInputTokens = calls.reduce(
    (sum, c) => sum + (c.input_tokens ?? 0),
    0,
  );
  $: totalOutputTokens = calls.reduce(
    (sum, c) => sum + (c.output_tokens ?? 0),
    0,
  );
  $: totalDurationMs = calls.reduce((sum, c) => sum + c.duration_ms, 0);
  $: cacheHits = calls.filter((c) => c.prompt_cache_hit === true).length;

  function close(): void {
    llmXrayPanelOpen.set(false);
  }

  function toggleExpanded(id: string): void {
    if (expandedIds.has(id)) {
      expandedIds.delete(id);
    } else {
      expandedIds.add(id);
    }
    expandedIds = new Set(expandedIds);
  }

  async function copyToClipboard(
    text: string,
    callId: string,
    kind: "prompt" | "response",
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copiedId = `${callId}:${kind}`;
      setTimeout(() => {
        if (copiedId === `${callId}:${kind}`) copiedId = null;
      }, 1500);
    } catch (err) {
      void err;
    }
  }

  function providerClass(provider: string): string {
    switch (provider) {
      case "anthropic":
        return "anthropic";
      case "infomaniak":
        return "infomaniak";
      case "local":
        return "local";
      case "mock":
        return "mock";
      default:
        return "unknown";
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
</script>

{#if $llmXrayPanelOpen}
  <div
    class="xray-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="LLM x-ray"
    data-testid="llm-xray-overlay"
    on:click|self={close}
    on:keydown={handleKeydown}
  >
    <div class="xray-modal" data-testid="llm-xray-modal">
      <header>
        <h2>🔬 LLM x-ray</h2>
        <span class="badge" data-testid="llm-xray-count">
          {calls.length} call{calls.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          class="close"
          on:click={close}
          aria-label="Fechar LLM x-ray"
          data-testid="llm-xray-close"
        >
          ×
        </button>
      </header>

      {#if calls.length === 0}
        <p class="muted" data-testid="llm-xray-empty">
          Nenhum LLM call registrado neste turno. Selecione um turno com
          <code>engineTrace.llm_calls[]</code> populado no Replay.
        </p>
      {:else}
        <section class="summary" data-testid="llm-xray-summary">
          <div class="summary-row">
            <span class="lbl">Total input:</span>
            <span class="val" data-testid="llm-xray-input-total"
              >{totalInputTokens} tok</span
            >
          </div>
          <div class="summary-row">
            <span class="lbl">Total output:</span>
            <span class="val" data-testid="llm-xray-output-total"
              >{totalOutputTokens} tok</span
            >
          </div>
          <div class="summary-row">
            <span class="lbl">Duração total:</span>
            <span class="val">{totalDurationMs} ms</span>
          </div>
          {#if cacheHits > 0}
            <div class="summary-row">
              <span class="lbl">Cache hits:</span>
              <span class="val">{cacheHits}/{calls.length}</span>
            </div>
          {/if}
        </section>

        <section class="filter-bar" data-testid="llm-xray-filter">
          <label for="role-filter">Filtrar por role:</label>
          <select
            id="role-filter"
            bind:value={roleFilter}
            data-testid="llm-xray-role-select"
          >
            <option value="all">all ({calls.length})</option>
            {#each roles as role (role)}
              <option value={role}
                >{role} ({calls.filter((c) => c.role === role).length})</option
              >
            {/each}
          </select>
        </section>

        <div class="call-list" data-testid="llm-xray-list">
          {#each filteredCalls as call (call.id)}
            <article
              class="call"
              class:expanded={expandedIds.has(call.id)}
              data-testid="llm-xray-call"
            >
              <button
                type="button"
                class="call-header"
                on:click={() => toggleExpanded(call.id)}
                data-testid="llm-xray-call-toggle"
              >
                <span class="role" data-testid="llm-xray-role-badge"
                  >{call.role}</span
                >
                <span class="provider provider-{providerClass(call.provider)}"
                  >{call.provider}</span
                >
                <code class="model">{call.model}</code>
                <span class="dur">{call.duration_ms}ms</span>
                {#if call.input_tokens !== undefined || call.output_tokens !== undefined}
                  <span class="tok">
                    {call.input_tokens ?? 0}→{call.output_tokens ?? 0} tok
                  </span>
                {/if}
                {#if call.prompt_cache_hit === true}
                  <span class="cache" title="prompt cache hit">⚡cache</span>
                {/if}
                {#if call.error !== undefined && call.error.length > 0}
                  <span class="err-badge" title={call.error}>⚠ error</span>
                {/if}
                {#if call.redacted === true}
                  <span class="redacted" title="PII redacted">⊗ redacted</span>
                {/if}
              </button>

              {#if expandedIds.has(call.id)}
                <div class="call-body" data-testid="llm-xray-call-body">
                  <div class="section">
                    <div class="section-header">
                      <strong>Prompt</strong>
                      <button
                        type="button"
                        class="copy"
                        on:click={() => copyToClipboard(call.prompt, call.id, "prompt")}
                        data-testid="llm-xray-copy-prompt"
                      >
                        {copiedId === `${call.id}:prompt` ? "✓ copiado" : "Copiar"}
                      </button>
                    </div>
                    <pre data-testid="llm-xray-prompt">{call.prompt}</pre>
                  </div>

                  <div class="section">
                    <div class="section-header">
                      <strong>Response</strong>
                      <button
                        type="button"
                        class="copy"
                        on:click={() =>
                          copyToClipboard(call.response, call.id, "response")}
                        data-testid="llm-xray-copy-response"
                      >
                        {copiedId === `${call.id}:response` ? "✓ copiado" : "Copiar"}
                      </button>
                    </div>
                    <pre data-testid="llm-xray-response">{call.response}</pre>
                  </div>

                  {#if call.error !== undefined && call.error.length > 0}
                    <div class="section error">
                      <strong>Error:</strong>
                      <pre>{call.error}</pre>
                    </div>
                  {/if}
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .xray-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 110;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .xray-modal {
    background: var(--bg, #fff);
    border-radius: 6px;
    width: min(900px, 95vw);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  }

  @media (prefers-color-scheme: dark) {
    .xray-modal {
      background: #1f1f1f;
      color: #eee;
    }
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.3);
  }

  header h2 {
    margin: 0;
    font-size: 1.05rem;
  }

  .badge {
    background: rgba(33, 150, 243, 0.2);
    color: #1565c0;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
  }

  header .close {
    margin-left: auto;
    background: transparent;
    border: none;
    font-size: 1.4rem;
    cursor: pointer;
    padding: 0.2rem 0.5rem;
    color: inherit;
  }

  .muted {
    padding: 2rem 1rem;
    opacity: 0.7;
    text-align: center;
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 1.2rem;
    padding: 0.6rem 1rem;
    background: rgba(127, 127, 127, 0.08);
    border-bottom: 1px solid rgba(127, 127, 127, 0.2);
    font-size: 0.85rem;
  }

  .summary-row {
    display: flex;
    gap: 0.4rem;
  }

  .lbl {
    opacity: 0.7;
  }

  .val {
    font-weight: 600;
  }

  .filter-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.2);
    font-size: 0.85rem;
  }

  .filter-bar select {
    padding: 0.2rem 0.4rem;
    font-family: inherit;
    font-size: 0.85rem;
  }

  .call-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
  }

  .call {
    margin-bottom: 0.4rem;
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: 4px;
    background: rgba(127, 127, 127, 0.04);
  }

  .call.expanded {
    background: rgba(127, 127, 127, 0.08);
  }

  .call-header {
    width: 100%;
    background: transparent;
    border: none;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.7rem;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.85rem;
    color: inherit;
  }

  .role {
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.7rem;
    padding: 0.1rem 0.45rem;
    border-radius: 3px;
    background: rgba(76, 175, 80, 0.2);
    color: #2e7d32;
  }

  .provider {
    text-transform: uppercase;
    font-size: 0.65rem;
    font-weight: 700;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
  }

  .provider-anthropic {
    background: rgba(176, 0, 32, 0.18);
    color: #b00020;
  }

  .provider-infomaniak {
    background: rgba(33, 150, 243, 0.2);
    color: #1565c0;
  }

  .provider-local {
    background: rgba(127, 127, 127, 0.25);
    color: #555;
  }

  .provider-mock {
    background: rgba(255, 193, 7, 0.25);
    color: #b08300;
  }

  .provider-unknown {
    background: rgba(127, 127, 127, 0.15);
    color: #777;
  }

  .model {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.75rem;
    background: rgba(127, 127, 127, 0.15);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }

  .dur,
  .tok {
    font-size: 0.75rem;
    opacity: 0.75;
  }

  .tok {
    margin-left: auto;
  }

  .cache {
    background: rgba(76, 175, 80, 0.22);
    color: #2e7d32;
    font-size: 0.7rem;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
  }

  .err-badge {
    background: rgba(176, 0, 32, 0.2);
    color: #b00020;
    font-size: 0.7rem;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
  }

  .redacted {
    background: rgba(127, 127, 127, 0.25);
    color: #555;
    font-size: 0.7rem;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
  }

  .call-body {
    padding: 0.5rem 0.8rem 0.7rem;
    border-top: 1px dashed rgba(127, 127, 127, 0.25);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .section {
    background: rgba(0, 0, 0, 0.04);
    border-radius: 4px;
    padding: 0.4rem 0.6rem;
  }

  @media (prefers-color-scheme: dark) {
    .section {
      background: rgba(255, 255, 255, 0.05);
    }
  }

  .section.error {
    background: rgba(176, 0, 32, 0.1);
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.3rem;
  }

  .section pre {
    margin: 0;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 240px;
    overflow-y: auto;
    background: transparent;
  }

  .copy {
    background: rgba(127, 127, 127, 0.18);
    border: 1px solid rgba(127, 127, 127, 0.35);
    border-radius: 3px;
    padding: 0.15rem 0.5rem;
    font-size: 0.75rem;
    cursor: pointer;
    font-family: inherit;
    color: inherit;
  }

  .copy:hover {
    background: rgba(127, 127, 127, 0.3);
  }

  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.8em;
    background: rgba(127, 127, 127, 0.18);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
