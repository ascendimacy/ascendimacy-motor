<script lang="ts">
  import type { KidSummary } from "./parental-types.js";

  export let kid: KidSummary;
  export let active: boolean = false;
  export let onClick: (() => void) | undefined = undefined;

  function initials(name: string): string {
    return name.slice(0, 1).toUpperCase();
  }

  function formatLastSeen(iso: string | null): string {
    if (!iso) return "—";
    const ms = Date.now() - Date.parse(iso);
    const h = Math.floor(ms / 3600_000);
    if (h < 1) return "agora há pouco";
    if (h < 24) return `há ${h}h`;
    const d = Math.floor(h / 24);
    return `há ${d}d`;
  }

  function moodColor(mood: number | null): string {
    if (mood === null) return "rgba(127,127,127,0.4)";
    if (mood >= 7) return "#4caf50";
    if (mood >= 5) return "#ffb74d";
    return "#e57373";
  }
</script>

<button
  class="card"
  class:active
  data-testid="kid-summary-card"
  data-child-id={kid.childId}
  on:click={onClick}
>
  <div class="avatar" style="background: {kid.avatarColor};">
    {initials(kid.name)}
  </div>
  <div class="body">
    <div class="row top">
      <span class="name">{kid.name}</span>
      <span class="age">{kid.age} anos</span>
    </div>
    <div class="row status">
      {#if kid.engagedToday}
        <span class="dot" style="background:{moodColor(kid.moodToday)}"></span>
        <span class="status-text"
          >engajou hoje{kid.moodToday !== null ? ` (mood ${kid.moodToday})` : ""}</span
        >
      {:else}
        <span class="dot off"></span>
        <span class="status-text muted">não interagiu</span>
      {/if}
    </div>
    <p class="summary">{kid.oneLineSummary}</p>
    <div class="row last">
      <span class="muted small">Last seen: {formatLastSeen(kid.lastSeenAt)}</span>
    </div>
  </div>
</button>

<style>
  .card {
    display: flex;
    gap: 0.85rem;
    width: 100%;
    align-items: stretch;
    padding: 0.9rem 1rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: 10px;
    cursor: pointer;
    text-align: left;
    color: inherit;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .card:hover {
    background: rgba(255, 255, 255, 0.07);
    border-color: rgba(127, 127, 127, 0.5);
  }
  .card.active {
    border-color: var(--accent, #5b8def);
    background: rgba(91, 141, 239, 0.08);
  }
  .avatar {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 600;
    font-size: 1.4rem;
    flex-shrink: 0;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .top {
    justify-content: space-between;
  }
  .name {
    font-weight: 600;
    font-size: 1.05rem;
  }
  .age {
    font-size: 0.75rem;
    opacity: 0.7;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }
  .dot.off {
    background: rgba(127, 127, 127, 0.4);
  }
  .status-text {
    font-size: 0.85rem;
  }
  .summary {
    margin: 0.2rem 0 0;
    font-size: 0.85rem;
    opacity: 0.85;
    line-height: 1.35;
  }
  .muted {
    opacity: 0.7;
  }
  .small {
    font-size: 0.75rem;
  }
</style>
