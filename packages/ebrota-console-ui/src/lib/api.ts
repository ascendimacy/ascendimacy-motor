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

export interface ReplayTraceTurn {
  turnNumber?: number;
  sessionId?: string;
  incomingMessage?: string;
  finalResponse?: string;
  timestamp?: string;
  entries?: Array<Record<string, unknown>>;
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

export interface ApiClient {
  getStatus(): Promise<BffStatus>;
  getMode(): Promise<{ mode: ConsoleMode }>;
  setMode(mode: ConsoleMode): Promise<{ mode: ConsoleMode }>;
  startCardSession(
    input: StartCardSessionRequest,
  ): Promise<StartCardSessionOutput>;
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
