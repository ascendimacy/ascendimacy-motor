/**
 * Cliente HTTP/SSE pro BFF (porta 3737, proxy /api em vite dev).
 *
 * Em prod build (vite build), proxy não existe — caller deve usar
 * `baseUrl` configurável. Default em dev = "/api" (proxied).
 *
 * SSE via EventSource (browser nativo). Endpoints retornam JSON puro
 * via fetch.
 */

import type {
  BffStatus,
  ConsoleMode,
  StartCardSessionOutput,
  TurnStateEvent,
} from "./types.js";

export interface ApiClientOptions {
  /** Base URL pro BFF. Default "/api" (vite proxy em dev). Em prod,
   *  setar pra URL absoluta do BFF. */
  baseUrl?: string;
  /** fetch impl injetável pra testes. Default global fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface StartCardSessionRequest {
  cardId: string;
  conversationId: string;
  from: string;
  pkg: { cardId: string; raw: string; sourcePath: string };
  personaId?: string;
}

export interface OverrideSelectionResult {
  accepted: boolean;
  foundInPool: boolean;
  gateWasActive: boolean;
}

export interface ApproveOrEditResult {
  accepted: boolean;
  gateWasActive: boolean;
}

export interface ScoredContentItemSummary {
  item: {
    id: string;
    type?: string;
    domain?: string;
    fact?: string;
    bridge?: string;
    quest?: string;
    [key: string]: unknown;
  };
  score: number;
  reasons?: string[];
}

export interface ApprovalDecisionRequest {
  approved: boolean;
  editedText?: string;
  rationale?: string;
  /** Pra Edit Learner v0 (BFF persistência) — turn + originalText. */
  turn?: number;
  originalText?: string;
}

export interface OverrideRequest {
  contentItemId: string;
  /** Pra Edit Learner v0 (BFF persistência). */
  turn?: number;
  rationale?: string;
}

export interface JunDecisionEntry {
  id: number;
  sessionId: string;
  turn: number;
  decision: "approve" | "edit" | "reject" | "override" | "auto";
  originalText: string | null;
  finalText: string | null;
  overrideCardId: string | null;
  rationale: string | null;
  recordedAt: string;
}

export interface SessionLibraryFilters {
  persona?: string;
  kind?: "real" | "sts";
  fromIso?: string;
  toIso?: string;
  hasOverrides?: boolean;
  q?: string;
  limit?: number;
}

export interface SessionLibraryEntry {
  sessionId: string;
  personaId: string;
  conversationId: string;
  kind: "real" | "sts";
  startedAt: string;
  endedAt: string | null;
  turnCount: number;
  hasOverrides: boolean;
  tracePath: string | null;
}

export interface ReplayScoredItemLike {
  item?: { id?: string; type?: string; domain?: string; axis_id?: number } & Record<string, unknown>;
  score?: number;
  reasons?: string[];
}

export interface ReplayMotorTraceLike {
  plan?: {
    contextHints?: unknown;
    instruction_addition?: string;
    strategicRationale?: string;
    candidateSetEntropy?: number;
    contentPool?: ReplayScoredItemLike[];
  };
  drota?: {
    selectedContent?: ReplayScoredItemLike;
    selectionRationale?: string;
    linguisticMaterialization?: string;
    subjectKnowledgeEvents?: unknown[];
  };
  exec?: {
    eventLogged?: unknown;
    newState?: unknown;
    success?: boolean;
  };
}

// ─── EngineTraceV2Like — TV2 (sub-fase TV2-6) ────────────────────────────
//
// Shape duck-typed que mirrora `EngineTraceV2` de shared/src/engine-trace-v2.ts.
// Duplicado aqui pra não importar shared no bundle browser. Mantém apenas
// os campos consumidos pela UI; campos não-renderizados ficam `unknown`.
//
// Coexiste com `motorTrace` (v1) — se ambos presentes, UI prioriza v2.

export interface EngineTraceStateDiffLike {
  journey_stage_transition?: { from: string; to: string; trigger?: string };
  helix_advance?: {
    dimension_changed?: boolean;
    level_changed?: boolean;
    cycle_completed?: boolean;
  };
  subject_knowledge_added_count?: number;
  trust_delta?: number;
  budget_delta?: number;
  session_phase_transition?: { from: string; to: string };
}

