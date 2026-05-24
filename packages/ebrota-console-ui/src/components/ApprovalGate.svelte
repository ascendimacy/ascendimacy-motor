<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    consoleMode,
    currentSessionId,
    currentTurnSnapshot,
    globalError,
    pendingApproval,
  } from "../lib/stores.js";
  import type { ApiClient } from "../lib/api.js";

  export let api: ApiClient;
  /** Polling interval (ms) pra /pending-approval. Default 250ms. */
  export let pollIntervalMs = 250;
  /** Limite de chars no rationale (S-OC-11 sugere ~140). */
  export let rationaleMaxLength = 280;

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let mode = "auto";
  let sessionId: string | null = null;
  let pending: { proposedText: string } | null = null;

  // Estado de edição local
  let editedText = "";
  let rationale = "";
  let editing = false;
  let submitting = false;

  $: mode = $consoleMode;
  $: sessionId = $currentSessionId;
  $: pending = $pendingApproval;
  $: shouldPoll = mode === "semi-auto" && sessionId !== null;
  $: turn = $currentTurnSnapshot?.turn ?? -1;

  // Quando pending muda, sincroniza editedText
  $: if (pending !== null && !editing) {
    editedText = pending.proposedText;
  }

  async function fetchPending(): Promise<void> {
    if (sessionId === null) return;
    try {
      const res = await api.getPendingApproval(sessionId);
      pendingApproval.set(res);
    } catch (err) {
      void err;
    }
  }

  $: if (shouldPoll && pollTimer === undefined) {
    void fetchPending();
    pollTimer = setInterval(() => void fetchPending(), pollIntervalMs);
  }

  $: if (!shouldPoll && pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
    pendingApproval.set(null);
  }

  onMount(() => {
    if (shouldPoll) {
      void fetchPending();
      pollTimer = setInterval(() => void fetchPending(), pollIntervalMs);
    }
  });

  onDestroy(() => {
    if (pollTimer !== undefined) clearInterval(pollTimer);
  });

  async function submit(decision: {
    approved: boolean;
    editedText?: string;
  }): Promise<void> {
    if (sessionId === null || submitting) return;
    submitting = true;
    globalError.set(null);
    try {
      const result = await api.approveOrEdit(sessionId, {
        ...decision,
        ...(rationale.length > 0 ? { rationale } : {}),
        ...(pending !== null ? { originalText: pending.proposedText } : {}),
        ...(turn >= 0 ? { turn } : {}),
      });
      if (!result.accepted) {
        const why = result.gateWasActive
          ? "decisão não aceita pelo daemon"
          : "gate não está ativo (mode trocou?)";
        globalError.set(`Approve falhou: ${why}`);
      }
      // Limpa pending local + reset form
      pendingApproval.set(null);
      editedText = "";
      rationale = "";
      editing = false;
    } catch (err) {
      globalError.set(
        `Approve erro: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      submitting = false;
    }
  }

  function startEditing(): void {
    editing = true;
    if (pending !== null) editedText = pending.proposedText;
  }

  function cancelEdit(): void {
    editing = false;
    if (pending !== null) editedText = pending.proposedText;
  }
</script>

{#if mode === "semi-auto" && pending !== null}
  <section class="approval-gate" data-testid="approval-gate">
    <header>
      <span class="badge">⏸ Aprovação pendente</span>
      {#if turn >= 0}
        <span class="meta">turn #{turn}</span>
      {/if}
    </header>

    {#if editing}
      <label class="edit-area">
        <span>Texto editado</span>
        <textarea
          bind:value={editedText}
          rows="4"
          data-testid="edit-textarea"
        ></textarea>
      </label>
    {:else}
      <blockquote class="proposed" data-testid="proposed-text">
        {pending.proposedText}
      </blockquote>
    {/if}

    <label class="rationale">
      <span>Rationale (Edit Learner v0)</span>
      <input
        type="text"
        bind:value={rationale}
        maxlength={rationaleMaxLength}
        placeholder="Por que decidiste isso? (opcional, máx {rationaleMaxLength} chars)"
        data-testid="rationale-input"
      />
      <small class="char-count">{rationale.length}/{rationaleMaxLength}</small>
    </label>

    <div class="actions">
      {#if !editing}
        <button
          type="button"
          class="approve"
          on:click={() => submit({ approved: true })}
          disabled={submitting}
          data-testid="approve-button"
        >
          {submitting ? "..." : "Aprovar"}
        </button>
        <button
          type="button"
          class="edit"
          on:click={startEditing}
          disabled={submitting}
          data-testid="edit-button"
        >
          Editar
        </button>
      {:else}
        <button
          type="button"
          class="approve"
          on:click={() => submit({ approved: true, editedText })}
          disabled={submitting || editedText.length === 0}
          data-testid="approve-edited-button"
        >
          {submitting ? "..." : "Enviar editado"}
        </button>
        <button
          type="button"
          class="cancel"
          on:click={cancelEdit}
          disabled={submitting}
          data-testid="cancel-edit-button"
        >
          Cancelar edição
        </button>
      {/if}
      <button
        type="button"
        class="reject"
        on:click={() => submit({ approved: false })}
        disabled={submitting}
        data-testid="reject-button"
      >
        Rejeitar
      </button>
    </div>
  </section>
{/if}

<style>
  .approval-gate {
    background: rgba(255, 193, 7, 0.1);
    border: 2px solid rgba(255, 193, 7, 0.6);
    border-radius: 6px;
    padding: 0.7rem 1rem;
    margin: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .badge {
    background: rgba(255, 193, 7, 0.4);
    color: #b8860b;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-weight: 600;
    font-size: 0.85rem;
  }

  .meta {
    font-size: 0.75rem;
    opacity: 0.6;
  }

  .proposed {
    margin: 0;
    padding: 0.5rem 0.7rem;
    border-left: 3px solid rgba(33, 150, 243, 0.5);
    background: rgba(127, 127, 127, 0.06);
    font-style: italic;
    font-size: 0.9rem;
    line-height: 1.4;
    white-space: pre-wrap;
  }

  .edit-area {
    display: flex;
    flex-direction: column;
  }

  .edit-area span {
    font-size: 0.75rem;
    opacity: 0.6;
    margin-bottom: 0.2rem;
  }

  textarea {
    padding: 0.4rem 0.6rem;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.6);
    color: inherit;
    font-family: inherit;
    font-size: 0.9rem;
    line-height: 1.4;
    resize: vertical;
  }

  @media (prefers-color-scheme: dark) {
    textarea {
      background: rgba(0, 0, 0, 0.3);
    }
  }

  .rationale {
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .rationale span {
    font-size: 0.75rem;
    opacity: 0.6;
    margin-bottom: 0.2rem;
  }

  .rationale input {
    padding: 0.3rem 0.5rem;
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 4px;
    background: rgba(127, 127, 127, 0.05);
    color: inherit;
    font-family: inherit;
    font-size: 0.85rem;
  }

  .char-count {
    position: absolute;
    right: 0.3rem;
    bottom: -0.9rem;
    font-size: 0.65rem;
    opacity: 0.5;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
  }

  button {
    padding: 0.4rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    border: 1px solid transparent;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .approve {
    background: rgba(76, 175, 80, 0.2);
    border-color: rgba(76, 175, 80, 0.6);
    color: inherit;
  }

  .approve:hover:not(:disabled) {
    background: rgba(76, 175, 80, 0.4);
  }

  .edit {
    background: rgba(33, 150, 243, 0.15);
    border-color: rgba(33, 150, 243, 0.5);
    color: inherit;
  }

  .edit:hover:not(:disabled) {
    background: rgba(33, 150, 243, 0.3);
  }

  .reject {
    background: rgba(176, 0, 32, 0.15);
    border-color: rgba(176, 0, 32, 0.5);
    color: inherit;
    margin-left: auto;
  }

  .reject:hover:not(:disabled) {
    background: rgba(176, 0, 32, 0.3);
  }

  .cancel {
    background: rgba(127, 127, 127, 0.15);
    border-color: rgba(127, 127, 127, 0.4);
    color: inherit;
  }

  .cancel:hover:not(:disabled) {
    background: rgba(127, 127, 127, 0.3);
  }
</style>
