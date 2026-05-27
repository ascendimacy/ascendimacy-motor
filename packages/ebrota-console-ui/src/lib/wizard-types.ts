/**
 * Parental Onboarding Wizard — state shape (US-PO-01..11).
 *
 * Mirrora subset relevante de `shared/src/parental-profile.ts` mas mantido
 * separado pra não importar o módulo shared no bundle browser. BFF
 * `/parental/onboarding/complete` é quem serializa pra YAML compatível.
 */

export interface WizardChild {
  id: string;
  name: string;
  age: number;
  primaryLanguage: string;
}

export interface WizardCoParent {
  name: string;
  relation: string;
  permissions: "full" | "view-only";
}

export interface WizardFamily {
  acquirer: { id: string; name: string; relation: string };
  coParent: WizardCoParent | null;
  children: WizardChild[];
}

export interface WizardForbiddenZone {
  topic: string;
  policy: "never" | "soft" | "open";
  reason?: string;
}

export interface WizardBudget {
  sacrificeBudgetCap: number;
  offScreenRatio: number;
  sessionMinutesCap: number;
}

/** axis id 1..12, com nota opcional. */
export interface WizardVirtueChoice {
  axis: number;
  note?: string;
}

/** virtudes por criança (key = childId). */
export type WizardVirtuesByChild = Record<string, WizardVirtueChoice[]>;

export type DayKey =
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat"
  | "sun";

export type WindowZone = "school" | "sleep" | "free" | "window1" | "window2";

/** Janelas por criança × dia. */
export type WizardWindowsByChild = Record<
  string,
  Partial<Record<DayKey, WindowZone>>
>;

export interface WizardConsents {
  storeTrace: boolean;
  emitPhysicalCards: boolean;
  activeHoursMessaging: boolean;
  confirmIsAi: boolean;
}

export interface WizardDyad {
  pairChildIds: string[];
  playbookId: string;
  includeYoungest: boolean;
}

export interface WizardMc1Approval {
  childId: string;
  text: string;
  approved: boolean;
}

export interface WizardState {
  /** Current step 1..11. */
  step: number;
  /** US-PO-01 — timestamp ISO quando "Li, entendi" foi clicado. */
  mc10ReadAt: string | null;
  /** US-PO-02. */
  family: WizardFamily;
  /** US-PO-03. */
  telos: { text: string; tags: string[] };
  /** US-PO-04. */
  forbiddenZones: WizardForbiddenZone[];
  /** US-PO-05 — orçamentos default aplicados a todas as crianças. */
  budget: WizardBudget;
  /** US-PO-06. */
  virtuesByChild: WizardVirtuesByChild;
  /** US-PO-07. */
  windowsByChild: WizardWindowsByChild;
  /** US-PO-08. */
  consents: WizardConsents;
  /** US-PO-09. */
  dyad: WizardDyad | null;
  /** US-PO-10 — uma aprovação por criança. */
  mc1Approvals: WizardMc1Approval[];
  /** US-PO-11 — finalizado. */
  readyForPilot: boolean;
}

export interface Mc10Material {
  beforeBullets: string[];
  duringBullets: string[];
  afterBullets: string[];
  jpPhrases: Array<{ pt: string; jp: string }>;
  escalationPath: string;
}

/** 12 eixos cardeais — labels curtas pra UI. */
export const CARDINAL_AXES: ReadonlyArray<{ id: number; label: string }> = [
  { id: 1, label: "Justiça" },
  { id: 2, label: "Prudência" },
  { id: 3, label: "Fortaleza" },
  { id: 4, label: "Temperança" },
  { id: 5, label: "Curiosidade" },
  { id: 6, label: "Honestidade" },
  { id: 7, label: "Generosidade" },
  { id: 8, label: "Autonomia" },
  { id: 9, label: "Disciplina" },
  { id: 10, label: "Empatia" },
  { id: 11, label: "Criatividade" },
  { id: 12, label: "Perseverança" },
];

export const DEFAULT_TELOS_TAGS = [
  "bilinguismo",
  "autonomia",
  "comunicação_emocional",
  "criatividade",
  "disciplina",
  "conexão_natureza",
  "respeito",
  "curiosidade",
];

export const DEFAULT_FORBIDDEN_ZONES: ReadonlyArray<WizardForbiddenZone> = [
  { topic: "violência gráfica", policy: "never", reason: "default seguro" },
  { topic: "conteúdo sexual", policy: "never", reason: "default seguro" },
  { topic: "drogas e álcool", policy: "never", reason: "default seguro" },
];

export function emptyWizardState(): WizardState {
  return {
    step: 1,
    mc10ReadAt: null,
    family: {
      acquirer: { id: "", name: "", relation: "parent" },
      coParent: null,
      children: [],
    },
    telos: { text: "", tags: [] },
    forbiddenZones: [...DEFAULT_FORBIDDEN_ZONES],
    budget: {
      sacrificeBudgetCap: 100,
      offScreenRatio: 2,
      sessionMinutesCap: 15,
    },
    virtuesByChild: {},
    windowsByChild: {},
    consents: {
      storeTrace: false,
      emitPhysicalCards: false,
      activeHoursMessaging: false,
      confirmIsAi: false,
    },
    dyad: null,
    mc1Approvals: [],
    readyForPilot: false,
  };
}

export function isStep8Complete(consents: WizardConsents): boolean {
  return (
    consents.storeTrace &&
    consents.emitPhysicalCards &&
    consents.activeHoursMessaging &&
    consents.confirmIsAi
  );
}

export function isStep10Complete(
  approvals: WizardMc1Approval[],
  children: WizardChild[],
): boolean {
  if (children.length === 0) return false;
  return children.every((c) =>
    approvals.some((a) => a.childId === c.id && a.approved),
  );
}
