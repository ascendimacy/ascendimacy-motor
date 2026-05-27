<script lang="ts">
  /**
   * SubsystemGrid — landing grid 4x2 dos 7 subsistemas (S1-S5 + B1-B2).
   * Click num card → seta `expandedSubsystem` store.
   *
   * Layout: 4x2 desktop, 1x7 stacked mobile (media query).
   *
   * Spec: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-7-subsistemas-redesign-v0.md
   */
  import SubsystemCard from "./SubsystemCard.svelte";
  import { expandedSubsystem } from "../lib/stores.js";

  type SubsystemDef = {
    id: string;
    title: string;
    subtitle: string;
    vitalSign: string;
    status: "impl" | "partial" | "placeholder";
    color: string;
  };

  // Cores semânticas per spec (S1 azul ... B2 cinza).
  const SUBSYSTEMS: SubsystemDef[] = [
    {
      id: "S1",
      title: "Aprendiz",
      subtitle: "modelo do aprendiz",
      vitalSign: "CASEL × Dreyfus · mood · ledger",
      status: "partial",
      color: "#3b82f6",
    },
    {
      id: "S2",
      title: "Doutrina",
      subtitle: "modelo pedagógico",
      vitalSign: "charter · 5 jogadas · journey",
      status: "partial",
      color: "#10b981",
    },
    {
      id: "S3",
      title: "Decisão",
      subtitle: "motor de decisão (per turn)",
      vitalSign: "assessor · pool · selector",
      status: "impl",
      color: "#eab308",
    },
    {
      id: "S4",
      title: "Expressão",
      subtitle: "motor de expressão (per turn)",
      vitalSign: "materializer · sanitize · gate",
      status: "impl",
      color: "#f97316",
    },
    {
      id: "S5",
      title: "Avaliação",
      subtitle: "guardrail · STS · longitudinal",
      vitalSign: "3 sub-tabs",
      status: "partial",
      color: "#ef4444",
    },
    {
      id: "B1",
      title: "Social",
      subtitle: "atrai/retém",
      vitalSign: "cards · budget · dyad · hooks",
      status: "placeholder",
      color: "#8b5cf6",
    },
    {
      id: "B2",
      title: "Drilling",
      subtitle: "automaticidade (SR)",
      vitalSign: "ausente — ver spec",
      status: "placeholder",
      color: "#6b7280",
    },
  ];

  function handleExpand(ev: CustomEvent<{ id: string }>): void {
    expandedSubsystem.set(ev.detail.id);
  }
</script>

<section
  class="subsystem-grid"
  data-testid="subsystem-grid"
  aria-label="grid 7 subsistemas"
>
  {#each SUBSYSTEMS as sys (sys.id)}
    <SubsystemCard
      id={sys.id}
      title={sys.title}
      subtitle={sys.subtitle}
      vitalSign={sys.vitalSign}
      status={sys.status}
      color={sys.color}
      on:expand={handleExpand}
    />
  {/each}
</section>

<style>
  .subsystem-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    grid-auto-rows: minmax(7.5rem, auto);
    gap: 0.75rem;
    padding: 1rem;
  }
  @media (max-width: 900px) {
    .subsystem-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  @media (max-width: 540px) {
    .subsystem-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
