<script lang="ts">
  export let childId: string;
  export let childName: string;
  export let onClose: () => void;
  export let onSubmit: (payload: {
    childId: string;
    type: "tom" | "repeticao" | "off-topic" | "outro";
    text: string;
    sessionRef?: string;
  }) => Promise<void>;

  let type: "tom" | "repeticao" | "off-topic" | "outro" = "tom";
  let text = "";
  let sessionRef = "";
  let submitting = false;
  let errorMsg: string | null = null;
  let successMsg: string | null = null;

  $: charCount = text.length;
  $: charsOverLimit = charCount > 500;

  async function handleSubmit(): Promise<void> {
    errorMsg = null;
    successMsg = null;
    if (text.trim().length === 0) {
      errorMsg = "Descreva o problema brevemente";
      return;
    }
    if (charsOverLimit) {
      errorMsg = "Texto excede 500 caracteres";
      return;
    }
    submitting = true;
    try {
      await onSubmit({
        childId,
        type,
        text: text.trim(),
        ...(sessionRef.trim().length > 0
          ? { sessionRef: sessionRef.trim() }
          : {}),
      });
      successMsg = "Reportado. Jun foi notificado.";
      text = "";
      setTimeout(onClose, 1200);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }
</script>

<div
  class="backdrop"
  data-testid="problem-report-form"
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
    aria-labelledby="report-title"
  >
    <h3 id="report-title">Reportar problema — {childName}</h3>
    <p class="muted small">
      Algo no Brota não está legal pra essa criança? Conta brevemente. Jun
      é notificado e pode ajustar.
    </p>

    <label>
      Tipo
      <select bind:value={type} data-testid="report-type">
        <option value="tom">Tom (jeito de falar)</option>
        <option value="repeticao">Repetição (assunto repetido demais)</option>
        <option value="off-topic">Off-topic (Brota fugiu do assunto)</option>
        <option value="outro">Outro</option>
      </select>
    </label>

    <label>
      Descrição (até 500 caracteres)
      <textarea
        bind:value={text}
        rows="4"
        maxlength="600"
        placeholder="Ex: o Ryo disse que o Brota fala muito formal e ele não gosta."
        data-testid="report-text"
      ></textarea>
      <small class="char-count" class:over={charsOverLimit}>
        {charCount}/500
      </small>
    </label>

    <label>
      Sessão referência (opcional)
      <input
        type="text"
        bind:value={sessionRef}
        placeholder="Ex: ryo-ochiai-sess-3"
        data-testid="report-session"
      />
    </label>

    {#if errorMsg !== null}
      <p class="error">{errorMsg}</p>
    {/if}
    {#if successMsg !== null}
      <p class="success">{successMsg}</p>
    {/if}

    <footer>
      <button class="ghost" on:click={onClose} disabled={submitting}>
        Cancelar
      </button>
      <button
        class="primary"
        on:click={handleSubmit}
        disabled={submitting || charsOverLimit}
        data-testid="submit-report"
      >
        {submitting ? "Enviando..." : "Enviar"}
      </button>
    </footer>
  </div>
</div>

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
    max-width: 480px;
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
  label {
    display: block;
    margin: 0.8rem 0;
    font-size: 0.9rem;
  }
  select,
  textarea,
  input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    font-family: inherit;
    font-size: 0.95rem;
    margin-top: 0.3rem;
  }
  textarea {
    resize: vertical;
  }
  .char-count {
    display: block;
    text-align: right;
    font-size: 0.75rem;
    opacity: 0.7;
    margin-top: 0.2rem;
  }
  .char-count.over {
    color: #e57373;
    opacity: 1;
  }
  .error {
    color: #e57373;
    font-size: 0.85rem;
    margin: 0.4rem 0 0;
  }
  .success {
    color: #81c784;
    font-size: 0.9rem;
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
