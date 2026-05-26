<script lang="ts">
  import type { ApiClient, SubjectKnowledgeEntryLike } from "../lib/api.js";
  import { helixPanelOpen, tracerSubjectId } from "../lib/stores.js";

  export let api: ApiClient;

  let presented: SubjectKnowledgeEntryLike[] = [];
  let loading = false;
  let err: string | null = null;

  async function load(): Promise<void> {
    loading = true;
    err = null;
    try {
      // Busca presented_concepts (instrumento ledger). Backend não tem
      // filter direto pra "presented_concept" em listSubjectDiscoveries,
      // então fazemos via direct fetch GET com type=presented_concept.
      const r = await fetch(
        `/api/subjects/${encodeURIComponent($tracerSubjectId)}/discoveries?limit=200`,
      );
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();
      // Em produção esse endpoint só retorna interest/value/need/discovery.
      // Pra ver presented_concept precisaríamos endpoint separado.
      // Por hora: filtra subset disponível + mostra como "fio conhecimento".
      presented = data.discoveries;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    loading = false;
  }

  $: if ($helixPanelOpen) void load();

  // ─── Fio CONHECIMENTO ──────────────────────────────────────────
  // Discoveries + presented concepts agrupados por axis/family
  $: knowledgeStrand = {
    interests: presented.filter((d) => d.type === "interest"),
    discoveries: presented.filter((d) => d.type === "discovery"),
  };

  // ─── Fio VALORES ───────────────────────────────────────────────
  // Lineage anchors / values declarados / needs latentes
  $: valuesStrand = {
    values: presented.filter((d) => d.type === "value"),
    needs: presented.filter((d) => d.type === "need"),
  };
</script>

{#if $helixPanelOpen}
  <div class="modal-backdrop" on:click={() => helixPanelOpen.set(false)} on:keydown={(e) => e.key === "Escape" && helixPanelOpen.set(false)} role="presentation">
    <div class="modal" on:click|stopPropagation role="dialog" aria-label="Double Helix">
      <header>
        <h2>🧬 Double Helix — {$tracerSubjectId}</h2>
        <button on:click={() => helixPanelOpen.set(false)} aria-label="Fechar">×</button>
      </header>

      <div class="picker">
        <label for="helix-subject">subject_id:</label>
        <input id="helix-subject" type="text" bind:value={$tracerSubjectId} on:blur={load} />
        <button on:click={load} disabled={loading}>{loading ? "..." : "Reload"}</button>
      </div>

      {#if err}<p class="err">{err}</p>{/if}

      <p class="intro">
        Os dois fios do produto eBrota — <strong>conhecimento</strong> (o que o
        sujeito descobre/aprende) e <strong>valores</strong> (caráter,
        necessidades, lineages clássicas). Quando entrelaçados, formam a
        ponte tripla pedagógica.
      </p>

      <div class="helix">
        <section class="strand knowledge">
          <h3>📖 Fio CONHECIMENTO</h3>
          <p class="muted">interesses descobertos + facts apresentados + capacidades emergentes</p>

          <div class="block">
            <h4>Interests ({knowledgeStrand.interests.length})</h4>
            {#if knowledgeStrand.interests.length === 0}
              <p class="empty">—</p>
            {:else}
              <ul>
                {#each knowledgeStrand.interests.slice(0, 10) as d}
                  <li>
                    <span class="label">{d.payload.label ?? d.payload.concept_id ?? d.type}</span>
                    <span class="conf">conf={d.confidence.toFixed(2)}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <div class="block">
            <h4>Discoveries gerais ({knowledgeStrand.discoveries.length})</h4>
            {#if knowledgeStrand.discoveries.length === 0}
              <p class="empty">—</p>
            {:else}
              <ul>
                {#each knowledgeStrand.discoveries.slice(0, 5) as d}
                  <li>
                    <span class="label">{d.payload.label ?? d.type}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </section>

        <section class="strand values">
          <h3>🌳 Fio VALORES</h3>
          <p class="muted">virtudes-alvo + necessidades latentes + lineages classicas ancoradas</p>

          <div class="block">
            <h4>Values declarados ({valuesStrand.values.length})</h4>
            {#if valuesStrand.values.length === 0}
              <p class="empty">— ainda sem values explícitos do sujeito</p>
            {:else}
              <ul>
                {#each valuesStrand.values.slice(0, 10) as d}
                  <li>
                    <span class="label">{d.payload.label ?? d.type}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <div class="block">
            <h4>Latent needs ({valuesStrand.needs.length})</h4>
            {#if valuesStrand.needs.length === 0}
              <p class="empty">— sem needs declarados do sujeito; ver aspirations no parental_profile</p>
            {:else}
              <ul>
                {#each valuesStrand.needs.slice(0, 10) as d}
                  <li>
                    <span class="label">{d.payload.label ?? d.type}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </section>
      </div>

      <footer class="helix-footer">
        <p>
          ⚠️ Os dois fios só se <strong>entrelaçam</strong> quando o motor
          opera em <code>applied_double_helix</code> (Strategist ativo). Hoje
          tipicamente stage = <code>discovery_only</code> nas primeiras
          sessões. Veja <strong>🧭 Jornada</strong> pra status real.
        </p>
        <p class="muted">
          Visualização v1 — radar duplo / trama 3D virá em F6 polido.
          Backend já tem schema completo; UI atual mostra listas paralelas.
        </p>
      </footer>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100; display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; padding: 1.5rem; border-radius: 8px; width: min(900px, 95vw); max-height: 90vh; overflow-y: auto; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  header h2 { margin: 0; font-size: 1.15rem; }
  header button { background: transparent; border: none; font-size: 1.5rem; cursor: pointer; }
  .picker { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; }
  .picker input { flex: 1; padding: 0.3rem; }
  .err { color: #b00020; }
  .intro { background: #f0f7ff; padding: 0.75rem; border-radius: 4px; font-size: 0.9rem; border-left: 3px solid #1976d2; }

  .helix { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem; }
  .strand { padding: 1rem; border-radius: 6px; }
  .strand.knowledge { background: #e3f2fd; border-top: 3px solid #1976d2; }
  .strand.values { background: #fff3e0; border-top: 3px solid #f57c00; }
  .strand h3 { margin: 0 0 0.3rem 0; font-size: 1rem; }
  .strand .muted { font-size: 0.8rem; color: #777; margin-bottom: 0.5rem; }
  .block { margin-top: 0.75rem; padding: 0.5rem; background: rgba(255,255,255,0.5); border-radius: 4px; }
  .block h4 { margin: 0 0 0.3rem 0; font-size: 0.85rem; color: #444; }
  .block ul { list-style: none; padding: 0; margin: 0; }
  .block li { padding: 0.2rem 0; font-size: 0.85rem; display: flex; justify-content: space-between; }
  .label { font-family: monospace; color: #222; word-break: break-word; }
  .conf { color: #999; font-size: 0.75rem; }
  .empty { color: #aaa; font-style: italic; font-size: 0.8rem; margin: 0; }

  .helix-footer { margin-top: 1.5rem; padding-top: 0.75rem; border-top: 1px solid #eee; font-size: 0.85rem; color: #555; }
  .helix-footer p { margin: 0.3rem 0; }
  .helix-footer code { background: #f0f0f0; padding: 0.1rem 0.3rem; border-radius: 2px; }
</style>
