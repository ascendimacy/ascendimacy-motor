<script lang="ts">
  // eBrota Console — placeholder PR1.
  // PRs seguintes substituem com chat feed (PR3), vista motor (PR4),
  // approval gate UI (PR5), session library (PR6), etc.
  const version = "0.1.0";

  const futurePrs = [
    { id: "PR2", desc: "BFF proxy MCP↔HTTP/SSE + SQLite índice" },
    { id: "PR3", desc: "Vista usuário (chat feed)" },
    { id: "PR4", desc: "Vista motor (helix + statusMatrix + leque pedagógico)" },
    { id: "PR5", desc: "Modo Auto/Semi-auto + approval gate UI + telemetria" },
    { id: "PR6", desc: "Session library + filter + replay" },
    { id: "PR7", desc: "Smoke visualizer hooks (Fase F)" },
    { id: "PR8", desc: "Debug mode tail (raio-X LLM)" },
    { id: "PR9", desc: "Analytics V0.1 (cross-session + evolução pedagógica)" },
    { id: "PR10", desc: "E2E smoke contra LLM local + Baileys real" },
  ];
</script>

<main>
  <header>
    <h1>eBrota Console</h1>
    <span class="version">v{version}</span>
  </header>

  <section class="status">
    <p>
      <strong>C-MX-08 PR1 — workspaces bootstrap.</strong>
      Skeleton Svelte + Vite + TS. UI real entra em PR3+.
    </p>
    <p class="muted">
      Spec ratificada:
      <code>docs/specs/2026-05-24-ebrota-console-homologation-spec-v1.md</code>
    </p>
  </section>

  <section>
    <h2>Plan de PRs C-MX-08</h2>
    <ol>
      {#each futurePrs as { id, desc }}
        <li><strong>{id}</strong> — {desc}</li>
      {/each}
    </ol>
  </section>

  <footer>
    <p class="muted">
      🌳 Crescer para colher. Ratificado 2026-05-24 (20 decisões em bloco).
    </p>
  </footer>
</main>

<style>
  main {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    border-bottom: 1px solid currentColor;
    padding-bottom: 0.5rem;
    margin-bottom: 1.5rem;
  }

  h1 {
    font-size: 1.8rem;
    margin: 0;
  }

  .version {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.9rem;
    opacity: 0.6;
  }

  .status {
    background: rgba(127, 127, 127, 0.08);
    border-left: 3px solid #4caf50;
    padding: 0.75rem 1rem;
    margin-bottom: 2rem;
    border-radius: 0 4px 4px 0;
  }

  .muted {
    opacity: 0.7;
    font-size: 0.9rem;
  }

  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.85rem;
    background: rgba(127, 127, 127, 0.15);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
  }

  ol li {
    margin-bottom: 0.4rem;
  }

  footer {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px dashed rgba(127, 127, 127, 0.3);
    text-align: center;
  }
</style>
