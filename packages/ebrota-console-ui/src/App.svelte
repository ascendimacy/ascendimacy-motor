<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Status from "./components/Status.svelte";
  import ChatFeed from "./components/ChatFeed.svelte";
  import SessionStart from "./components/SessionStart.svelte";
  import MotorView from "./components/MotorView.svelte";
  import ApprovalGate from "./components/ApprovalGate.svelte";
  import SessionLibrary from "./components/SessionLibrary.svelte";
  import Replay from "./components/Replay.svelte";
  import DebugPanel from "./components/DebugPanel.svelte";
  import Analytics from "./components/Analytics.svelte";
  import JourneyPanel from "./components/JourneyPanel.svelte";
  import MapsPanel from "./components/MapsPanel.svelte";
  import DiscoveriesPanel from "./components/DiscoveriesPanel.svelte";
  import LlmXrayPanel from "./components/LlmXrayPanel.svelte";
  import { createApiClient } from "./lib/api.js";
  import {
    bffStatus,
    consoleMode,
    currentSessionId,
    globalError,
    libraryOpen,
    replaySessionId,
  } from "./lib/stores.js";
  import {
    startTurnStateStream,
    type TurnStateStreamManager,
  } from "./lib/turn-state-stream.js";
  import { parseUrlParams } from "./lib/url-params.js";

  const api = createApiClient();
  const STATUS_POLL_INTERVAL_MS = 2000;
  const ACTIVE_SESSIONS_POLL_MS = 3000;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let activeSessionsPollTimer: ReturnType<typeof setInterval> | undefined;
  let streamManager: TurnStateStreamManager | undefined;

  async function refreshStatus(): Promise<void> {
    try {
      const s = await api.getStatus();
      bffStatus.set(s);
      consoleMode.set(s.mode);
      globalError.set(null);
    } catch (err) {
      bffStatus.set(null);
      globalError.set(
        `BFF offline: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Verifica sessões ativas no BFF — se existir uma sessão ativa e nenhuma
   * sessão corrente estiver definida na UI, auto-conecta ao live stream
   * (Fix 3 / S-OC-05). Usa a mais recente (última no array).
   */
  async function checkActiveSessions(): Promise<void> {
    try {
      const { sessionIds } = await api.getActiveSessions();
      const currentId = $currentSessionId;
      if (sessionIds.length > 0 && currentId === null) {
        const latest = sessionIds[sessionIds.length - 1];
        if (latest !== undefined) {
          currentSessionId.set(latest);
        }
      }
    } catch {
      // silencioso — polling não crítico
    }
  }

  /**
   * Aplica deep links de visualizer (S-OC-22 / Fase F): ?replay=ID ou
   * ?live=ID. Convenção: BFF redireciona /replay/:id ou /live/:id pra
   * UI com esses params. parseUrlParams() é pure helper testável.
   */
  function applyUrlParams(): void {
    if (typeof window === "undefined") return;
    const { replaySessionId: r, liveSessionId: l } = parseUrlParams(
      window.location.search,
    );
    if (r !== null) {
      replaySessionId.set(r);
      libraryOpen.set(false);
    } else if (l !== null) {
      currentSessionId.set(l);
    }
  }

  onMount(() => {
    applyUrlParams();
    void refreshStatus();
    void checkActiveSessions();
    pollTimer = setInterval(() => {
      void refreshStatus();
    }, STATUS_POLL_INTERVAL_MS);
    activeSessionsPollTimer = setInterval(() => {
      void checkActiveSessions();
    }, ACTIVE_SESSIONS_POLL_MS);
    streamManager = startTurnStateStream(api);
  });

  onDestroy(() => {
    if (pollTimer !== undefined) clearInterval(pollTimer);
    if (activeSessionsPollTimer !== undefined)
      clearInterval(activeSessionsPollTimer);
    streamManager?.stop();
  });
</script>

<div class="app">
  <Status {api} />

  {#if $globalError !== null}
    <div class="error-banner" data-testid="error-banner">
      {$globalError}
    </div>
  {/if}

  <ApprovalGate {api} />

  <main class="main-grid">
    <ChatFeed />
    <MotorView {api} />
  </main>

  <SessionStart {api} />

  <SessionLibrary {api} />
  <Replay {api} />
  <DebugPanel {api} />
  <Analytics {api} />
  <JourneyPanel {api} />
  <MapsPanel {api} />
  <DiscoveriesPanel {api} />
  <LlmXrayPanel />

  <footer>
    <p class="muted">
      🌳 Crescer para colher. Spec
      <code>2026-05-24-ebrota-console-homologation-spec-v1.md</code>
    </p>
  </footer>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .error-banner {
    background: rgba(176, 0, 32, 0.15);
    color: #b00020;
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
    border-bottom: 1px solid rgba(176, 0, 32, 0.3);
  }

  .main-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: rgba(127, 127, 127, 0.2);
    flex: 1;
    min-height: 0;
  }

  .main-grid > :global(*) {
    background: var(--color-bg, transparent);
  }

  @media (max-width: 768px) {
    .main-grid {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr 1fr;
    }
  }

  .muted {
    opacity: 0.7;
    font-size: 0.9rem;
  }

  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.85em;
    background: rgba(127, 127, 127, 0.2);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }

  footer {
    padding: 0.5rem 1rem;
    border-top: 1px solid rgba(127, 127, 127, 0.3);
    text-align: center;
    font-size: 0.8rem;
  }
</style>
