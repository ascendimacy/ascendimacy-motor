<script lang="ts">
  import { onMount } from "svelte";
  import {
    emptyWizardState,
    isStep8Complete,
    isStep10Complete,
    type WizardState,
    type Mc10Material,
  } from "../lib/wizard-types.js";
  import Step01ReadMC10 from "./wizard-steps/Step01ReadMC10.svelte";
  import Step02CadastrarFamilia from "./wizard-steps/Step02CadastrarFamilia.svelte";
  import Step03DefinirTelos from "./wizard-steps/Step03DefinirTelos.svelte";
  import Step04ForbiddenZones from "./wizard-steps/Step04ForbiddenZones.svelte";
  import Step05BudgetConstraints from "./wizard-steps/Step05BudgetConstraints.svelte";
  import Step06ProposedVirtues from "./wizard-steps/Step06ProposedVirtues.svelte";
  import Step07JanelasTemporal from "./wizard-steps/Step07JanelasTemporal.svelte";
  import Step08ConsentLedger from "./wizard-steps/Step08ConsentLedger.svelte";
  import Step09DyadConfig from "./wizard-steps/Step09DyadConfig.svelte";
  import Step10AprovarMC1 from "./wizard-steps/Step10AprovarMC1.svelte";
  import Step11Ready from "./wizard-steps/Step11Ready.svelte";

  export let baseUrl: string = "/api";
  export let onComplete: (() => void) | undefined = undefined;
  /** Fetch impl injetável pra testes — default globalThis.fetch. */
  export let fetchImpl: typeof globalThis.fetch | undefined = undefined;
  /** Material pré-carregado (testes) — quando setado, skipa fetch /mc10-material. */
  export let initialMc10Material: Mc10Material | null = null;

  function getFetch(): typeof globalThis.fetch {
    if (fetchImpl) return fetchImpl;
    return globalThis.fetch.bind(globalThis);
  }

  const STEP_TITLES = [
    "Receber material MC10",
    "Cadastrar família",
    "Definir telos da família",
    "Forbidden zones",
    "Budget constraints",
    "Virtudes propostas",
    "Janelas temporais",
    "Consent ledger",
    "Configurar dyad",
    "Aprovar primeira mensagem",
    "Pronto para piloto",
  ];

  let state: WizardState = emptyWizardState();
  let mc10Material: Mc10Material | null = initialMc10Material;
  let mc10Loading = false;
  let submitting = false;
  let errorMsg: string | null = null;

  async function fetchMc10(): Promise<void> {
    mc10Loading = true;
    try {
      const f = getFetch();
      const res = await f(`${baseUrl}/parental/mc10-material`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      mc10Material = (await res.json()) as Mc10Material;
    } catch (err) {
      errorMsg = `Falha ao carregar MC10: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      mc10Loading = false;
    }
  }

  async function saveDraft(): Promise<void> {
    try {
      const f = getFetch();
      await f(`${baseUrl}/parental/onboarding/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
    } catch {
      // draft save é best-effort
    }
  }

  async function completeOnboarding(): Promise<void> {
    submitting = true;
    errorMsg = null;
    try {
      const f = getFetch();
      const res = await f(`${baseUrl}/parental/onboarding/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `status ${res.status}`,
        );
      }
      state.readyForPilot = true;
      state = state;
      if (onComplete) onComplete();
    } catch (err) {
      errorMsg = `Falha ao finalizar: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      submitting = false;
    }
  }

  function computeCanAdvance(s: WizardState): boolean {
    switch (s.step) {
      case 1:
        return s.mc10ReadAt !== null;
      case 2:
        return (
          s.family.acquirer.name.trim().length > 0 &&
          s.family.children.length > 0 &&
          s.family.children.every(
            (c) => c.name.trim().length > 0 && c.age > 0,
          )
        );
      case 3:
        return s.telos.text.trim().length > 0;
      case 4:
        return true;
      case 5:
        return true;
      case 6:
        return s.family.children.every(
          (c) => (s.virtuesByChild[c.id]?.length ?? 0) > 0,
        );
      case 7:
        return true;
      case 8:
        return isStep8Complete(s.consents);
      case 9:
        return true;
      case 10:
        return isStep10Complete(s.mc1Approvals, s.family.children);
      case 11:
        return true;
      default:
        return false;
    }
  }

  $: canAdvance = computeCanAdvance(state);

  async function next(): Promise<void> {
    if (!canAdvance) return;
    if (state.step < 11) {
      state.step += 1;
      state = state;
      void saveDraft();
    }
  }

  function back(): void {
    if (state.step > 1) {
      state.step -= 1;
      state = state;
    }
  }

  async function finish(): Promise<void> {
    await completeOnboarding();
  }

  $: progressPct = Math.round((state.step / 11) * 100);
  $: title = STEP_TITLES[state.step - 1];

  onMount(() => {
    if (mc10Material === null) void fetchMc10();
  });
</script>

<section
  class="wizard"
  data-testid="parental-onboarding-wizard"
  aria-labelledby="wizard-title"
>
  <header class="wizard-header">
    <h2 id="wizard-title">
      Passo {state.step}/11 — {title}
    </h2>
    <div
      class="progress"
      role="progressbar"
      aria-valuenow={state.step}
      aria-valuemin="1"
      aria-valuemax="11"
    >
      <div class="progress-fill" style="width: {progressPct}%" />
    </div>
  </header>

  {#if errorMsg !== null}
    <div class="error" data-testid="wizard-error">{errorMsg}</div>
  {/if}

  <main class="wizard-body">
    {#if state.step === 1}
      <Step01ReadMC10
        bind:state
        material={mc10Material}
        loading={mc10Loading}
      />
    {:else if state.step === 2}
      <Step02CadastrarFamilia bind:state />
    {:else if state.step === 3}
      <Step03DefinirTelos bind:state />
    {:else if state.step === 4}
      <Step04ForbiddenZones bind:state />
    {:else if state.step === 5}
      <Step05BudgetConstraints bind:state />
    {:else if state.step === 6}
      <Step06ProposedVirtues bind:state />
    {:else if state.step === 7}
      <Step07JanelasTemporal bind:state />
    {:else if state.step === 8}
      <Step08ConsentLedger bind:state />
    {:else if state.step === 9}
      <Step09DyadConfig bind:state />
    {:else if state.step === 10}
      <Step10AprovarMC1 bind:state {baseUrl} {fetchImpl} />
    {:else if state.step === 11}
      <Step11Ready bind:state />
    {/if}
  </main>

  <footer class="wizard-footer">
    <button
      type="button"
      class="btn btn-secondary"
      on:click={back}
      disabled={state.step === 1 || submitting}
      data-testid="wizard-back"
    >
      Voltar
    </button>
    {#if state.step < 11}
      <button
        type="button"
        class="btn btn-primary"
        on:click={next}
        disabled={!canAdvance || submitting}
        data-testid="wizard-next"
      >
        Próximo
      </button>
    {:else}
      <button
        type="button"
        class="btn btn-primary btn-finish"
        on:click={finish}
        disabled={submitting}
        data-testid="wizard-finish"
      >
        {submitting ? "Finalizando..." : "Iniciar piloto"}
      </button>
    {/if}
  </footer>
</section>

<style>
  .wizard {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    max-width: 720px;
    margin: 0 auto;
    background: rgba(127, 127, 127, 0.05);
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 8px;
  }

  .wizard-header h2 {
    font-size: 1.1rem;
    margin: 0 0 0.5rem;
  }

  .progress {
    width: 100%;
    height: 8px;
    background: rgba(127, 127, 127, 0.2);
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #4caf50;
    transition: width 0.2s ease;
  }

  .error {
    background: rgba(176, 0, 32, 0.15);
    color: #b00020;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    font-size: 0.85rem;
  }

  .wizard-body {
    min-height: 280px;
    display: flex;
    flex-direction: column;
  }

  .wizard-footer {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    border-top: 1px solid rgba(127, 127, 127, 0.2);
    padding-top: 1rem;
  }

  .btn {
    font-family: inherit;
    font-size: 0.9rem;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid rgba(127, 127, 127, 0.4);
    background: rgba(127, 127, 127, 0.15);
    color: inherit;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-primary {
    background: rgba(33, 150, 243, 0.25);
    border-color: rgba(33, 150, 243, 0.6);
  }

  .btn-finish {
    background: rgba(76, 175, 80, 0.25);
    border-color: rgba(76, 175, 80, 0.6);
  }

  @media (max-width: 600px) {
    .wizard {
      padding: 1rem;
      border-radius: 0;
    }
  }
</style>
