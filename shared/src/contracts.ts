import type { ContentItem, ScoredContentItem } from "./content-item.js";
import type {
  SessionState,
  PersonaDef,
  AdquirenteDef,
  PlaybookIndex,
  EventEntry,
} from "./types.js";

export interface PlanTurnInput {
  sessionId: string;
  persona: PersonaDef;
  adquirente: AdquirenteDef;
  inventory: PlaybookIndex[];
  state: SessionState;
  incomingMessage: string;
}

export interface PlanTurnOutput {
  strategicRationale: string;
  /**
   * Top 1-5 items scorados do pool.
   * Substitui `candidateActions` (removido Bloco 2a).
   */
  contentPool: ScoredContentItem[];
  contextHints: Record<string, unknown>;
  /**
   * Composed pelo planejador quando mixin ativo (ex: withGardnerProgram).
   * Repassado para `EvaluateAndSelectInput.instruction_addition` (Bloco 2b).
   */
  instruction_addition?: string;
  /**
   * motor#25: Trigger Evaluator results das transições do perfil avaliadas
   * neste turn. Read-only — orchestrator loga cada como transition_evaluated
   * event. Statusmatrix NÃO move automático (continua via inject_status).
   */
  transitionEvaluations?: import("./transitions-schema.js").TransitionEvaluationResult[];
  /**
   * motor#25: Shannon entropy do pool antes de retornar (signal de
   * diversificação upstream do drota). Útil pra debug carrossel.
   */
  candidateSetEntropy?: number;
}

export interface EvaluateAndSelectInput {
  sessionId: string;
  contentPool: ScoredContentItem[];
  state: SessionState;
  persona: PersonaDef;
  strategicRationale: string;
  contextHints: Record<string, unknown>;
  /**
   * Slot para continuidade multi-dia / technique hints (Bloco 3/5).
   * Bloco 2a sempre passa string vazia ou omite. Ver plano v2 A.2.
   */
  instruction_addition?: string;
}

export interface EvaluateAndSelectOutput {
  /** Item escolhido do pool (com score + reasons preservados). */
  selectedContent: ScoredContentItem;
  selectionRationale: string;
  linguisticMaterialization: string;
  /**
   * motor#25 (handoff #24 Tarefa 3): preenchido quando parse do output do LLM
   * falhou (ex: modelo abriu com "Could not generate response..." em vez de JSON).
   * Hard fallback usa contentPool[0] e linguisticMaterialization vazia. Caller
   * decide se aborta turn ou usa fallback.
   *
   * Valores: "parse_failure" (regex extract falhou), "json_invalid_after_extract"
   * (regex achou {} mas parse fracassou).
   */
  skipReason?: string;
  /** motor#25: head do raw output pra debug log quando skipReason populado. */
  rawOutput?: string;
}

export interface ExecutePlaybookInput {
  sessionId: string;
  /** Deploy profile (e.g. "kids.session" / "drota.session"). */
  playbookId: string;
  /** Id do content item materializado, se houve — para trace + updates. */
  selectedContentId?: string;
  output: string;
  metadata: Record<string, unknown>;
}

export interface ExecutePlaybookOutput {
  success: boolean;
  newState: SessionState;
  eventLogged: EventEntry;
}

/** Re-export conveniente para consumidores. */
export type { ContentItem, ScoredContentItem };
