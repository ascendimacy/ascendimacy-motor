<script lang="ts">
  /**
   * SectionShell — `<details>` chrome compartilhado pelas 7 sub-seções
   * (S1-S5 + B1-B2) de ReplayTurnDetail.
   *
   * Header tem: caret, id-badge colorido, título, slot "meta" pra badges
   * + botão X-ray (quando aplicável). Body via slot default.
   *
   * Uses HTML native `<details>` (não custom toggle), aberto por default
   * pra debug ergo — operator scrolla a lista de turnos com tudo aberto.
   */
  export let id: string;
  export let title: string;
  export let color: string = "#7f7f7f";
  /** Quando true, abre por default. Default true (debug ergo). */
  export let open: boolean = true;
</script>

<details
  class="section"
  data-testid={`section-${id}`}
  data-section-id={id}
  style:--accent={color}
  {open}
>
  <summary>
    <span class="caret" aria-hidden="true"></span>
    <span class="id-badge">{id}</span>
    <span class="title">{title}</span>
    <span class="meta">
      <slot name="meta" />
    </span>
  </summary>
  <div class="body">
    <slot />
  </div>
</details>

<style>
  .section {
    border-left: 3px solid var(--accent);
    background: rgba(127, 127, 127, 0.04);
    border-radius: 3px;
    margin-bottom: 0.4rem;
    font-size: 0.78rem;
  }
  summary {
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    list-style: none;
    flex-wrap: wrap;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .caret {
    display: inline-block;
    width: 0.6rem;
    border-style: solid;
    border-width: 4px 0 4px 5px;
    border-color: transparent transparent transparent currentColor;
    opacity: 0.55;
    transition: transform 120ms;
  }
  :global(details[open]) > summary > .caret {
    transform: rotate(90deg);
  }
  .id-badge {
    font-weight: 700;
    color: var(--accent);
    font-size: 0.78rem;
    letter-spacing: 0.05em;
    min-width: 1.6rem;
  }
  .title {
    font-weight: 500;
  }
  .meta {
    margin-left: auto;
    display: inline-flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .body {
    padding: 0.3rem 0.7rem 0.5rem 1.2rem;
    border-top: 1px solid rgba(127, 127, 127, 0.15);
  }
  @media (max-width: 640px) {
    summary {
      padding: 0.4rem 0.5rem;
    }
    .body {
      padding-left: 0.7rem;
    }
    .meta {
      margin-left: 0;
      width: 100%;
    }
  }
</style>
