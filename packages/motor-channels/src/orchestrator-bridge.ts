/**
 * Bridge motor-channels ↔ orchestrator — S-MX-06-07 (ops#1115).
 *
 * Shim que conecta:
 *  1. inbound do canal → `routeInbound` (PR2) → `CardActivated`
 *  2. `CardActivated` → `loader.load(cardId)` (PR3) → `CardPackage` ou
 *     `cardNotFoundMessage` de fallback
 *  3. bridge.startCardSession(pkg) → resposta textual
 *  4. resposta → `channel.send` (PR4) sob rate limit
 *
 * `OrchestratorBridge` é a interface que o orchestrator real (capability
 * separada, PR6b skeleton) implementa. Para testes, usa-se um mock.
 */

import { routeInbound } from "./router.js";
import { createTokenBucket, type RateLimiter } from "./rate-limit.js";
import type { CardPackageLoader } from "./cards-loader.js";
import type { WhatsAppChannel, Unsubscribe } from "./channel.js";
import type {
  CardActivatedEvent,
  CardId,
  CardPackage,
  ChannelAddress,
  ConversationId,
  InboundMessage,
} from "./types.js";

export interface StartCardSessionInput {
  cardId: CardId;
  conversationId: ConversationId;
  from: ChannelAddress;
  pkg: CardPackage;
}

export interface StartCardSessionOutput {
  /** Texto a enviar de volta pelo canal. */
  text: string;
}

export interface OrchestratorBridge {
  /** Chamado quando o detector dispara `CardActivated`. Implementação real
   *  (futura PR motor-orchestrator) faz route pra motor-drota com contexto
   *  enriquecido pelo pacote. PR6 só define a forma. */
  startCardSession(
    input: StartCardSessionInput,
  ): Promise<StartCardSessionOutput>;
}

/**
 * ApprovalGate — C-MX-07 S-OD-10 (PR6). Hook opcional entre
 * `bridge.startCardSession` (que devolve proposedText) e `channel.send`.
 * Em semi-auto mode, operador (Jun via eBrota Console) decide via UI:
 *  - `approved: true` + sem editedText → envia proposedText original
 *  - `approved: true` + editedText → envia o texto editado
 *  - `approved: false` → aborta, NÃO envia outbound
 *
 * `resolver` é injetado pelo caller (BFF do eBrota Console em produção,
 * mock em testes). Pattern Promise-based — caller pode amarrar a um
 * MCP tool do orchestrator daemon (`approve_or_edit`), a SSE event do
 * próprio BFF, ou auto-approve em modo headless/testes.
 */
export interface ApprovalGateInput {
  /** Texto materializado pelo motor-drota. */
  proposedText: string;
  /** Contexto da carta — UI usa pra renderizar header da pendência. */
  cardId: CardId;
  conversationId: ConversationId;
  from: ChannelAddress;
}

export interface ApprovalDecision {
  /** True envia; false aborta sem channel.send. */
  approved: boolean;
  /** Substitui proposedText se presente. */
  editedText?: string;
  /** Comentário freeform do operador pra Edit Learner v0 (DS-04). */
  rationale?: string;
}

export interface ApprovalGate {
  /** Resolve com decisão do operador. Timeout/fail-safe fica a cargo
   *  do resolver (caller); bridge só await. */
  resolver: (input: ApprovalGateInput) => Promise<ApprovalDecision>;
}

export interface InboundBridgeOptions {
  channel: WhatsAppChannel;
  loader: CardPackageLoader;
  bridge: OrchestratorBridge;
  /** Default: token bucket 1 msg/sec, burst 3. Override pra testes ou
   *  configs prod via env. */
  rateLimit?: RateLimiter;
  /** Mensagem enviada quando o cardId é válido (detector casou) mas o
   *  pacote pedagógico não está disponível no loader. Default em pt-br.
   *  Futura PR pode mover essa decisão pro orchestrator. */
  cardNotFoundMessage?: string;
  /** Hook opcional pra erros surgindo de bridge.startCardSession ou
   *  channel.send. Default loga via console.error. */
  onError?: (err: unknown, context: { event: CardActivatedEvent }) => void;
  /** Gate de aprovação semi-auto (C-MX-07 S-OD-10). Quando undefined,
   *  bridge funciona em auto mode (envia direto). Quando set, await
   *  resolver antes de channel.send — operador decide via eBrota
   *  Console. */
  approvalGate?: ApprovalGate;
}

export interface InboundBridge {
  /** Subscreve a canal.onMessage. Idempotente — chamadas extras são no-op. */
  start(): void;
  /** Cancela subscription. Idempotente. */
  stop(): void;
}

const DEFAULT_CARD_NOT_FOUND = "Carta não encontrada.";

export function createInboundBridge(
  opts: InboundBridgeOptions,
): InboundBridge {
  const rateLimit =
    opts.rateLimit ?? createTokenBucket({ tokensPerSec: 1, burst: 3 });
  const fallback = opts.cardNotFoundMessage ?? DEFAULT_CARD_NOT_FOUND;
  const onError =
    opts.onError ??
    ((err) => {
      console.error("[motor-channels] inbound bridge error:", err);
    });

  let unsubscribe: Unsubscribe | null = null;

  const handleInbound = (msg: InboundMessage): void => {
    const events = routeInbound(msg);
    for (const ev of events) {
      if (ev.type !== "CardActivated") continue;
      // fire-and-forget — handler de canal é sync, e queremos drenar todas
      // as cartas sem bloquear o stream. Erros vão pro onError.
      void processCardActivated(ev);
    }
  };

  const processCardActivated = async (
    ev: CardActivatedEvent,
  ): Promise<void> => {
    try {
      const pkg = await opts.loader.load(ev.cardId);
      let responseText: string;
      let cameFromBridge = false;
      if (pkg === null) {
        responseText = fallback;
      } else {
        const result = await opts.bridge.startCardSession({
          cardId: ev.cardId,
          conversationId: ev.conversationId,
          from: ev.from,
          pkg,
        });
        responseText = result.text;
        cameFromBridge = true;
      }

      // Approval gate (S-OD-10) — só aplica em resposta vinda do bridge.
      // cardNotFoundMessage (pkg=null) pula gate: é mensagem de sistema,
      // não precisa aprovação.
      if (cameFromBridge && opts.approvalGate !== undefined) {
        const decision = await opts.approvalGate.resolver({
          proposedText: responseText,
          cardId: ev.cardId,
          conversationId: ev.conversationId,
          from: ev.from,
        });
        if (!decision.approved) {
          // Operador rejeitou — não envia outbound. Termina silenciosamente;
          // BFF pode logar a decisão pra telemetry Edit Learner separado.
          return;
        }
        if (decision.editedText !== undefined) {
          responseText = decision.editedText;
        }
      }

      await rateLimit.acquire();
      await opts.channel.send(ev.from, responseText);
    } catch (err) {
      onError(err, { event: ev });
    }
  };

  return {
    start(): void {
      if (unsubscribe !== null) return;
      unsubscribe = opts.channel.onMessage(handleInbound);
    },
    stop(): void {
      if (unsubscribe === null) return;
      unsubscribe();
      unsubscribe = null;
    },
  };
}