export interface EngineTraceAssessorLike {
  inputs?: { user_message?: string; turn_history_window?: number };
  outputs?: {
    mood?: number;
    signals?: string[];
    engagement?: string;
  };
  mood_method?: "rule" | "llm" | "fallback";
  duration_ms?: number;
  llm_call_ref?: string;
}

export interface EngineTracePlanejadorLike {
  inputs?: Record<string, unknown>;
  outputs?: {
    contentPool?: ReplayScoredItemLike[];
    strategicRationale?: string;
    candidateSetEntropy?: number;
    instruction_addition?: string;
    contextHints?: unknown;
  };
  triageDecision?: { route?: string; reason?: string };
  triggerEvaluation?: { transitions_checked?: string[]; fired?: string };
  llm_call_ref?: string;
  duration_ms?: number;
}

export interface EngineTraceStrategistLike {
  inputs?: {
    journey_stage?: string;
    latent_needs?: string[];
    current_objectives?: Array<Record<string, unknown>>;
  };
  outputs?: {
    plan_id?: string;
    target_demonstrations?: Array<Record<string, unknown>>;
    playbook_composition?: Array<Record<string, unknown>>;
  };
  composition_method?: "template_v1" | "llm";
  duration_ms?: number;
}

export interface EngineTraceSelectorLike {
  inputs?: { pool_size?: number; mood?: number; budget?: number };
  filters_applied?: Array<{
    name: string;
    items_removed?: string[];
    reason?: string;
  }>;
  outputs?: { selected_id?: string; pool_remaining?: string[] };
  duration_ms?: number;
}

export interface EngineTraceMaterializerLike {
  inputs?: {
    selected_item_id?: string;
    instruction_addition?: string;
    user_message?: string;
  };
  stable_prefix_hash?: string;
  user_message_constructed?: string;
  outputs?: { raw_response?: string; final_text?: string };
  llm_call_ref?: string;
  duration_ms?: number;
}

export interface EngineTraceSkWriteLike {
  type: string;
  payload?: Record<string, unknown>;
  writer?: string;
  triggered_by?: string;
}

export interface EngineTraceWarningLike {
  component: string;
  message: string;
  recoverable?: boolean;
}

export interface EngineTraceV2Like {
  schema_version?: number;
  turn_started_at?: string;
  turn_completed_at?: string;
  pre_state?: Record<string, unknown>;
  post_state?: Record<string, unknown>;
  state_diff?: EngineTraceStateDiffLike;
  components?: {
    unified_assessor?: EngineTraceAssessorLike;
    planejador?: EngineTracePlanejadorLike;
    strategist?: EngineTraceStrategistLike;
    pragmatic_selector?: EngineTraceSelectorLike;
    constrained_materializer?: EngineTraceMaterializerLike;
  };
  llm_calls?: LlmCallLike[];
  subject_knowledge_writes?: EngineTraceSkWriteLike[];
  warnings?: EngineTraceWarningLike[];
}

export interface ReplayTraceTurn {
  turnNumber?: number;
  sessionId?: string;
  incomingMessage?: string;
  finalResponse?: string;
  timestamp?: string;
  entries?: Array<Record<string, unknown>>;

  // ─── engine x-ray (S-OC-22 follow-up) — read straight from raw trace ────
  /** Trust level pós-turn (0..1). */
  trustLevel?: number;
  /** Budget restante pra sessão (qualquer escala). */
  budgetRemaining?: number;
  playbookId?: string;
  durationMs?: number;
  /** Razão de skip de card emission, quando aplicável. */
  cardEmissionSkipReason?: string;

  /** Trace estruturado do motor pipeline (plan / drota / exec). */
  motorTrace?: ReplayMotorTraceLike;

  /**
   * Engine Trace v2 (sub-fase TV2-6) — full engine telemetry per turn.
   * Convive com motorTrace v1: quando ambos presentes, UI prioriza v2.
   * Quando ausente, UI cai pra v1 (motorTrace) sem mudança comportamental.
   */
  engineTrace?: EngineTraceV2Like;

