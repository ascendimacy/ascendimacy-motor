<script lang="ts">
  import type { PendingQuestion } from "./parental-types.js";

  export let question: PendingQuestion | null;
  export let onClose: () => void;
  export let onSubmit: (payload: {
    answerText?: string;
    instructionToBrota?: string;
  }) => Promise<void>;

  let mode: "answer" | "instruct" = "answer";
  let answerText = "";
  let instructionToBrota = "";
  let submitting = false;
  let errorMsg: string | null = null;

  async function handleSubmit(): Promise<void> {
    errorMsg = null;
    const payload =
      mode === "answer"
        ? { answerText: answerText.trim() }
        : { instructionToBrota: instructionToBrota.trim() };
    const value =
      mode === "answer" ? payload.answerText : payload.instructionToBrota;
    if (!value || value.length === 0) {
      errorMsg = "Texto obrigatório";
      return;
    }
    submitting = true;
    try {
      await onSubmit(payload);
      onClose();
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }
</script>

{#if question !== null}
  <div
    class="backdrop"
    data-testid="pending-question-modal"
    on:click={onClose}
    on:keydown={(e) => e.key === "Escape" && onClose()}
    role="presentation"
  >
    <div
      class="modal"
      on:click|stopPropagation
      on:keydown|stopPropagation
      role="dialog"
      aria-modal="true"
      aria-labelledby="pending-q-title"
    >
      <h3 id="pending-q-title">Pergunta encaminhada</h3>
      <p class="muted small">
        Brota redirecionou pra você responder. Razão: {question.escalationReason}
      </p>

      <section class="context">
        <h4>Contexto da conversa</h4>
        <ul class="turns">
          {#each question.brotaContextTurns as turn}
            <li class="turn {turn.from}">
              <span class="who">{turn.from === "kid" ? "criança" : "Brota"}:</span>
              <span class="text">{turn.text}</span>
            </li>
          {/each}
        </ul>
        <p class="raw">
          <strong>Pergunta:</strong>
          <em>"{question.rawQuestion}"</em>
        </p>
      </section>

      <div class="mode-toggle">
        <label>
          <input
            type="radio"
            bind:group={mode}
            value="answer"
            data-testid="mode-answer"
          />
          Responder direto (Brota repete pra criança)
        </label>
        <label>
          <input
            type="radio"
            bind:group={mode}
            value="instruct"
            data-testid="mode-instruct"
          />
          Instruir Brota (texto + tom desejado)
        </label>
      </div>

      {#if mode === "answer"}
        <textarea
          bind:value={answerText}
          rows="4"
          placeholder="Sua resposta direta..."
          data-testid="answer-text"
        ></textarea>
      {:else}
        <textarea
          bind:value={instructionToBrota}
          rows="4"
          placeholder="Ex: explica simples, com analogia de tinta diluída, tom curioso..."
          data-testid="instruction-text"
        ></textarea>
      {/if}

      {#if errorMsg !== null}
        <p class="error">{errorMsg}</p>
      {/if}

      <footer>
        <button class="ghost" on:click={onClose} disabled={submitting}>
          Cancelar
        </button>
        <button
          class="primary"
          on:click={handleSubmit}
          disabled={submitting}
          data-testid="submit-answer"
        >
          {submitting ? "Enviando..." : "Enviar"}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  .modal {
    background: var(--color-bg, #1f1f1f);
    color: inherit;
    border-radius: 12px;
    max-width: 540px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    padding: 1.5rem;
    border: 1px solid rgba(127, 127, 127, 0.3);
  }
  h3 {
    margin: 0 0 0.3rem;
  }
  .muted {
    opacity: 0.7;
  }
  .small {
    font-size: 0.85rem;
  }
  .context {
    margin: 1rem 0;
    padding: 0.8rem;
    background: rgba(127, 127, 127, 0.08);
    border-radius: 8px;
  }
  .context h4 {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.75;
  }
  .turns {
    list-style: none;
    padding: 0;
    margin: 0 0 0.6rem;
  }
  .turn {
    padding: 0.25rem 0;
    font-size: 0.9rem;
  }
  .turn .who {
    font-weight: 600;
    margin-right: 0.3rem;
    opacity: 0.85;
  }
  .raw {
    margin: 0;
    font-size: 0.95rem;
  }
  .mode-toggle {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin: 1rem 0 0.5rem;
    font-size: 0.9rem;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 0.6rem;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    font-family: inherit;
    font-size: 0.95rem;
    resize: vertical;
  }
  .error {
    color: #e57373;
    font-size: 0.85rem;
    margin: 0.4rem 0 0;
  }
  footer {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }
  button {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: 1px solid transparent;
    cursor: pointer;
    font-size: 0.9rem;
    font-family: inherit;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .primary {
    background: var(--accent, #5b8def);
    color: white;
  }
  .ghost {
    background: transparent;
    border-color: rgba(127, 127, 127, 0.4);
    color: inherit;
  }
</style>
