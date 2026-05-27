<script lang="ts">
  /**
   * S2 — Modelo Pedagógico (panel).
   * Pergunta: "Como o motor crê que deve ensinar [persona] agora?"
   *
   * v0: charter resumo + jogadas catalog (5 + Recovery hardcoded) +
   * envelopa JourneyPanel via toggle + placeholders pra
   * transitions/phases.
   */
  import { journeyPanelOpen } from "../../lib/stores.js";
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";
  import PlaceholderBanner from "./PlaceholderBanner.svelte";

  const COLOR = "#10b981";

  type Jogada = {
    id: string;
    name: string;
    short: string;
  };

  // Hardcoded v0 — descrição curta canônica.
  const JOGADAS: Jogada[] = [
    { id: "bridge", name: "Bridge", short: "abrir ponte do mundo externo pro tema" },
    { id: "espelho", name: "Espelho", short: "refletir afeto/intenção do aprendiz" },
    { id: "canal", name: "Canal", short: "guiar fluxo de atenção em direção alvo" },
    { id: "diamante", name: "Diamante", short: "consolidar insight em fact memorável" },
    { id: "arena", name: "Arena", short: "convidar prática direta e risco produtivo" },
    { id: "recovery", name: "Recovery", short: "voltar ao seguro quando tensão cresce" },
  ];

  function openJourney(): void {
    journeyPanelOpen.set(true);
  }
</script>

<SubsystemPanelShell id="S2" title="Modelo Pedagógico" color={COLOR}>
  <section class="block">
    <h3>Charter ativo</h3>
    <p class="charter">
      <strong>Brota Mestre Core</strong> + overlay <code>kids</code>
    </p>
    <a
      class="spec-link"
      href="https://github.com/ascendimacy/ascendimacy-ops/blob/main/docs/playbooks/brota-mestre.md"
      target="_blank"
      rel="noopener"
    >
      ler charter completo →
    </a>
  </section>

  <section class="block">
    <h3>Jogadas catalog (5 + Recovery)</h3>
    <div class="jogadas-grid">
      {#each JOGADAS as j (j.id)}
        <article class="jogada-card" data-jogada-id={j.id}>
          <h4>{j.name}</h4>
          <p>{j.short}</p>
        </article>
      {/each}
    </div>
  </section>

  <section class="block">
    <h3>Journey (stage atual + transições)</h3>
    <p class="hint">
      Stage + override parental via <code>JourneyPanel</code>.
    </p>
    <button type="button" class="action" on:click={openJourney}>
      Abrir JourneyPanel
    </button>
  </section>

  <section class="block">
    <h3>Transitions (4)</h3>
    <PlaceholderBanner
      label="lista de transitions ao vivo — feature ainda não wired no painel"
      specPath="content/profiles/kids.transitions.yaml"
      color={COLOR}
    />
  </section>

  <section class="block">
    <h3>Session phases</h3>
    <PlaceholderBanner
      label="icebreaker → helix → fechamento — feature ainda não wired"
      specPath="content/profiles/kids.session-phases.yaml"
      color={COLOR}
    />
  </section>
</SubsystemPanelShell>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  h3 {
    margin: 0 0 0.3rem 0;
    font-size: 0.95rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
    padding-bottom: 0.2rem;
  }
  .charter {
    margin: 0;
    font-size: 0.9rem;
  }
  .spec-link {
    align-self: flex-start;
    font-size: 0.8rem;
    color: #10b981;
    text-decoration: none;
  }
  .spec-link:hover {
    text-decoration: underline;
  }
  .jogadas-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0.5rem;
  }
  .jogada-card {
    border: 1px solid rgba(16, 185, 129, 0.4);
    border-left: 3px solid #10b981;
    border-radius: 4px;
    padding: 0.5rem 0.6rem;
  }
  .jogada-card h4 {
    margin: 0 0 0.2rem 0;
    font-size: 0.85rem;
    color: #10b981;
  }
  .jogada-card p {
    margin: 0;
    font-size: 0.75rem;
    opacity: 0.85;
  }
  .hint {
    font-size: 0.85rem;
    opacity: 0.85;
    margin: 0;
  }
  .action {
    align-self: flex-start;
    padding: 0.3rem 0.7rem;
    background: transparent;
    border: 1px solid rgba(16, 185, 129, 0.6);
    border-radius: 4px;
    font: inherit;
    font-size: 0.8rem;
    color: inherit;
    cursor: pointer;
  }
  .action:hover {
    background: rgba(16, 185, 129, 0.12);
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.82em;
    background: rgba(127, 127, 127, 0.18);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
