/**
 * Helper pra montar URL do visualizer (eBrota Console) — C-MX-08
 * S-OC-20/21 (Fase F).
 *
 * Convenção ratificada Q15 (memory feedback): smoke runs imprimem
 * link clicável no output. Format:
 *   http://<host>:<bff-port>/replay/<traceId>   ← pós-mortem
 *   http://<host>:<bff-port>/live/<sessionId>   ← sessão ativa
 *
 * BFF tem rotas que redirecionam pro UI dev server ou servem o build
 * estático (PR9+). Pure helper — caller (Baileys smoke, STS, etc.)
 * usa standalone sem dep de Fastify/runtime.
 */

export type VisualizerKind = "live" | "replay";

export interface VisualizerUrlOptions {
  /** Default 'localhost' — caller pode override pra deploy. */
  host?: string;
  /** Default 3737 (D-OC-02). */
  port?: number;
  /** Default 'http'. */
  protocol?: "http" | "https";
}

/**
 * Monta URL canônica do visualizer. Sem side-effects, sem fetch.
 * Caller imprime no output do script smoke.
 */
export function formatVisualizerUrl(
  kind: VisualizerKind,
  id: string,
  opts: VisualizerUrlOptions = {},
): string {
  const host = opts.host ?? "localhost";
  const port = opts.port ?? 3737;
  const protocol = opts.protocol ?? "http";
  const encodedId = encodeURIComponent(id);
  return `${protocol}://${host}:${port}/${kind}/${encodedId}`;
}

/**
 * Helper de print pra scripts smoke. Loga em stderr (stdout reservado
 * pra JSON-RPC quando relevante). Inclui hint sobre BFF offline.
 *
 * Exemplo de output:
 *   [smoke] → visualizer (live): http://localhost:3737/live/yuji__conv-1
 *   [smoke]   (se BFF não estiver rodando, abra o link após:
 *              npm run start --workspace packages/ebrota-console-bff)
 */
export function printVisualizerLink(
  kind: VisualizerKind,
  id: string,
  opts: VisualizerUrlOptions & {
    /** Prefixo de log (ex: "[smoke]"). Default vazio. */
    prefix?: string;
    /** Custom writer (default process.stderr.write). */
    write?: (msg: string) => void;
  } = {},
): string {
  const url = formatVisualizerUrl(kind, id, opts);
  const prefix = opts.prefix ?? "";
  const write = opts.write ?? ((m: string) => process.stderr.write(m));
  const label = kind === "live" ? "live" : "replay";
  write(`${prefix}→ visualizer (${label}): ${url}\n`);
  write(
    `${prefix}  (se BFF não estiver rodando: ` +
      `npm run start --workspace packages/ebrota-console-bff)\n`,
  );
  return url;
}
