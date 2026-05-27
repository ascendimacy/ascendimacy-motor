<script lang="ts">
  /**
   * B1 — Camada Social (panel).
   * Pergunta: "Como o motor está atraindo/retendo [persona]?"
   *
   * v0: placeholders em todos os blocos. Cards-repo / sacrifice budget /
   * dyad / janelas temporais / Pulso — tudo ainda não wired.
   */
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";
  import PlaceholderBanner from "./PlaceholderBanner.svelte";

  const COLOR = "#8b5cf6";
</script>

<SubsystemPanelShell id="B1" title="Camada Social" color={COLOR}>
  <section class="block">
    <h3>Cards emitidos</h3>
    <div class="grid-placeholder" aria-hidden="true">
      {#each Array(4) as _, i (i)}
        <div class="card-slot">slot {i + 1}</div>
      {/each}
    </div>
    <PlaceholderBanner
      label="grid de cards (rarity · QR · cheat-code) — TODO link com cards-repo"
      specPath="packages/ebrota-console-ui (TODO)"
      color={COLOR}
    />
  </section>

  <section class="block">
    <h3>Sacrifice budget</h3>
    <div class="gauge-placeholder">
      <div class="gauge-fill" style="width:60%"></div>
    </div>
    <PlaceholderBanner
      label="gauge sacrifice budget + breakdown — TODO"
      color={COLOR}
    />
  </section>

  <section class="block">
    <h3>Dyad</h3>
    <PlaceholderBanner
      label="duplas ativas (Ryo+Kei) + playbook kids.group — TODO"
      color={COLOR}
    />
  </section>

  <section class="block">
    <h3>Janelas temporais</h3>
    <PlaceholderBanner
      label="spec hooks temporais em rascunho/PR #243"
      specPath="docs/specs/2026-05-26-b1-hooks-temporais-v0.md"
      color={COLOR}
    />
  </section>

  <section class="block">
    <h3>Pulso</h3>
    <PlaceholderBanner
      label="último ritual de retorno (omikuji / mini-história) — TODO"
      color={COLOR}
    />
  </section>
</SubsystemPanelShell>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  h3 {
    margin: 0 0 0.3rem 0;
    font-size: 0.95rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
    padding-bottom: 0.2rem;
  }
  .grid-placeholder {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.4rem;
  }
  .card-slot {
    border: 1px dashed rgba(139, 92, 246, 0.5);
    border-radius: 4px;
    padding: 0.8rem 0.4rem;
    text-align: center;
    font-size: 0.75rem;
    opacity: 0.6;
    min-height: 3.5rem;
  }
  .gauge-placeholder {
    height: 12px;
    background: rgba(127, 127, 127, 0.18);
    border-radius: 6px;
    overflow: hidden;
  }
  .gauge-fill {
    height: 100%;
    background: linear-gradient(to right, #8b5cf6, #a78bfa);
  }
</style>
