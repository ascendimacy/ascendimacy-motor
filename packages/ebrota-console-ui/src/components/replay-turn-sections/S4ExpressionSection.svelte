<script lang="ts">
  /**
   * S4 expression — fala do motor: raw_response → final_text (diff),
   * prompt summary, cache hit/miss, speaker fallback indicator.
   *
   * Botão X-ray filtra llm_calls por roles de expressão
   * (materializer / tactician / speaker).
   */
  import { createEventDispatcher } from "svelte";
  import type { ReplayTraceTurn, LlmCallLike } from "../../lib/api.js";
  import SectionShell from "./SectionShell.svelte";

  export let turn: ReplayTraceTurn;

  const COLOR = "#f97316";
  const ROLES_S4: ReadonlyArray<string> = [
    "materializer",
    "tactician",
    "speaker",
  ];

  const dispatch = createEventDispatcher<{ openXray: { roles: string[] } }>();

  $: components = turn.engineTrace?.components ?? {};
  $: materializer = components.constrained_materializer;
  $: speaker = components.speaker;
  $: rawResponse =
    speaker?.outputs?.raw_response ?? materializer?.outputs?.raw_response;
  $: finalText =
    speaker?.outputs?.final_text ?? materializer?.outputs?.final_text;
  $: stablePrefixHash =
    speaker?.stable_prefix_hash ?? materializer?.stable_prefix_hash;
  $: retriedFallback = speaker?.retried_with_fallback === true;
  $: llmCallRef = speaker?.llm_call_ref ?? materializer?.llm_call_ref;

  $: allCalls = (turn.engineTrace?.llm_calls ?? []) as LlmCallLike[];
  $: callsForRole = allCalls.filter((c) => ROLES_S4.includes(c.role));
  $: matchedCall = llmCallRef
    ? allCalls.find((c) => c.id === llmCallRef)
    : undefined;
  $: cacheHit = matchedCall?.prompt_cache_hit;

  $: hasDiff =
    rawResponse !== undefined && finalText !== undefined && rawResponse !== finalText;
  $: hasAny =
    rawResponse !== undefined ||
    finalText !== undefined ||
    speaker !== undefined ||
    materializer !== undefined;

  function openXray(): void {
    dispatch("openXray", { roles: [...ROLES_S4] });
  }

  function truncate(s: string | undefined, n = 60): string {
    if (!s) return "";
    return s.length > n ? s.slice(0, n) + "…" : s;
  }
</script>

<SectionShell id="S4" title="Expressão (fala)" color={COLOR}>
  <span slot="meta">
    {#if retriedFallback}
      <span class="badge fallback" data-testid="section-S4-fallback">↻ fallback</span>
    {/if}
    {#if cacheHit === true}
      <span class="badge cache" data-testid="section-S4-cache-hit">cache ✓</span>
    {:else if cacheHit === false}
      <span class="badge cache-miss" data-testid="section-S4-cache-miss">cache ✗</span>
    {/if}
    {#if hasDiff}
      <span class="badge diff" data-testid="section-S4-diff">diff</span>
    {/if}
    {#if callsForRole.length > 0}
      <button
        type="button"
        class="xray-btn"
        on:click|stopPropagation|preventDefault={openXray}
        data-testid="section-S4-xray-btn"
        title={`Abrir LLM x-ray (roles: ${ROLES_S4.join(", ")})`}
      >
        🔬 X-ray ({callsForRole.length})
      </button>
    {/if}
    {#if !hasAny}
      <span class="badge muted">sem dado</span>
    {/if}
  </span>

  {#if !hasAny}
    <p class="empty">não houve expressão capturada</p>
  {/if}

  {#if finalText}
    <div class="row">
      <strong>final_text:</strong>
      <blockquote class="quote" data-testid="section-S4-final-text">{finalText}</blockquote>
    </div>
  {/if}

  {#if hasDiff && rawResponse}
    <details class="sub" data-testid="s4-raw-vs-final">
      <summary>diff raw → final ({rawResponse.length} → {finalText?.length ?? 0} chars)</summary>
      <div class="sub-body">
        <p><strong>raw:</strong></p>
        <blockquote class="quote raw">{rawResponse}</blockquote>
      </div>
    </details>
  {/if}

  {#if stablePrefixHash}
    <p class="row">
      <strong>stable_prefix_hash:</strong>
      <code class="hash">{truncate(stablePrefixHash, 24)}</code>
    </p>
  {/if}

  {#if llmCallRef}
    <p class="row">
      <strong>llm_call_ref:</strong> <code>{llmCallRef}</code>
      {#if matchedCall}
        <span class="muted-row">
          {matchedCall.model} · {matchedCall.duration_ms}ms
          {#if matchedCall.input_tokens !== undefined}
            · {matchedCall.input_tokens}/{matchedCall.output_tokens ?? "?"} tokens
          {/if}
        </span>
      {/if}
    </p>
  {/if}

  {#if retriedFallback}
    <p class="row warn">
      <strong>⚠ speaker fallback acionado</strong> — output original falhou validação/parse
    </p>
  {/if}
</SectionShell>

<style>
  .badge {
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .badge.fallback {
    background: rgba(245, 158, 11, 0.25);
    color: #92400e;
  }
  .badge.cache {
    background: rgba(34, 197, 94, 0.22);
    color: #166534;
  }
  .badge.cache-miss {
    background: rgba(127, 127, 127, 0.22);
    opacity: 0.7;
  }
  .badge.diff {
    background: rgba(59, 130, 246, 0.22);
    color: #1e40af;
  }
  .badge.muted {
    background: rgba(127, 127, 127, 0.18);
    opacity: 0.6;
    font-weight: 400;
  }
  .xray-btn {
    background: rgba(123, 31, 162, 0.22);
    color: #6a1b9a;
    border: none;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .xray-btn:hover {
    background: rgba(123, 31, 162, 0.35);
  }
  .xray-btn:focus-visible {
    outline: 2px solid #6a1b9a;
    outline-offset: 1px;
  }
  .row {
    margin: 0.25rem 0;
    line-height: 1.5;
  }
  .row.warn {
    color: #b71c1c;
  }
  .quote {
    margin: 0.15rem 0 0.3rem 0;
    padding: 0.3rem 0.6rem;
    border-left: 3px solid var(--accent, #f97316);
    background: rgba(127, 127, 127, 0.05);
    font-size: 0.82rem;
    line-height: 1.45;
  }
  .quote.raw {
    border-left-color: rgba(127, 127, 127, 0.4);
    font-style: italic;
    opacity: 0.85;
  }
  .sub {
    margin: 0.2rem 0;
  }
  .sub > summary {
    cursor: pointer;
    font-size: 0.78rem;
    opacity: 0.88;
    padding: 0.1rem 0;
  }
  .sub-body {
    padding: 0.1rem 0 0.2rem 1rem;
  }
  .muted-row {
    opacity: 0.7;
    font-size: 0.72rem;
    margin-left: 0.3rem;
  }
  .empty {
    opacity: 0.6;
    font-style: italic;
    margin: 0.15rem 0;
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.78em;
    background: rgba(127, 127, 127, 0.15);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
  .hash {
    word-break: break-all;
  }
</style>
