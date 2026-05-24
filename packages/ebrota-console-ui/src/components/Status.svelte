<script lang="ts">
  import { bffStatus, consoleMode } from "../lib/stores.js";
  import type { ApiClient } from "../lib/api.js";
  import type { ConsoleMode } from "../lib/types.js";

  export let api: ApiClient;

  let toggling = false;

  $: status = $bffStatus;
  $: mode = $consoleMode;

  async function toggleMode(): Promise<void> {
    if (toggling) return;
    toggling = true;
    const next: ConsoleMode = mode === "auto" ? "semi-auto" : "auto";
    try {
      const res = await api.setMode(next);
      consoleMode.set(res.mode);
    } catch (err) {
      console.error("setMode failed", err);
    } finally {
      toggling = false;
    }
  }
</script>

<header class="status-bar">
  <div class="brand">
    <h1>eBrota Console</h1>
    <span class="version">v0.1.0</span>
  </div>

  <div class="indicators">
    <span
      class="dot"
      class:on={status?.daemonConnected}
      title="orchestrator daemon"
      data-testid="daemon-indicator"
    />
    <span class="indicator-label">daemon</span>

    <span
      class="dot"
      class:on={status?.channelConnected}
      title="motor-channels (Baileys)"
      data-testid="channel-indicator"
    />
    <span class="indicator-label">channel</span>

    <span class="session-count" data-testid="session-count">
      {status?.sessionCount ?? 0} sessões
    </span>
  </div>

  <button
    type="button"
    class="mode-toggle"
    class:semi-auto={mode === "semi-auto"}
    on:click={toggleMode}
    disabled={toggling}
    data-testid="mode-toggle"
  >
    Mode: <strong>{mode}</strong>
  </button>
</header>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.3);
    background: rgba(127, 127, 127, 0.05);
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  h1 {
    font-size: 1.1rem;
    margin: 0;
  }

  .version {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.75rem;
    opacity: 0.5;
  }

  .indicators {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 1;
  }

  .dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: #b00020;
  }

  .dot.on {
    background: #4caf50;
  }

  .indicator-label {
    font-size: 0.8rem;
    opacity: 0.7;
    margin-right: 0.5rem;
  }

  .session-count {
    margin-left: 1rem;
    font-size: 0.85rem;
    opacity: 0.7;
  }

  .mode-toggle {
    background: rgba(127, 127, 127, 0.15);
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 4px;
    padding: 0.3rem 0.7rem;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.85rem;
    color: inherit;
  }

  .mode-toggle:hover {
    background: rgba(127, 127, 127, 0.25);
  }

  .mode-toggle.semi-auto {
    background: rgba(255, 193, 7, 0.2);
    border-color: rgba(255, 193, 7, 0.6);
  }

  .mode-toggle:disabled {
    opacity: 0.5;
    cursor: wait;
  }
</style>
