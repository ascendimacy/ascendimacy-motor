<script lang="ts">
  import type { WizardState } from "../../lib/wizard-types.js";

  export let state: WizardState;

  const CONSENTS: ReadonlyArray<{
    key: keyof WizardState["consents"];
    label: string;
    detail: string;
  }> = [
    {
      key: "storeTrace",
      label: "Brota pode armazenar trace de conversas",
      detail: "TTL configurável (default 90 dias). Pais podem solicitar deleção.",
    },
    {
      key: "emitPhysicalCards",
      label: "Brota pode emitir cards físicos (HMAC signed)",
      detail: "Cards do baralho impresso; necessário pra modo offline.",
    },
    {
      key: "activeHoursMessaging",
      label: "Brota pode enviar mensagens em horário ativo",
      detail: "Apenas dentro das janelas definidas no passo anterior.",
    },
    {
      key: "confirmIsAi",
      label: "Aceito que Brota confirma ser IA quando perguntado",
      detail: "Conforme protocolo MC2 — Brota nunca mente sobre sua natureza.",
    },
  ];

  function toggle(key: keyof WizardState["consents"]): void {
    state.consents[key] = !state.consents[key];
    state = state;
  }
</script>

<div class="step" data-testid="step-08">
  <p class="intro">
    Todos os toggles abaixo são <strong>obrigatórios</strong> pra iniciar o
    piloto. Cada um requer leitura + click explícito.
  </p>

  <ul class="consent-list">
    {#each CONSENTS as item}
      <li class="consent-row">
        <label>
          <input
            type="checkbox"
            checked={state.consents[item.key]}
            on:change={() => toggle(item.key)}
            data-testid="consent-{item.key}"
          />
          <div>
            <div class="consent-label">{item.label}</div>
            <div class="consent-detail">{item.detail}</div>
          </div>
        </label>
      </li>
    {/each}
  </ul>
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
  .consent-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .consent-row label {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    cursor: pointer;
    padding: 0.5rem 0.6rem;
    background: rgba(127, 127, 127, 0.08);
    border-radius: 5px;
  }
  .consent-row input[type="checkbox"] {
    margin-top: 0.2rem;
    width: 1.1rem;
    height: 1.1rem;
  }
  .consent-label {
    font-size: 0.9rem;
  }
  .consent-detail {
    font-size: 0.75rem;
    opacity: 0.65;
    margin-top: 0.2rem;
  }
</style>
