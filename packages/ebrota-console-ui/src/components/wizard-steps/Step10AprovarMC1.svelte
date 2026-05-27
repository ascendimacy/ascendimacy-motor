<script lang="ts">
  import type {
    WizardState,
    WizardChild,
    WizardMc1Approval,
  } from "../../lib/wizard-types.js";

  export let state: WizardState;
  export let baseUrl: string = "/api";
  export let fetchImpl: typeof globalThis.fetch | undefined = undefined;

  function getFetch(): typeof globalThis.fetch {
    if (fetchImpl) return fetchImpl;
    return globalThis.fetch.bind(globalThis);
  }

  let loadingChild: string | null = null;
  let errorMsg: string | null = null;
  let editingChild: string | null = null;

  function getApproval(
    childId: string,
  ): WizardMc1Approval | undefined {
    return state.mc1Approvals.find((a) => a.childId === childId);
  }

  function setApproval(approval: WizardMc1Approval): void {
    const others = state.mc1Approvals.filter(
      (a) => a.childId !== approval.childId,
    );
    state.mc1Approvals = [...others, approval];
    state = state;
  }

  async function generate(child: WizardChild): Promise<void> {
    loadingChild = child.id;
    errorMsg = null;
    try {
      const f = getFetch();
      const res = await f(`${baseUrl}/parental/mc1/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaId: child.id,
          childName: child.name,
          age: child.age,
          language: child.primaryLanguage,
          telos: state.telos,
          virtues: state.virtuesByChild[child.id] ?? [],
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { text: string };
      setApproval({
        childId: child.id,
        text: body.text,
        approved: false,
      });
    } catch (err) {
      errorMsg = `Falha ao gerar MC1 para ${child.name}: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      loadingChild = null;
    }
  }

  function approve(childId: string): void {
    const a = getApproval(childId);
    if (!a) return;
    setApproval({ ...a, approved: true });
  }

  function startEdit(childId: string): void {
    editingChild = childId;
  }

  function saveEdit(childId: string, newText: string): void {
    const a = getApproval(childId);
    if (!a) return;
    setApproval({ ...a, text: newText, approved: false });
    editingChild = null;
  }

  function onEditBlur(childId: string, event: FocusEvent): void {
    const target = event.currentTarget as HTMLTextAreaElement;
    saveEdit(childId, target.value);
  }
</script>

<div class="step" data-testid="step-10">
  <p class="intro">
    Brota gerou uma primeira mensagem customizada para cada criança. Revise +
    aprove (ou edite). Todas precisam estar aprovadas para finalizar.
  </p>

  {#if errorMsg !== null}
    <div class="error">{errorMsg}</div>
  {/if}

  {#each state.family.children as child (child.id)}
    {@const approval = getApproval(child.id)}
    <section class="mc1-block" class:approved={approval?.approved}>
      <header>
        <h3>{child.name} ({child.age}a)</h3>
        {#if approval?.approved}
          <span class="badge ok">✓ Aprovado</span>
        {:else if approval}
          <span class="badge pending">Pendente</span>
        {/if}
      </header>

      {#if !approval}
        <button
          type="button"
          class="btn-primary"
          on:click={() => generate(child)}
          disabled={loadingChild === child.id}
          data-testid="generate-mc1-{child.id}"
        >
          {loadingChild === child.id
            ? "Gerando..."
            : "Gerar MC1 customizada"}
        </button>
      {:else if editingChild === child.id}
        <textarea
          rows="5"
          value={approval.text}
          on:blur={(e) => onEditBlur(child.id, e)}
          data-testid="edit-mc1-{child.id}"
        />
        <p class="hint">Clique fora pra salvar.</p>
      {:else}
        <pre class="mc1-text">{approval.text}</pre>
        <div class="actions">
          <button
            type="button"
            class="btn-approve"
            on:click={() => approve(child.id)}
            disabled={approval.approved}
            data-testid="approve-mc1-{child.id}"
          >
            {approval.approved ? "Aprovado" : "Aprovar"}
          </button>
          <button
            type="button"
            class="btn-secondary"
            on:click={() => startEdit(child.id)}
          >
            Editar
          </button>
          <button
            type="button"
            class="btn-secondary"
            on:click={() => generate(child)}
            disabled={loadingChild === child.id}
          >
            Regenerar
          </button>
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .intro {
    margin: 0;
    opacity: 0.8;
    font-size: 0.9rem;
  }
  .error {
    background: rgba(176, 0, 32, 0.15);
    color: #b00020;
    padding: 0.4rem 0.6rem;
    border-radius: 4px;
    font-size: 0.85rem;
  }
  .mc1-block {
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 5px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .mc1-block.approved {
    border-color: rgba(76, 175, 80, 0.5);
    background: rgba(76, 175, 80, 0.05);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h3 {
    font-size: 0.95rem;
    margin: 0;
  }
  .badge {
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    border-radius: 3px;
  }
  .badge.ok {
    background: rgba(76, 175, 80, 0.2);
    color: #2e7d32;
  }
  .badge.pending {
    background: rgba(255, 193, 7, 0.2);
    color: #f57c00;
  }
  .mc1-text {
    background: rgba(127, 127, 127, 0.08);
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.85rem;
    white-space: pre-wrap;
    margin: 0;
  }
  textarea {
    background: rgba(127, 127, 127, 0.08);
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 4px;
    padding: 0.5rem;
    font-family: inherit;
    font-size: 0.85rem;
    color: inherit;
    resize: vertical;
  }
  .hint {
    margin: 0;
    font-size: 0.75rem;
    opacity: 0.6;
  }
  .actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .btn-primary,
  .btn-approve,
  .btn-secondary {
    font-family: inherit;
    font-size: 0.85rem;
    padding: 0.35rem 0.7rem;
    border-radius: 3px;
    cursor: pointer;
    color: inherit;
  }
  .btn-primary {
    background: rgba(33, 150, 243, 0.25);
    border: 1px solid rgba(33, 150, 243, 0.6);
  }
  .btn-approve {
    background: rgba(76, 175, 80, 0.25);
    border: 1px solid rgba(76, 175, 80, 0.6);
  }
  .btn-secondary {
    background: rgba(127, 127, 127, 0.1);
    border: 1px solid rgba(127, 127, 127, 0.3);
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
