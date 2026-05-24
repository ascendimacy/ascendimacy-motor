<script lang="ts">
  import { chatBubbles } from "../lib/stores.js";

  $: bubbles = $chatBubbles;
</script>

<section class="chat-feed" data-testid="chat-feed">
  <h2>Vista usuário</h2>
  {#if bubbles.length === 0}
    <p class="empty" data-testid="chat-empty">
      Nenhuma conversa ativa. Use "Iniciar sessão de teste" pra
      simular um <code>card:&lt;id&gt;</code> em mock daemon.
    </p>
  {:else}
    <ul class="bubbles" role="log" aria-live="polite">
      {#each bubbles as bubble (bubble.id)}
        <li class="bubble" class:user={bubble.role === "user"} class:bot={bubble.role === "bot"} class:system={bubble.role === "system"} class:pending={bubble.pendingApproval}>
          <div class="bubble-header">
            <span class="role">{bubble.role}</span>
            {#if bubble.pendingApproval}
              <span class="pending-badge">aprovação pendente</span>
            {/if}
            <span class="time">{bubble.timestamp}</span>
          </div>
          <div class="text">{bubble.text}</div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .chat-feed {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding: 1rem;
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
    opacity: 0.7;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .empty {
    opacity: 0.6;
    font-size: 0.9rem;
    padding: 1rem;
    border: 1px dashed rgba(127, 127, 127, 0.3);
    border-radius: 4px;
  }

  .bubbles {
    list-style: none;
    padding: 0;
    margin: 0;
    overflow-y: auto;
    flex: 1;
  }

  .bubble {
    margin-bottom: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    max-width: 80%;
  }

  .bubble.user {
    background: rgba(76, 175, 80, 0.15);
    margin-right: auto;
  }

  .bubble.bot {
    background: rgba(33, 150, 243, 0.15);
    margin-left: auto;
  }

  .bubble.system {
    background: rgba(127, 127, 127, 0.15);
    margin: 0 auto;
    font-style: italic;
    font-size: 0.85rem;
  }

  .bubble.pending {
    border: 2px dashed rgba(255, 193, 7, 0.7);
  }

  .bubble-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    opacity: 0.6;
    margin-bottom: 0.2rem;
  }

  .role {
    font-weight: 600;
    text-transform: uppercase;
  }

  .pending-badge {
    background: rgba(255, 193, 7, 0.3);
    color: #b8860b;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 600;
  }

  .time {
    margin-left: auto;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  }

  .text {
    line-height: 1.4;
    white-space: pre-wrap;
  }

  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.85em;
    background: rgba(127, 127, 127, 0.2);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
</style>
