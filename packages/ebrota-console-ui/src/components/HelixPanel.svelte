<script lang="ts">
  import type {
    ApiClient,
    JourneyStateLike,
    SubjectKnowledgeEntryLike,
  } from "../lib/api.js";
  import { helixPanelOpen, tracerSubjectId } from "../lib/stores.js";

  export let api: ApiClient;

  let journey: JourneyStateLike | null = null;
  let entries: SubjectKnowledgeEntryLike[] = [];
  let loading = false;
  let err: string | null = null;

  const AXIS_LABELS: Record<number, string> = {
    1: "Coragem",
    2: "Honra",
    3: "Resiliência",
    4: "Autoconhecimento",
    5: "Disciplina",
    6: "Curiosidade",
    7: "Generosidade",
    8: "Honestidade",
    9: "Pensamento crítico",
    10: "Criatividade",
    11: "Reflexão",
    12: "Comunicação",
  };

  type KnowledgeRow = {
    axis_id: number;
    label: string;
    presented_count: number;
    recall_positive_count: number;
    last_seen?: string;
  };

  type ValueRow = {
    axis_id: number | null;
    label: string;
    proposed: boolean;
    discovered: boolean;
    last_seen?: string;
  };

  let knowledgeThread: KnowledgeRow[] = [];
  let valuesThread: ValueRow[] = [];

  async function load(): Promise<void> {
    loading = true;
    err = null;
    try {
      const [jRes, dRes] = await Promise.all([
        api.getJourneyState($tracerSubjectId),
        api.listSubjectDiscoveries($tracerSubjectId, { limit: 500 }),
      ]);
      journey = jRes.state;
      entries = dRes.discoveries;
      derive();
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    loading = false;
  }

  function payloadAxisId(e: SubjectKnowledgeEntryLike): number | null {
    const ax = e.payload["axis_id"];
    return typeof ax === "number" ? ax : null;
  }

  function derive(): void {
    // Knowledge thread: presented_concept + recall_check_positive agrupados por axis_id.
    const kByAxis = new Map<number, KnowledgeRow>();
    for (const e of entries) {
      if (e.type !== "presented_concept" && e.type !== "recall_check_attempt") continue;
      const ax = payloadAxisId(e);
      if (ax === null) continue;
      const row = kByAxis.get(ax) ?? {
        axis_id: ax,
        label: AXIS_LABELS[ax] ?? `axis_${ax}`,
        presented_count: 0,
        recall_positive_count: 0,
      };
      if (e.type === "presented_concept") row.presented_count++;
      if (
        e.type === "recall_check_attempt" &&
        e.payload["result"] === "positive"
      ) {
        row.recall_positive_count++;
      }
      if (!row.last_seen || e.created_at > row.last_seen) row.last_seen = e.created_at;
      kByAxis.set(ax, row);
    }
    knowledgeThread = Array.from(kByAxis.values()).sort(
      (a, b) => a.axis_id - b.axis_id,
    );

    // Values thread: discoveries de type=value + axes_active do journey
    // (proposto pelos pais). Mostra "proposto" + "descoberto" lado a lado.
    const vByAxis = new Map<number, ValueRow>();
    const vWithoutAxis: ValueRow[] = [];
    for (const e of entries) {
      if (e.type !== "value") continue;
      const ax = payloadAxisId(e);
      const label =
        typeof e.payload["label"] === "string"
          ? e.payload["label"]
          : typeof e.payload["concept_id"] === "string"
            ? e.payload["concept_id"]
            : "valor";
      if (ax !== null) {
        const row = vByAxis.get(ax) ?? {
          axis_id: ax,
          label: AXIS_LABELS[ax] ?? `axis_${ax}`,
          proposed: false,
          discovered: false,
        };
        row.discovered = true;
        if (!row.last_seen || e.created_at > row.last_seen) row.last_seen = e.created_at;
        vByAxis.set(ax, row);
      } else {
        vWithoutAxis.push({
          axis_id: null,
          label,
          proposed: false,
          discovered: true,
          last_seen: e.created_at,
        });
      }
    }
    // Não temos axes_active do journey state (não exposto no DTO atual);
    // se aparecer no futuro, marcamos proposed=true. Por ora só descoberta.
    valuesThread = [
      ...Array.from(vByAxis.values()).sort((a, b) =>
        (a.axis_id ?? 0) - (b.axis_id ?? 0),
      ),
      ...vWithoutAxis,
    ];
  }

  $: if ($helixPanelOpen) void load();
</script>

{#if $helixPanelOpen}
  <div
    class="modal-backdrop"
    on:click={() => helixPanelOpen.set(false)}
    on:keydown={(e) => e.key === "Escape" && helixPanelOpen.set(false)}
    role="presentation"
  >
    <div
      class="modal"
      on:click|stopPropagation
      role="dialog"
      aria-label="Double helix"
    >
      <header>
        <h2>🧬 Helix — {$tracerSubjectId}</h2>
        <button on:click={() => helixPanelOpen.set(false)} aria-label="Fechar">×</button>
      </header>

      <div class="subject-picker">
        <label for="helix-subject">subject_id:</label>
        <input id="helix-subject" type="text" bind:value={$tracerSubjectId} on:blur={load} />
        <button on:click={load} disabled={loading}>{loading ? "..." : "Reload"}</button>
      </div>

      {#if err}<p class="err">{err}</p>{/if}

      {#if journey}
        <div class="stage-banner" data-stage={journey.stage}>
          Jornada: <strong>{journey.stage}</strong>
          <span class="meta">
            · {journey.discoveries_count} descobertas · famílias [{journey.families_covered.join(", ") || "—"}]
          </span>
        </div>
      {/if}

      <p class="muted">
        Duas tradições entrelaçadas: <strong>conhecimento</strong> (o que foi
        apresentado e checado) × <strong>valores</strong> (o que foi descoberto
        no sujeito). Ambos pivotam no mesmo eixo (1..12) — daí a métafora helix.
      </p>

      <div class="helix-grid">
        <section class="thread knowledge">
          <h3>🧠 Knowledge thread</h3>
          {#if knowledgeThread.length === 0}
            <p class="empty">Nenhum conceito apresentado ainda.</p>
          {:else}
            <ul>
              {#each knowledgeThread as k}
                <li>
                  <span class="axis-id">#{k.axis_id}</span>
                  <span class="axis-label">{k.label}</span>
                  <span class="counts">
                    pres={k.presented_count}
                    {#if k.recall_positive_count > 0}
                      <span class="recall">· recall+={k.recall_positive_count}</span>
                    {/if}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="thread values">
          <h3>⚖️ Values thread</h3>
          {#if valuesThread.length === 0}
            <p class="empty">Nenhum valor descoberto ainda.</p>
          {:else}
            <ul>
              {#each valuesThread as v}
                <li>
                  {#if v.axis_id !== null}
                    <span class="axis-id">#{v.axis_id}</span>
                  {:else}
                    <span class="axis-id no-axis">—</span>
                  {/if}
                  <span class="axis-label">{v.label}</span>
                  <span class="flags">
                    {#if v.discovered}<span class="flag discovered">descoberto</span>{/if}
                    {#if v.proposed}<span class="flag proposed">proposto</span>{/if}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>

      <div class="overlap">
        <h4>Eixos com presença nos dois threads</h4>
        {#each knowledgeThread.filter((k) => valuesThread.some((v) => v.axis_id === k.axis_id)) as o}
          <span class="overlap-chip">#{o.axis_id} {o.label}</span>
        {:else}
          <span class="muted">Nenhum eixo com knowledge + value simultâneos ainda.</span>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100; display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; padding: 1.5rem; border-radius: 8px; width: min(900px, 92vw); max-height: 90vh; overflow-y: auto; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  header h2 { margin: 0; font-size: 1.1rem; }
  header button { background: transparent; border: none; font-size: 1.5rem; cursor: pointer; }
  .subject-picker { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; }
  .subject-picker input { flex: 1; padding: 0.3rem; }
  .err { color: #b00020; }
  .stage-banner { padding: 0.5rem 0.75rem; border-radius: 4px; background: #f7f7f7; margin-bottom: 0.5rem; font-size: 0.9rem; }
  .stage-banner[data-stage="applied_double_helix"] { background: #e8f5e9; border-left: 3px solid #388e3c; }
  .stage-banner[data-stage="mapping_ready"] { background: #fff3e0; border-left: 3px solid #f57c00; }
  .stage-banner[data-stage="discovery_only"] { background: #e3f2fd; border-left: 3px solid #1976d2; }
  .stage-banner .meta { color: #555; font-size: 0.8rem; }
  .muted { color: #888; font-size: 0.85rem; margin-bottom: 1rem; }
  .helix-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
  .thread { border: 1px solid #e0e0e0; border-radius: 6px; padding: 0.85rem; }
  .thread h3 { font-size: 0.95rem; margin: 0 0 0.5rem 0; }
  .knowledge { background: linear-gradient(180deg, #f0f7ff 0%, #ffffff 100%); }
  .values { background: linear-gradient(180deg, #fff5f0 0%, #ffffff 100%); }
  .empty { color: #999; font-style: italic; }
  .thread ul { list-style: none; padding: 0; }
  .thread li { display: grid; grid-template-columns: auto 1fr auto; gap: 0.5rem; align-items: center; padding: 0.3rem 0; border-bottom: 1px solid #f7f7f7; font-size: 0.85rem; }
  .axis-id { font-family: monospace; font-weight: 600; color: #1976d2; }
  .axis-id.no-axis { color: #aaa; }
  .axis-label { color: #333; }
  .counts { color: #555; font-size: 0.8rem; }
  .recall { color: #388e3c; font-weight: 600; }
  .flags { display: flex; gap: 0.25rem; }
  .flag { padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; }
  .flag.discovered { background: #ffecb3; color: #8a6d00; }
  .flag.proposed { background: #c8e6c9; color: #1b5e20; }
  .overlap { background: #f3e5f5; padding: 0.75rem; border-radius: 4px; border-left: 3px solid #7b1fa2; }
  .overlap h4 { margin: 0 0 0.4rem 0; font-size: 0.85rem; }
  .overlap-chip { display: inline-block; padding: 0.2rem 0.5rem; margin: 0.15rem 0.25rem 0 0; background: white; border-radius: 3px; font-size: 0.8rem; }
  @media (max-width: 700px) {
    .helix-grid { grid-template-columns: 1fr; }
  }
</style>
