<script lang="ts">
  import type {
    ApiClient,
    JourneyStateLike,
    StrategyPlanLike,
  } from "../lib/api.js";
  import { strategistPanelOpen, tracerSubjectId } from "../lib/stores.js";

  export let api: ApiClient;

  let plans: StrategyPlanLike[] = [];
  let journey: JourneyStateLike | null = null;
  let loading = false;
  let err: string | null = null;

  async function load(): Promise<void> {
    loading = true;
    err = null;
    try {
      const [pRes, jRes] = await Promise.all([
        api.listSubjectStrategyPlans($tracerSubjectId, { limit: 20 }),
        api.getJourneyState($tracerSubjectId),
      ]);
      plans = pRes.plans;
      journey = jRes.state;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    loading = false;
  }

  $: if ($strategistPanelOpen) void load();

  function goalColor(goal: string): string {
    if (goal === "expose") return "#f57c00";
    if (goal === "explore") return "#1976d2";
    if (goal === "challenge") return "#b00020";
    if (goal === "consolidate") return "#388e3c";
    return "#666";
  }

  function phaseColor(phase: string): string {
    if (phase === "ice_breaker") return "#90a4ae";
    if (phase === "challenge_explain") return "#1976d2";
    if (phase === "challenge_execute") return "#d32f2f";
    if (phase === "follow_up") return "#388e3c";
    return "#666";
  }
</script>

{#if $strategistPanelOpen}
  <div
    class="modal-backdrop"
    on:click={() => strategistPanelOpen.set(false)}
    on:keydown={(e) => e.key === "Escape" && strategistPanelOpen.set(false)}
    role="presentation"
  >
    <div
      class="modal"
      on:click|stopPropagation
      role="dialog"
      aria-label="Strategist plans"
    >
      <header>
        <h2>🎯 Strategist — {$tracerSubjectId}</h2>
        <button on:click={() => strategistPanelOpen.set(false)} aria-label="Fechar">×</button>
      </header>

      <div class="subject-picker">
        <label for="strat-subject">subject_id:</label>
        <input id="strat-subject" type="text" bind:value={$tracerSubjectId} on:blur={load} />
        <button on:click={load} disabled={loading}>{loading ? "..." : "Reload"}</button>
      </div>

      {#if err}<p class="err">{err}</p>{/if}

      {#if journey}
        <div class="stage-banner" data-stage={journey.stage}>
          Stage atual: <strong>{journey.stage}</strong>
          {#if journey.stage !== "applied_double_helix"}
            <span class="hint">
              Strategist só compõe planos em <code>applied_double_helix</code>. Em
              <code>{journey.stage}</code> o pipeline usa ice-breaker / mapeamento.
            </span>
          {/if}
        </div>
      {/if}

      {#if plans.length === 0}
        <div class="empty">
          <p>Nenhum StrategyPlan armazenado pra este sujeito ainda.</p>
          <p class="muted">
            Plans são compostos quando uma sessão entra em
            <code>applied_double_helix</code> e o planejador chama
            <code>composeStrategyPlan()</code>. Vide spec
            <code>2026-05-25-session-phases-journey-stages-strategist.md §5</code>.
          </p>
        </div>
      {:else}
        <section class="plans">
          <h3>{plans.length} plano(s) recente(s)</h3>
          {#each plans as plan}
            <article class="plan">
              <header class="plan-header">
                <code class="session">{plan.session_id}</code>
                <span class="when">{new Date(plan.composed_at).toLocaleString()}</span>
              </header>

              <div class="block">
                <h4>Target demonstrations</h4>
                <ul>
                  {#each plan.target_demonstrations as td}
                    <li>
                      <span
                        class="goal-badge"
                        style="background: {goalColor(td.goal)}">{td.goal}</span
                      >
                      <span class="dim">
                        <code>{td.framework}</code>/<code>{td.dimension}</code>
                      </span>
                      <p class="rationale">{td.rationale}</p>
                    </li>
                  {/each}
                </ul>
              </div>

              <div class="block">
                <h4>
                  Playbook composition · {plan.playbook_composition.reduce(
                    (s, p) => s + p.estimated_minutes,
                    0,
                  )}min
                </h4>
                <ol>
                  {#each plan.playbook_composition as step}
                    <li>
                      <span
                        class="phase-badge"
                        style="background: {phaseColor(step.phase)}">{step.phase}</span
                      >
                      <code class="move">{step.move_id}</code>
                      <span class="minutes">~{step.estimated_minutes}min</span>
                      <span class="signal">→ {step.success_signal}</span>
                    </li>
                  {/each}
                </ol>
              </div>

              <div class="block">
                <h4>Critério geral</h4>
                <p>{plan.overall_success_criteria}</p>
              </div>

              {#if plan.fallback_strategy}
                <div class="block fallback">
                  <h4>Fallback</h4>
                  <p>{plan.fallback_strategy}</p>
                </div>
              {/if}

              {#if plan.demonstrations_observed && plan.demonstrations_observed.length > 0}
                <div class="block observed">
                  <h4>Observado (follow_up)</h4>
                  <ul>
                    {#each plan.demonstrations_observed as obs}
                      <li>
                        <span
                          class="goal-badge"
                          style="background: {goalColor(obs.goal)}">{obs.goal}</span
                        >
                        <code>{obs.dimension}</code> — {obs.rationale}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </article>
          {/each}
        </section>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100; display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; padding: 1.5rem; border-radius: 8px; width: min(820px, 92vw); max-height: 90vh; overflow-y: auto; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  header h2 { margin: 0; font-size: 1.1rem; }
  header button { background: transparent; border: none; font-size: 1.5rem; cursor: pointer; }
  .subject-picker { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; }
  .subject-picker input { flex: 1; padding: 0.3rem; }
  .err { color: #b00020; }
  .stage-banner { padding: 0.5rem 0.75rem; border-radius: 4px; background: #f7f7f7; margin-bottom: 1rem; font-size: 0.9rem; }
  .stage-banner[data-stage="applied_double_helix"] { background: #e8f5e9; border-left: 3px solid #388e3c; }
  .stage-banner[data-stage="mapping_ready"] { background: #fff3e0; border-left: 3px solid #f57c00; }
  .stage-banner[data-stage="discovery_only"] { background: #e3f2fd; border-left: 3px solid #1976d2; }
  .hint { display: block; margin-top: 0.3rem; opacity: 0.75; font-size: 0.8rem; }
  .empty { background: #f7f7f7; padding: 1rem; border-radius: 4px; text-align: center; }
  .empty p:first-child { font-weight: 600; }
  .empty .muted { color: #888; font-size: 0.85rem; margin-top: 0.5rem; }
  .plans h3 { font-size: 1rem; margin-bottom: 0.75rem; }
  .plan { border: 1px solid #e0e0e0; border-radius: 6px; padding: 0.85rem; margin-bottom: 1rem; }
  .plan-header { margin-bottom: 0.5rem; }
  .plan-header .session { font-family: monospace; font-size: 0.8rem; color: #555; }
  .plan-header .when { float: right; color: #999; font-size: 0.8rem; }
  .block { margin-top: 0.75rem; }
  .block h4 { font-size: 0.85rem; margin: 0 0 0.4rem 0; color: #333; }
  .block ul, .block ol { list-style: none; padding: 0; margin: 0; }
  .block ol li { display: flex; gap: 0.5rem; align-items: center; padding: 0.3rem 0; border-bottom: 1px solid #f7f7f7; font-size: 0.85rem; }
  .block ul li { padding: 0.3rem 0; font-size: 0.85rem; border-bottom: 1px solid #f7f7f7; }
  .goal-badge, .phase-badge { color: white; padding: 0.15rem 0.5rem; border-radius: 3px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; }
  .dim, .move { font-family: monospace; }
  .rationale { margin: 0.25rem 0 0 0; color: #555; font-size: 0.8rem; }
  .minutes { color: #888; font-size: 0.75rem; }
  .signal { color: #555; font-style: italic; font-size: 0.8rem; }
  .fallback { background: #fff3e0; padding: 0.5rem 0.75rem; border-radius: 4px; }
  .observed { background: #e8f5e9; padding: 0.5rem 0.75rem; border-radius: 4px; }
</style>
