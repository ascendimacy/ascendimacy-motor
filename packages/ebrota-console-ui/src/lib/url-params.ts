/**
 * Parse de URL query params pra deep links do smoke visualizer
 * (S-OC-22 / Fase F C-MX-08).
 *
 * Convenção: BFF /replay/:id e /live/:id redirecionam pro UI com
 * ?replay=ID ou ?live=ID. UI lê no mount + atualiza stores
 * apropriadas.
 *
 * Pure function pra testabilidade — App.svelte chama on mount com
 * window.location.search.
 */

export interface UrlParamsResult {
  /** sessionId pra abrir replay modal. */
  replaySessionId: string | null;
  /** sessionId pra setar como currentSessionId (live SSE). */
  liveSessionId: string | null;
}

export function parseUrlParams(search: string): UrlParamsResult {
  const params = new URLSearchParams(search);
  const replay = params.get("replay");
  const live = params.get("live");
  // Replay tem precedência sobre live se ambos presentes (mais explicit).
  if (typeof replay === "string" && replay.length > 0) {
    return { replaySessionId: replay, liveSessionId: null };
  }
  if (typeof live === "string" && live.length > 0) {
    return { replaySessionId: null, liveSessionId: live };
  }
  return { replaySessionId: null, liveSessionId: null };
}
