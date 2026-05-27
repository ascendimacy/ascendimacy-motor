/**
 * Subject Knowledge — fundação pedagógica eBrota.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-25-subject-knowledge-bridge.md
 *
 * Fase 1: tipos de domínio. Tabelas SQL em ebrota-console-bff/src/db.ts.
 * Writers/algoritmos em fases posteriores.
 *
 * Princípio organizador: produto navega o gap entre sujeito-real (descoberto
 * via conversa) e sujeito-proposto (ideal parental + complementos clássicos).
 */

/**
 * Tipos de evento que populam o ledger cross-session do sujeito.
 *
 * - interest/value/need/discovery: alimentam o sujeito-real
 * - boundary_event: sinaliza o que o motor evitou (insumo parental)
 * - presented_concept: Fact materializado (+1pt no eixo tocado)
 * - recall_check_attempt: checagem ativa da IA (+5pt se positive)
 * - vertical_affinity_signal: pista de interesse fora da base (candidato a flash)
 */
export type SubjectKnowledgeType =
  | "interest"
  | "value"
  | "need"
  | "discovery"
  | "boundary_event"
  | "presented_concept"
  | "recall_check_attempt"
  | "vertical_affinity_signal"
  | "axis_attempt_outcome";

export type SubjectKnowledgeSource =
  | "self_declared"
  | "parent_claimed"
  | "motor_inferred";

export type SubjectKnowledgeAlignment =
  | "aligned"
  | "neutral"
  | "divergent"
  | "unknown";

export interface SubjectKnowledgeEntry {
  id: string;
  subject_id: string;
  type: SubjectKnowledgeType;
  source: SubjectKnowledgeSource;
  confidence: number;
  /** turn_ref quando foi confirmado; null = pendente (caso parent_claimed sem confirmação). */
  confirmed_at: string | null;
  alignment: SubjectKnowledgeAlignment;
  /** Estrutura específica por type; ver spec §3.1.1 ou helpers abaixo. */
  payload: SubjectKnowledgePayload;
  turn_ref: string;
  session_id: string;
  created_at: string;
}

export type SubjectKnowledgePayload =
  | InterestPayload
  | ValuePayload
  | NeedPayload
  | DiscoveryPayload
  | BoundaryEventPayload
  | PresentedConceptPayload
  | RecallCheckAttemptPayload
  | VerticalAffinitySignalPayload
  | AxisAttemptOutcomePayload;

export interface InterestPayload {
  kind: "interest";
  label: string;
  evidence_phrase?: string;
  intensity?: "low" | "mid" | "high";
}

export interface ValuePayload {
  kind: "value";
  label: string;
  evidence_phrase?: string;
}

export interface NeedPayload {
  kind: "need";
  label: string;
  reported_by_parent?: boolean;
}

export interface DiscoveryPayload {
  kind: "discovery";
  label: string;
  detail?: string;
}

export interface BoundaryEventPayload {
  kind: "boundary_event";
  signal_type:
    | "deflection_thematic"
    | "gatekeeper_resistance"
    | "frame_rejection"
    | "distress_marker_low"
    | "distress_marker_high"
    | "exit_marker_implicit"
    | "exit_marker_explicit"
    | "mood_drift_down";
  /** Categoria abstraída — NÃO conteúdo literal. Privacidade do sujeito. */
  topic_category: string;
  intensity: "low" | "mid" | "high";
  motor_response: "muda_tema" | "suaviza" | "recua_total" | "outro";
  severity_band: "routine" | "clinical_signal";
}

export interface PresentedConceptPayload {
  kind: "presented_concept";
  concept_id: string;
  keywords: string[];
  /** "tradicao/complemento" — ex: "estoica/dicotomia_controle" */
  lineage_anchor: string;
  /** 1..12 do catálogo de eixos */
  axis_id: number;
  family: "carater" | "disposicao" | "cognicao_si";
  points: 1;
}

export interface RecallCheckAttemptPayload {
  kind: "recall_check_attempt";
  concept_id_referenced: string;
  framing_used: string;
  result: "positive" | "negative" | "ambiguous";
  points_awarded: 0 | 5;
}

export interface VerticalAffinitySignalPayload {
  kind: "vertical_affinity_signal";
  vertical_kind: "axis" | "lineage";
  vertical_id: string;
  score_affinity: number;
}

/**
 * Scorer Objective-Driven sub-fase 5.1 — outcome de tentativa por (item, axis).
 *
 * Spec ops#1133 §3.2. DiscoveryWriter (sub-fase 5.5) detecta engagement do
 * turn N+1 sobre item apresentado no turn N e grava este payload. Scorer
 * (sub-fase 5.6) consulta histórico pra computar `surpriseEfetivo` — surprise
 * estática decresce por (item, sujeito) quando engagement falhou.
 *
 * `signal_basis`: lista signals que levaram à classificação (e.g.,
 * `["frame_rejection","mood_drift_down"]` → deflected; `["positive_mood"]` →
 * engaged). `penalty_applied`: pontos a descontar do surprise quando o item
 * voltar a ser scored (cumulativo cross-session).
 */
export interface AxisAttemptOutcomePayload {
  kind: "axis_attempt_outcome";
  item_id: string;
  axis_id: number;
  outcome: "engaged" | "deflected" | "neutral";
  signal_basis: string[];
  penalty_applied: number;
}

/**
 * Sujeito-proposto materializado: ideal parental + complementos clássicos
 * escolhidos do catálogo de lineage. Versionado — muda quando pais ajustam.
 */
export interface SubjectProposed {
  subject_id: string;
  version: number;
  /** IDs dos eixos do catálogo (1..12) ativos no programa. */
  axes_active: number[];
  /** Por eixo, lista de complement_ids (do catálogo) ativos. */
  complements_per_axis: Record<number, string[]>;
  /** Explicação por eixo: por que esses complementos foram propostos. */
  reasoning_log: Record<number, string>;
  /** ISO timestamp quando os pais ratificaram explicitamente. null = pendente. */
  ratified_at: string | null;
  last_modified_at: string;
}
