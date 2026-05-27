import type { ContentItem, ScoredContentItem } from "./content-item.js";
import type {
  SessionState,
  PersonaDef,
  AdquirenteDef,
  PlaybookIndex,
  EventEntry,
} from "./types.js";
import type { CriticalReason } from "./contracts/critical-reason.js";

export interface PlanTurnInput {
  sessionId: string;
  persona: PersonaDef;
  adquirente: AdquirenteDef;
  inventory: PlaybookIndex[];
  state: SessionState;
  incomingMessage: string;
  /**
   * Hints upstream do caller (orchestrator) — preservados na contextHints
   * de output. Keys atualmente reconhecidas:
   *  - `extracted_signals: string[]` (motor#25 — signal-extractor output;
   *    consumido por `buildSystemPrompt` pra deflection awareness no LLM
   *    rationale, BUG-PL-01).
   *  - `last_user_message: string` (reservado pra recent_turns awareness).
   *  - `recent_turns: Array<{role, content}>` (reservado).
   *
   * Spread inicial em planTurn faz upstream ter prioridade sobre LLM
   * rationale — evita override silencioso.
   */
  contextHints?: Record<string, unknown>;
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
   * TV2-3 (spec ops#1136): trace section opcional. Presente quando
   * caller passou `opts.collector` em planTurn. Inclui contentPool,
   * contextHints, instruction_addition, strategicRationale, entropy +
   * llm_call_ref + duration. Importado tardiamente pra evitar dep loop.
   */
  _trace?: import("./engine-trace-v2.js").PlanejadorTrace;
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
  /**
   * S3 (ops#1145): true quando sinais da sessão indicam crise.
   * Orchestrator pula materializer e despacha protocolo de crise.
   * Default false quando nenhum sinal crítico detectado.
   */
  is_critical: boolean;
  /**
   * S3 (ops#1145): razão primária da crise — 8 gatilhos da cap-54.
   * Presente somente quando is_critical=true.
   */
  critical_reason?: CriticalReason;
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
  /**
   * Sprint 5 #8: assessment snapshot quando USE_SIMPLIFIED_PIPELINE=true.
   * Unified Assessor output exposed pra trace + downstream (Helix, etc).
   * Undefined no fluxo antigo (backward compat).
   */
  assessment?: {
    mood: number;
    mood_method: "rule" | "llm" | "fallback";
    mood_confidence: "high" | "medium" | "low";
    signals: string[];
    engagement: "high" | "medium" | "low" | "disengaging";
  };
  /**
   * Subject Knowledge Fase 2: eventos extraídos pelos writers
   * (DiscoveryWriter + BoundaryEventWriter) durante este turn.
   * Escritos no trace pra BFF scanner indexar em subject_knowledge.
   * Undefined no fluxo antigo (backward compat).
   */
  subjectKnowledgeEvents?: import("./subject-knowledge.js").SubjectKnowledgeEntry[];
  /**
   * Fase 8 PR 2: resolved session state (phase + journey_stage + elapsed).
   * Propagado pro trace pra Console UI Mapa de Jornada (F6) consumir.
   */
  sessionState?: {
    phase: import("./session-phases.js").SessionPhase;
    journey_stage: import("./session-phases.js").JourneyStage;
    elapsed_minutes_estimate: number;
    minutes_until_next_phase: number;
  };
  /**
   * Fase 8 PR 3: StrategyPlan composto pelo Strategist quando
   * journey_stage = applied_double_helix. Apenas no início da sessão
   * (turn baixo / challenge_explain); turns subsequentes referenciam o
   * mesmo plan via session_id.
   */
  strategyPlan?: import("./strategy-plan.js").StrategyPlan;
  /**
   * TV2-4 (spec ops#1136): trace v2 completo do turn. Presente quando
   * handleSimplifiedPipeline cria collector + agrega. STS forwarder
   * (TV2-5) pega daqui e injeta em turn.engineTrace no trace.json.
   */
  engineTrace?: import("./engine-trace-v2.js").EngineTraceV2;
  /**
   * S4 (spec 2026-05-26-s4-separacao-decide-gera-v0): TacticDecision
   * produzida pelo Tactician quando `USE_SPLIT_DROTA=true`. Permite
   * credit assignment (tactic_correct ≠ speech_correct) e replay
   * determinístico do Speaker. Undefined no modo legado.
   */
  tactic_decision?: import("./contracts/tactic-decision.js").TacticDecision;
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
