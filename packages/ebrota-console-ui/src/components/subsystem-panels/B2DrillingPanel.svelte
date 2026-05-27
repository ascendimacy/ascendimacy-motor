<script lang="ts">
  /**
   * B2 — Drilling (panel).
   * Pergunta: "O motor está treinando automaticidades em [persona]?"
   *
   * v0: B2 ausente como sistema. Banner principal + placeholders pra
   * banks/due/SR stats.
   */
  import SubsystemPanelShell from "./SubsystemPanelShell.svelte";
  import PlaceholderBanner from "./PlaceholderBanner.svelte";

  const COLOR = "#6b7280";
</script>

<SubsystemPanelShell id="B2" title="Drilling (automaticidade)" color={COLOR}>
  <div class="absent-banner" data-testid="b2-absent-banner">
    <strong>❌ B2 ausente como sistema</strong>
    <p>
      Drilling (SR / banks / mastery) ainda não é parte do motor canônico.
      Especificação em rascunho:
    </p>
    <code>docs/specs/2026-05-26-b2-drilling-primer-v0.md</code> (PR #244)
  </div>

  <section class="block">
    <h3>Banks ativos</h3>
    <PlaceholderBanner
      label="ja-pt-vocab-n5 (50 items) — TODO quando B2 wired"
      color={COLOR}
    />
  </section>

  <section class="block">
    <h3>Items due agora</h3>
    <PlaceholderBanner
      label="DrillState com next_due_at < now — TODO"
      color={COLOR}
    />
  </section>

  <section class="block">
    <h3>SR statistics</h3>
    <PlaceholderBanner
      label="avg easiness · retention curve — TODO"
      color={COLOR}
    />
  </section>
</SubsystemPanelShell>

<style>
  .absent-banner {
    border: 1px solid rgba(239, 68, 68, 0.5);
    border-left: 4px solid #ef4444;
    border-radius: 4px;
    padding: 0.8rem 1rem;
    background: rgba(239, 68, 68, 0.06);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .absent-banner strong {
    font-size: 0.95rem;
  }
  .absent-banner p {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.9;
  }
  .absent-banner code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.78rem;
    background: rgba(127, 127, 127, 0.18);
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    align-self: flex-start;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  h3 {
    margin: 0 0 0.3rem 0;
    font-size: 0.95rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
    padding-bottom: 0.2rem;
  }
</style>