  /**
   * Subject Knowledge events emitidos por writers neste turn. Pode estar
   * no nível do turn (preferido) OU em motorTrace.drota.subjectKnowledgeEvents
   * (legacy STS schema).
   */
  subjectKnowledgeEvents?: unknown[];
}

export interface ReplayTrace {
  sessionId?: string;
  persona?: string;
  startedAt?: string;
  endedAt?: string;
  turns?: ReplayTraceTurn[];
}

export interface PersonaSummary {
  personaId: string;
  sessionCount: number;
  realCount: number;
  stsCount: number;
  totalTurns: number;
  totalOverrides: number;
  overrideRate: number;
  lastSessionAt: string | null;
  firstSessionAt: string | null;
}

export interface PersonaEvolutionSession {
  sessionId: string;
  startedAt: string;
  kind: "real" | "sts";
  turnCount: number;
  hasOverrides: boolean;
  overrideCount: number;
}

export interface PersonaEvolution {
  personaId: string;
  summary: PersonaSummary;
  sessions: PersonaEvolutionSession[];
}

export interface DebugLlmCallEvent {
  id: number;
  receivedAt: string;
  step: string;
  provider: "anthropic" | "infomaniak" | "local" | "unknown";
  model: string;
  prompt: {
    system?: string;
    user?: string;
    assistantPrefill?: string;
    raw?: string;
  };
  params?: Record<string, unknown>;
  sessionId?: string;
  turn?: number;
}

// ─── B1/B2 wiring (Camada Social + Drilling) ─────────────────────

export interface TemporalWindowEntryLike {
  name: string;
  weekday: string[];
  start_local: string;
  end_local: string;
  max_hooks_per_day: number;
  requires_parental_ok: boolean;
}

export interface TemporalWindowLike {
  persona_id: string;
  timezone: string;
  windows: TemporalWindowEntryLike[];
  sleep_window?: { start_local: string; end_local: string };
  school_window?: { start_local: string; end_local: string };
}

export interface PulsoEventLike {
  emitted_at: string;
  trigger: string;
  pulso_kind: string;
  text: string;
}

export interface SacrificeBudgetSnapshotLike {
  persona_id: string;
  baseline: number;
  current: number;
  mood: number;
  trust: number;
  modifiers: Array<{ label: string; delta: number; active: boolean }>;
  source: string;
}

