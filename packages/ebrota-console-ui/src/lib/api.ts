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
  ): Promise<OverrideSelectionResult>;
  getPendingApproval(
    sessionId: string,
  ): Promise<{ proposedText: string } | null>;
  approveOrEdit(
    sessionId: string,
    decision: ApprovalDecisionRequest,
  ): Promise<ApproveOrEditResult>;
  endSession(sessionId: string): Promise<{ closed: boolean }>;
  /** Resolve URL completa pro EventSource consumir SSE. */
  turnStateSseUrl(sessionId: string): string;
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
    overrideSelection: (sessionId, contentItemId) =>
      post<OverrideSelectionResult>(
        `/sessions/${encodeURIComponent(sessionId)}/override`,
        { contentItemId },
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
    turnStateSseUrl: (sessionId) =>
      `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/turn-state`,
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
