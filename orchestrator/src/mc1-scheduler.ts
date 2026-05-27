/**
 * MC1 scheduler — entrega da primeira mensagem do Brota.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-19-mc1-primeira-mensagem-brota-jp.md
 * Wiring: temporal-scheduler tick → checkAndDeliverMC1 antes dos 4
 * triggers regulares B1. MC1 ganha prioridade absoluta dentro da janela.
 *
 * Pure-functional: dependências injetadas via `Mc1SchedulerDeps`.
 * Caller (BFF / orchestrator daemon) constrói deps com SQLite-backed
 * funções de `motor-execucao/mc1-repo`. Testes usam in-memory db ou
 * stubs.
 *
 * v0 entrega:
 *   1. markDelivered no repo (status → delivered, delivered_at = now)
 *   2. dispara `emitDelivery({ kind: "mc1_delivered", ... })` —
 *      caller persiste como ContentItem `pulse:mc1_delivered` e/ou
 *      event_log entry conforme política.
 *
 * v1 plug-points (NÃO implementados v0):
 *   - motor-channels handoff (WhatsApp real)
 *   - retry on delivery failure
 *   - push notification ao parent confirmando entrega
 */

export interface Mc1PendingRecord {
  id: number;
  personaId: string;
  approvedText: string;
  targetWindowName: string;
  scheduledAt: string;
}

export interface Mc1DeliveryEvent {
  kind: "mc1_delivered";
  /** PK em mc1_scheduled. Idempotency hint. */
  mc1ScheduledId: number;
  personaId: string;
  windowName: string;
  text: string;
  deliveredAt: string;
}

export interface Mc1SchedulerDeps {
  /** Wall clock (injetável p/ testes). */
  now(): Date;
  /** Lookup do próximo pendente da persona; null se nada pra entregar. */
  nextPending(personaId: string): Mc1PendingRecord | null;
  /** Marca como entregue. Retorna true se transitou pending→delivered. */
  markDelivered(id: number, deliveredAt: string): boolean;
  /** Sink: caller decide se vai pra event_log, ContentItem, WhatsApp etc. */
  emitDelivery(event: Mc1DeliveryEvent): void;
}

export interface Mc1CheckResult {
  /** true se tinha MC1 pendente E foi marcada delivered. */
  delivered: boolean;
  /** Quando delivered=true, o event emitido. */
  event?: Mc1DeliveryEvent;
}

/**
 * Tenta entregar a próxima MC1 pending da persona. Idempotente:
 * se nada pending, retorna `{ delivered: false }`. Caller é
 * responsável por já ter validado janela aberta + gates parentais.
 *
 * Race-safe contra concorrência via `markDelivered` que só transita
 * de `pending`; caller paralelo perde a corrida graciosamente.
 */
export function checkAndDeliverMC1(
  deps: Mc1SchedulerDeps,
  personaId: string,
): Mc1CheckResult {
  const pending = deps.nextPending(personaId);
  if (!pending) return { delivered: false };

  const deliveredAt = deps.now().toISOString();
  const ok = deps.markDelivered(pending.id, deliveredAt);
  if (!ok) {
    // Outro tick venceu a corrida (delivered ou cancelled enquanto isso).
    return { delivered: false };
  }
  const event: Mc1DeliveryEvent = {
    kind: "mc1_delivered",
    mc1ScheduledId: pending.id,
    personaId: pending.personaId,
    windowName: pending.targetWindowName,
    text: pending.approvedText,
    deliveredAt,
  };
  deps.emitDelivery(event);
  return { delivered: true, event };
}
