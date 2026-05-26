<script lang="ts">
  import type { ApiClient } from "../lib/api.js";
  import { strategistPanelOpen, tracerSubjectId } from "../lib/stores.js";

  export let api: ApiClient;

  let plans: Array<{
    session_id: string;
    composed_at: string;
    target_demonstrations: Array<{ framework: string; dimension: string; goal: string; rationale: string }>;
    playbook_composition: Array<{ move_id: string; phase: string; estimated_minutes: number; success_signal: string }>;
    overall_success_criteria?: string;
    fallback_strategy?: string;
  }> = [];
  let loading = false;
  let err: string | null = null;

  async function load(): Promise<void> {
    loading = true;
    err = null;
    try {
      const r = await fetch(`/api/subjects/${encodeURIComponent($tracerSubjectId)}/strategy-plans?limit=20`);
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();
      plans = data.plans;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    loading = false;
  }

  $: if ($strategistPanelOpen) void load();
</script>

{#if $strategistPanelOpen}
  <div class="modal-backdrop" on:click={() => strategistPanelOpen.set(false)} on:keydown={(e) => e.key === "Escape" && strategistPanelOpen.set(false)} role="presentation">
    <div class="modal" on:click|stopPropagation role="dialog" aria-label="Strategist plans">
      <header>
        <h2>🎯 Strategist — {$tracerSubjectId}</h2>
        <button on:click={() => strategistPanelOpen.set(false)} aria-label="Fechar">×</button>
      </header>

      <div class="picker">
        <label for="strat-subject">subject_id:</label>
        <input id="strat-subject" type="text" bind:value={$tracerSubjectId} on:blur={load} />
        <button on:click={load} disabled={loading}>{loading ? "..." : "Reload"}</button>
      </div>

      {#if err}<p class="err">{err}</p>{/if}

      {#if plans.length === 0}
        <div class="empty">
          <p><strong>Nenhum StrategyPlan composto pra este sujeito.</strong></p>
          <p class="muted">Strategist v1 só compõe quando <code>journey_stage = applied_double_helix</code>. Stage atual provavelmente é <code>discovery_only</code> ou <code>mapping_ready</code> — abrir 🧭 Jornada e aplicar override parental pra <code>applied_double_helix</code> destrava composição na próxima sessão.</p>
        </div>
      {:else}
        <ul class="plans">
          {#each plans as plan}
            <li>
              <div class="plan-header">
                <span class="session">session: <code>{plan.session_id.slice(0, 12)}…</code></span>
                <span class="when">{new Date(plan.composed_at).toLocaleString()}</span>
              </div>
              <div class="targets">
                <strong>Target demonstrations:</strong>
                <ul class="inner">
                  {#each plan.target_demonstrations as td}
                    <li>
                      <span class="goal goal-{td.goal}">{td.goal}</span>
                      <span class="dim">{td.framework} · {td.dimension}</span>
                      <p class="rat">{td.rationale}</p>
                    </li>
                  {/each}
                </ul>
              </div>
              <div class="moves">
                <strong>Playbook composition:</strong>
                <ul class="inner">
                  {#each plan.playbook_composition as m}
                    <li>
                      <code class="move-id">{m.move_id}</code>
                      <span class="phase">{m.phase}</span>
                      <span class="mins">~{m.estimated_minutes}min</span>
                      <span class="signal">→ {m.success_signal}</span>
                    </li>
                  {/each}
                </ul>
              </div>
              {#if plan.overall_success_criteria}
                <div class="criteria"><strong>Critério overall:</strong> {plan.overall_success_criteria}</div>
              {/if}
              {#if plan.fallback_strategy}
                <div class="fallback"><strong>Fallback:</strong> {plan.fallback_strategy}</div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100; display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; padding: 1.5rem; border-radius: 8px; width: min(800px, 90vw); max-height: 90vh; overflow-y: auto; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  header h2 { margin: 0; font-size: 1.1rem; }
  header button { background: transparent; border: none; font-size: 1.5rem; cursor: pointer; }
  .picker { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; }
  .picker input { flex: 1; padding: 0.3rem; }
  .err { color: #b00020; }
  .empty { background: #f7f7f7; padding: 1rem; border-radius: 4px; border-left: 3px solid #1976d2; }
  .empty p { margin: 0.3rem 0; }
  .muted { color: #666; font-size: 0.9rem; }
  .plans { list-style: none; padding: 0; }
  .plans > li { background: #f7f7f7; padding: 1rem; margin-bottom: 0.75rem; border-radius: 4px; border-left: 3px solid #00897b; }
  .plan-header { display: flex; justify-content: space-between; font-size: 0.85rem; color: #666; margin-bottom: 0.5rem; }
  .inner { list-style: none; padding-left: 0; }
  .inner li { padding: 0.4rem 0; border-bottom: 1px solid #eee; }
  .goal { padding: 0.1rem 0.4rem; border-radius: 3px; color: white; font-size: 0.75rem; font-weight: 600; margin-right: 0.5rem; }
  .goal-expose { background: #1976d2; }
  .goal-explore { background: #7b1fa2; }
  .goal-challenge { background: #f57c00; }
  .goal-consolidate { background: #388e3c; }
  .dim { font-family: monospace; color: #333; }
  .rat { color: #555; font-size: 0.9rem; margin: 0.2rem 0 0 4rem; font-style: italic; }
  .move-id { background: #e0f2f1; padding: 0.1rem 0.4rem; border-radius: 3px; }
  .phase { color: #666; font-size: 0.85rem; margin: 0 0.5rem; }
  .mins { color: #999; font-size: 0.8rem; }
  .signal { color: #00695c; font-size: 0.85rem; margin-left: 0.5rem; }
  .criteria, .fallback { margin-top: 0.5rem; font-size: 0.9rem; }
  .fallback { color: #666; font-style: italic; }
</style>