export interface EmittedCardLike {
  card_id: string;
  child_id: string;
  session_id: string;
  archetype_id: string;
  signature: string;
  emitted_at: string;
  front: {
    title?: string;
    rarity?: string;
    [k: string]: unknown;
  };
  back: {
    serial_number?: string;
    cheat_code?: string;
    qr_payload?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface DyadConfigLike {
  dyad: {
    members?: string[];
    playbook?: string;
    [k: string]: unknown;
  } | null;
  source: string;
}

export interface DrillBankSummaryLike {
  bank_id: string;
  title: string;
  curator: string;
  item_count: number;
  target_personas: string[];
}

export interface DrillBankDetailLike {
  bank: {
    bank_id: string;
    title: string;
    curator: string;
    license?: string;
    target_personas?: string[];
  };
  items: Array<{
    id: string;
    bank_id: string;
    type: string;
    axis: string;
    difficulty: number;
    payload: { prompt: string; answer: string; hint?: string };
  }>;
}

export interface DrillStateLike {
  persona_id: string;
  item_id: string;
  presented_count: number;
  correct_count: number;
  last_seen_at: string;
  next_due_at: string;
  current_interval_days: number;
  current_easiness: number;
  mastery_reached_at: string | null;
  last_5_attempts: string[];
}

export interface ApiClient {
  getStatus(): Promise<BffStatus>;
  getMode(): Promise<{ mode: ConsoleMode }>;
  setMode(mode: ConsoleMode): Promise<{ mode: ConsoleMode }>;
  startCardSession(
    input: StartCardSessionRequest,
  ): Promise<StartCardSessionOutput>;
  /** Retorna sessionIds de sessões atualmente ativas no BFF (Fix 3). */
  getActiveSessions(): Promise<{ sessionIds: string[] }>;
  listOptions(
    sessionId: string,
  ): Promise<{ contentPool: ScoredContentItemSummary[] }>;
  overrideSelection(
    sessionId: string,
    contentItemId: string,
    extras?: { turn?: number; rationale?: string },
  ): Promise<OverrideSelectionResult>;
  listDecisions(
    sessionId: string,
    limit?: number,
  ): Promise<{ decisions: JunDecisionEntry[] }>;
  getPendingApproval(
    sessionId: string,
  ): Promise<{ proposedText: string } | null>;
  approveOrEdit(
    sessionId: string,
    decision: ApprovalDecisionRequest,
  ): Promise<ApproveOrEditResult>;
  endSession(sessionId: string): Promise<{ closed: boolean }>;
  listSessionLibrary(
    filters?: SessionLibraryFilters,
  ): Promise<{ sessions: SessionLibraryEntry[] }>;
  getSessionReplay(sessionId: string): Promise<ReplayTrace>;
  listDebugLlmCalls(
    sinceId?: number,
  ): Promise<{ events: DebugLlmCallEvent[]; totalEmitted: number }>;
  clearDebugLlmCalls(): Promise<{ cleared: boolean }>;
  listAnalyticsPersonas(): Promise<{ personas: PersonaSummary[] }>;
  getPersonaEvolution(personaId: string): Promise<PersonaEvolution>;
  /** Resolve URL completa pro EventSource consumir SSE. */
  turnStateSseUrl(sessionId: string): string;

  // ─── Subject Knowledge + Journey + Maps (Mini-UI tracer views) ─────
  listSubjectDiscoveries(
    subjectId: string,
    opts?: { type?: string; limit?: number },
  ): Promise<{ discoveries: SubjectKnowledgeEntryLike[] }>;
  listSubjectBoundaries(
    subjectId: string,
    opts?: { limit?: number },
  ): Promise<{ boundaries: SubjectKnowledgeEntryLike[] }>;
  getBoundariesSummary(
    subjectId: string,
  ): Promise<{ summary: BoundarySummary[] }>;
  getJourneyState(subjectId: string): Promise<{ state: JourneyStateLike }>;
  setJourneyOverride(
    subjectId: string,
    stage: string,
    reason: string,
  ): Promise<{ state: JourneyStateLike }>;
  clearJourneyOverride(subjectId: string): Promise<{ state: JourneyStateLike }>;
  listFrameworks(): Promise<{ frameworks: FrameworkMeta[] }>;
  getSubjectMaps(
    subjectId: string,
    frameworkIds?: string[],
  ): Promise<{ maps: SubjectMapLike }>;

  // ─── Strategist (Fase 8 PR 3) ───────────────────────────────────
  /** Plan composto pra uma sessão. 404 quando não existe. */
  getSessionStrategyPlan(
    sessionId: string,
  ): Promise<{ plan: StrategyPlanLike } | { error: string }>;
  /** Histórico recente de StrategyPlans do sujeito. */
  listSubjectStrategyPlans(
    subjectId: string,
    opts?: { limit?: number },
  ): Promise<{ plans: StrategyPlanLike[] }>;

  // ─── B1 Camada Social ───────────────────────────────────────────
  /** TemporalWindow YAML parseada. Pode retornar null se 404. */
  getTemporalWindows(personaId: string): Promise<TemporalWindowLike | null>;
  /** Pulso events recentes da persona (V0: stub vazio). */
  listPulsoEvents(personaId: string): Promise<{ events: PulsoEventLike[] }>;
  /** Sacrifice budget snapshot (V0: derivado de defaults, source=stub_v0). */
  getSacrificeBudget(
    personaId: string,
    opts?: { mood?: number; trust?: number },
  ): Promise<SacrificeBudgetSnapshotLike>;
  /** Cards emitidos para a persona. */
  listEmittedCards(
    personaId: string,
  ): Promise<{ cards: EmittedCardLike[] }>;
  /** Configuração de dyad ativo (V0: stub null). */
  getDyad(personaId: string): Promise<DyadConfigLike>;

  // ─── B2 Drilling ────────────────────────────────────────────────
  /** Lista banks disponíveis em fixtures/banks/. */
  listBanks(): Promise<{ banks: DrillBankSummaryLike[] }>;
  /** Conteúdo completo de um bank por id. */
  getBank(bankId: string): Promise<DrillBankDetailLike>;
  /** Todos os DrillStates da persona. */
  listDrillStates(
    personaId: string,
  ): Promise<{ states: DrillStateLike[] }>;
  /** DrillStates due agora. */
  listDrillDue(
    personaId: string,
  ): Promise<{ states: DrillStateLike[] }>;
  /** DrillStates que atingiram mastery. */
  listDrillMastered(
    personaId: string,
  ): Promise<{ states: DrillStateLike[] }>;
}

export interface SubjectKnowledgeEntryLike {
  id: string;
  type: string;
  source: string;
  confidence: number;
  payload: Record<string, unknown>;
  turn_ref: string;
  session_id: string;
  created_at: string;
}

export interface BoundarySummary {
  topic_category: string;
  count: number;
  high_intensity_count: number;
  last_seen_at: string;
}

export interface JourneyStateLike {
  subject_id: string;
  stage: "discovery_only" | "mapping_ready" | "applied_double_helix";
  stage_entered_at: string;
  discoveries_count: number;
  families_covered: string[];
  override_by_parent?: { forced_stage: string; reason: string; timestamp: string };
  last_updated_at: string;
}

export interface FrameworkMeta {
  id: string;
  display_name: string;
  dimensions: readonly string[];
  render_hint: "radar" | "bar" | "tree" | "list";
}

export interface SubjectMapLike {
  subject_id: string;
  computed_at: string;
  positions: Record<string, Record<string, unknown>>;
}

export interface TargetDemonstrationLike {
  framework: string;
  dimension: string;
  goal: "expose" | "explore" | "challenge" | "consolidate";
  rationale: string;
}

export interface PlaybookCompositionStepLike {
  move_id: string;
  phase: string;
  estimated_minutes: number;
  content_inputs?: string[];
  success_signal: string;
}

export interface StrategyPlanLike {
  session_id: string;
  subject_id: string;
  composed_at: string;
  target_demonstrations: TargetDemonstrationLike[];
  playbook_composition: PlaybookCompositionStepLike[];
  overall_success_criteria: string;
  fallback_strategy?: string;
  demonstrations_observed?: TargetDemonstrationLike[];
}

/**
 * UI-side duck-type pra LlmCallTrace (shared/src/engine-trace-v2.ts).
 * Não importamos do shared porque o bundle UI é browser-only — repetimos
 * apenas os campos consumidos pelo LlmXrayPanel. Spec TV2-7.
 */
export interface LlmCallLike {
  id: string;
  role: string;
  provider: string;
  model: string;
  prompt: string;
  response: string;
  duration_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_cache_hit?: boolean;
  redacted?: boolean;
  error?: string;
}

export function createApiClient(opts: ApiClientOptions = {}): ApiClient {
  const baseUrl = opts.baseUrl ?? "/api";
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);

  const get = async <T>(path: string): Promise<T> => {
    const res = await f(`${baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(
        `BFF GET ${path} failed: ${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as T;
  };

  const post = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await f(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new Error(
        `BFF POST ${path} failed: ${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as T;
  };

  return {
    getStatus: () => get<BffStatus>("/status"),
    getMode: () => get<{ mode: ConsoleMode }>("/mode"),
    setMode: (mode) => post<{ mode: ConsoleMode }>("/mode", { mode }),
    startCardSession: (input) =>
      post<StartCardSessionOutput>("/sessions/start-card", input),
    getActiveSessions: () =>
      get<{ sessionIds: string[] }>("/sessions/active"),
    listOptions: (sessionId) =>
      get<{ contentPool: ScoredContentItemSummary[] }>(
        `/sessions/${encodeURIComponent(sessionId)}/options`,
      ),
    overrideSelection: (sessionId, contentItemId, extras) =>
      post<OverrideSelectionResult>(
        `/sessions/${encodeURIComponent(sessionId)}/override`,
        { contentItemId, ...(extras ?? {}) },
      ),
    listDecisions: (sessionId, limit) =>
      get<{ decisions: JunDecisionEntry[] }>(
        `/sessions/${encodeURIComponent(sessionId)}/decisions${
          limit !== undefined ? `?limit=${limit}` : ""
        }`,
      ),
    getPendingApproval: (sessionId) =>
      get<{ proposedText: string } | null>(
        `/sessions/${encodeURIComponent(sessionId)}/pending-approval`,
      ),
    approveOrEdit: (sessionId, decision) =>
      post<ApproveOrEditResult>(
        `/sessions/${encodeURIComponent(sessionId)}/approve`,
        decision,
      ),
    endSession: (sessionId) =>
      post<{ closed: boolean }>(
        `/sessions/${encodeURIComponent(sessionId)}/end`,
      ),
    listSessionLibrary: (filters) => {
      const params = new URLSearchParams();
      if (filters?.persona !== undefined) params.set("persona", filters.persona);
      if (filters?.kind !== undefined) params.set("kind", filters.kind);
      if (filters?.fromIso !== undefined) params.set("from", filters.fromIso);
      if (filters?.toIso !== undefined) params.set("to", filters.toIso);
      if (filters?.hasOverrides === true)
        params.set("hasOverrides", "true");
      if (filters?.q !== undefined && filters.q.length > 0)
        params.set("q", filters.q);
      if (filters?.limit !== undefined)
        params.set("limit", String(filters.limit));
      const query = params.toString();
      return get<{ sessions: SessionLibraryEntry[] }>(
        `/sessions/library${query.length > 0 ? `?${query}` : ""}`,
      );
    },
    listDebugLlmCalls: (sinceId) =>
      get<{ events: DebugLlmCallEvent[]; totalEmitted: number }>(
        sinceId !== undefined
          ? `/debug/llm-calls?sinceId=${sinceId}`
          : "/debug/llm-calls",
      ),
    clearDebugLlmCalls: async () => {
      const res = await f(`${baseUrl}/debug/llm-calls`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(
          `BFF DELETE /debug/llm-calls failed: ${res.status}`,
        );
      }
      return (await res.json()) as { cleared: boolean };
    },
    getSessionReplay: (sessionId) =>
      get<ReplayTrace>(
        `/sessions/${encodeURIComponent(sessionId)}/replay`,
      ),
    listAnalyticsPersonas: () =>
      get<{ personas: PersonaSummary[] }>("/analytics/personas"),
    getPersonaEvolution: (personaId) =>
      get<PersonaEvolution>(
        `/analytics/personas/${encodeURIComponent(personaId)}/evolution`,
      ),
    turnStateSseUrl: (sessionId) =>
      `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/turn-state`,

    // ── Mini-UI tracer views ─────────────────────────────────────
    listSubjectDiscoveries: (subjectId, opts) => {
      const params = new URLSearchParams();
      if (opts?.type !== undefined) params.set("type", opts.type);
      if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
      const q = params.toString();
      return get<{ discoveries: SubjectKnowledgeEntryLike[] }>(
        `/subjects/${encodeURIComponent(subjectId)}/discoveries${q ? `?${q}` : ""}`,
      );
    },
    listSubjectBoundaries: (subjectId, opts) => {
      const params = new URLSearchParams();
      if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
      const q = params.toString();
      return get<{ boundaries: SubjectKnowledgeEntryLike[] }>(
        `/subjects/${encodeURIComponent(subjectId)}/boundaries${q ? `?${q}` : ""}`,
      );
    },
    getBoundariesSummary: (subjectId) =>
      get<{ summary: BoundarySummary[] }>(
        `/subjects/${encodeURIComponent(subjectId)}/boundaries/summary`,
      ),
    getJourneyState: (subjectId) =>
      get<{ state: JourneyStateLike }>(
        `/subjects/${encodeURIComponent(subjectId)}/journey-state`,
      ),
    setJourneyOverride: (subjectId, stage, reason) =>
      post<{ state: JourneyStateLike }>(
        `/subjects/${encodeURIComponent(subjectId)}/journey-state/override`,
        { stage, reason },
      ),
    clearJourneyOverride: async (subjectId) => {
      const res = await f(
        `${baseUrl}/subjects/${encodeURIComponent(subjectId)}/journey-state/override`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        throw new Error(
          `BFF DELETE journey-state/override failed: ${res.status}`,
        );
      }
      return (await res.json()) as { state: JourneyStateLike };
    },
    listFrameworks: () =>
      get<{ frameworks: FrameworkMeta[] }>("/frameworks"),
    getSubjectMaps: (subjectId, frameworkIds) => {
      const params = new URLSearchParams();
      if (frameworkIds && frameworkIds.length > 0) {
        params.set("framework", frameworkIds.join(","));
      }
      const q = params.toString();
      return get<{ maps: SubjectMapLike }>(
        `/subjects/${encodeURIComponent(subjectId)}/maps${q ? `?${q}` : ""}`,
      );
    },
    getSessionStrategyPlan: async (sessionId) => {
      const res = await f(
        `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/strategy-plan`,
      );
      if (res.status === 404) {
        return { error: "strategy_plan não encontrado" };
      }
      if (!res.ok) {
        throw new Error(
          `BFF GET strategy-plan failed: ${res.status} ${res.statusText}`,
        );
      }
      return (await res.json()) as { plan: StrategyPlanLike };
    },
    listSubjectStrategyPlans: (subjectId, opts) => {
      const params = new URLSearchParams();
      if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
      const q = params.toString();
      return get<{ plans: StrategyPlanLike[] }>(
        `/subjects/${encodeURIComponent(subjectId)}/strategy-plans${q ? `?${q}` : ""}`,
      );
    },

    // ─── B1 ─────────────────────────────────────────────────────────
    getTemporalWindows: async (personaId) => {
      const res = await f(
        `${baseUrl}/personas/${encodeURIComponent(personaId)}/temporal-windows`,
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(
          `BFF GET temporal-windows failed: ${res.status} ${res.statusText}`,
        );
      }
      return (await res.json()) as TemporalWindowLike;
    },
    listPulsoEvents: (personaId) =>
      get<{ events: PulsoEventLike[] }>(
        `/personas/${encodeURIComponent(personaId)}/pulso-events`,
      ),
    getSacrificeBudget: (personaId, opts) => {
      const params = new URLSearchParams();
      if (opts?.mood !== undefined) params.set("mood", String(opts.mood));
      if (opts?.trust !== undefined) params.set("trust", String(opts.trust));
      const q = params.toString();
      return get<SacrificeBudgetSnapshotLike>(
        `/personas/${encodeURIComponent(personaId)}/sacrifice-budget${q ? `?${q}` : ""}`,
      );
    },
    listEmittedCards: (personaId) =>
      get<{ cards: EmittedCardLike[] }>(
        `/personas/${encodeURIComponent(personaId)}/cards`,
      ),
    getDyad: (personaId) =>
      get<DyadConfigLike>(
        `/personas/${encodeURIComponent(personaId)}/dyad`,
      ),

    // ─── B2 ─────────────────────────────────────────────────────────
    listBanks: () => get<{ banks: DrillBankSummaryLike[] }>("/banks"),
    getBank: (bankId) =>
      get<DrillBankDetailLike>(`/banks/${encodeURIComponent(bankId)}`),
    listDrillStates: (personaId) =>
      get<{ states: DrillStateLike[] }>(
        `/personas/${encodeURIComponent(personaId)}/drill-state`,
      ),
    listDrillDue: (personaId) =>
      get<{ states: DrillStateLike[] }>(
        `/personas/${encodeURIComponent(personaId)}/drill-due`,
      ),
    listDrillMastered: (personaId) =>
      get<{ states: DrillStateLike[] }>(
        `/personas/${encodeURIComponent(personaId)}/drill-mastered`,
      ),
  };
}

/**
 * Helper pra abrir EventSource e processar TurnStateEvents com handler
 * tipado. Retorna função pra fechar conexão.
 */
export function subscribeTurnState(
  client: ApiClient,
  sessionId: string,
  onEvent: (event: TurnStateEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const url = client.turnStateSseUrl(sessionId);
  const es = new EventSource(url);
  es.onmessage = (ev) => {
    try {
      const parsed = JSON.parse(ev.data) as TurnStateEvent;
      onEvent(parsed);
    } catch (err) {
      onError?.(new ErrorEvent("parse-error", { error: err }));
    }
  };
  es.onerror = (err) => {
    onError?.(err);
  };
  return () => es.close();
}
