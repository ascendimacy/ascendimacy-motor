<script lang="ts">
  /**
   * S5 guard+recall — avaliadores do turno:
   * guardrail checks + RecallCheckEvaluator + TriggerEvaluator + warnings.
   *
   * S5 evaluators são majoritariamente rule-based — o botão X-ray
   * só aparece se houve calls com role parental_triage / other.
   */
  import { createEventDispatcher } from "svelte";
  import type { ReplayTraceTurn, LlmCallLike } from "../../lib/api.js";
  import SectionShell from "./SectionShell.svelte";

  export let turn: ReplayTraceTurn;

  const COLOR = "#ef4444";
  const ROLES_S5: ReadonlyArray<string> = ["parental_triage", "other"];

  const dispatch = createEventDispatcher<{ openXray: { roles: string[] } }>();

  $: skEvents = (turn.subjectKnowledgeEvents ??
    turn.motorTrace?.drota?.subjectKnowledgeEvents ??
    []) as Array<Record<string, unknown>>;
  $: skWrites = turn.engineTrace?.subject_knowledge_writes ?? [];

  $: recallEvents = skEvents.filter(
    (e) => typeof e["type"] === "string" && e["type"] === "recall_check_attempt",
  );
  $: boundaryEvents = skEvents.filter(
    (e) => typeof e["type"] === "string" && e["type"] === "boundary_event",
  );
  $: axisEvents = skEvents.filter(
    (e) => typeof e["type"] === "string" && e["type"] === "axis_attempt_outcome",
  );

  $: triggerFired = turn.engineTrace?.components?.planejador?.triggerEvaluation?.fired;
  $: warnings = turn.engineTrace?.warnings ?? [];

  $: allCalls = (turn.engineTrace?.llm_calls ?? []) as LlmCallLike[];
  $: callsForRole = allCalls.filter((c) => ROLES_S5.includes(c.role));

  $: hasAny =
    skEvents.length > 0 ||
    skWrites.length > 0 ||
    triggerFired !== undefined ||
    warnings.length > 0 ||
    turn.cardEmissionSkipReason !== undefined;

  function openXray(): void {
    dispatch("openXray", { roles: [...ROLES_S5] });
  }

  function readPayload(e: Record<string, unknown>): Record<string, unknown> {
    const p = e["payload"];
    return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  }
</script>

<SectionShell id="S5" title="Guard + recall" color={COLOR}>
  <span slot="meta">
    {#if recallEvents.length > 0}
      <span class="badge recall" data-testid="section-S5-recall-count"
        >{recallEvents.length} recall</span
      >
    {/if}
    {#if boundaryEvents.length > 0}
      <span class="badge boundary" data-testid="section-S5-boundary-count"
        >{boundaryEvents.length} boundary</span
      >
    {/if}
    {#if warnings.length > 0}
      <span class="badge warn" data-testid="section-S5-warn-count"
        >⚠ {warnings.length}</span
      >
    {/if}
    {#if callsForRole.length > 0}
      <button
        type="button"
        class="xray-btn"
        on:click|stopPropagation|preventDefault={openXray}
        data-testid="section-S5-xray-btn"
        title={`Abrir LLM x-ray (roles: ${ROLES_S5.join(", ")})`}
      >
        🔬 X-ray ({callsForRole.length})
      </button>
    {/if}
    {#if !hasAny}
      <span class="badge muted">sem dado</span>
    {/if}
  </span>

  {#if !hasAny}
    <p class="empty">
      não houve evento de guardrail / recall / trigger neste turno (rule-evaluators inativos)
    </p>
  {/if}

  {#if recallEvents.length > 0}
    <div class="block" data-testid="s5-recall-block">
      <strong>RecallCheckEvaluator ({recallEvents.length}):</strong>
      <ul>
        {#each recallEvents as e}
          {@const payload = readPayload(e)}
          <li>
            {#if typeof payload["concept_id"] === "string"}
              <code>{payload["concept_id"]}</code>
            {/if}
            {#if typeof payload["outcome"] === "string"}
              · outcome=<code>{payload["outcome"]}</code>
            {/if}
            {#if typeof payload["intensity"] === "number"}
              · intensity={Number(payload["intensity"]).toFixed(2)}
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if boundaryEvents.length > 0}
    <div class="block" data-testid="s5-boundary-block">
      <strong>Guardrail / boundary ({boundaryEvents.length}):</strong>
      <ul>
        {#each boundaryEvents as e}
          {@const payload = readPayload(e)}
          <li>
            {#if typeof payload["topic_category"] === "string"}
              <code>{payload["topic_category"]}</code>
            {/if}
            {#if typeof payload["label"] === "string"}
              — {payload["label"]}
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if axisEvents.length > 0}
    <div class="block" data-testid="s5-axis-block">
      <strong>Axis attempt outcomes ({axisEvents.length}):</strong>
      <ul>
        {#each axisEvents as e}
          {@const payload = readPayload(e)}
          <li>
            {#if typeof payload["axis_id"] !== "undefined"}
              axis=<code>{String(payload["axis_id"])}</code>
            {/if}
            {#if typeof payload["outcome"] === "string"}
              · outcome=<code>{payload["outcome"]}</code>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if triggerFired}
    <div class="block" data-testid="s5-trigger-block">
      <strong>Trigger Evaluator:</strong>
      transition <code>{triggerFired}</code> fired
    </div>
  {/if}

  {#if warnings.length > 0}
    <div class="block warn-block" data-testid="s5-warnings-block">
      <strong>⚠ Warnings:</strong>
      <ul>
        {#each warnings as w}
          <li><code>{w.component}</code> — {w.message}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if turn.cardEmissionSkipReason}
    <p class="block card-skip">
      <strong>card emission skipped:</strong> {turn.cardEmissionSkipReason}
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
  .badge.recall {
    background: rgba(239, 108, 0, 0.22);
    color: #c2410c;
  }
  .badge.boundary {
    background: rgba(176, 0, 32, 0.2);
    color: #b00020;
  }
  .badge.warn {
    background: rgba(183, 28, 28, 0.18);
    color: #b71c1c;
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
  .block {
    margin: 0.3rem 0;
    line-height: 1.5;
  }
  .block ul {
    margin: 0.1rem 0;
    padding-left: 1.2rem;
  }
  .block li {
    padding: 0.1rem 0;
  }
  .warn-block {
    color: #b71c1c;
  }
  .card-skip {
    color: #b00020;
    font-size: 0.78rem;
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
</style>
