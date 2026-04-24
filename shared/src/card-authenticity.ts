/**
 * Card authenticity — HMAC-SHA256 signature + QR payload builder.
 *
 * Spec: Handoff #17 Bloco 5a (c).
 *
 * Formato:
 *   payload = `{card_id}:{child_id}:{issued_at}`
 *   signature = HMAC-SHA256(payload, secret)
 *   qr_url = `https://ebrota.app/v/{card_id}?sig={signature}`
 *
 * Secret lido da env `EBROTA_CARD_SECRET` no caller; este módulo só faz
 * crypto pura (testável sem env). Nunca logar o secret.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const QR_BASE_URL = "https://ebrota.app/v";

export interface SignPayloadInput {
  card_id: string;
  child_id: string;
  issued_at: string;
  secret: string;
}

/** Monta string canônica pra assinar. Formato é contrato — não mudar sem bump de versão. */
export function buildCanonicalPayload(input: Omit<SignPayloadInput, "secret">): string {
  return `${input.card_id}:${input.child_id}:${input.issued_at}`;
}

/** Gera HMAC-SHA256 hex do payload canônico. */
export function signCardPayload(input: SignPayloadInput): string {
  if (!input.secret || input.secret.length < 8) {
    throw new Error("signCardPayload: secret too short (min 8 chars)");
  }
  const canonical = buildCanonicalPayload(input);
  return createHmac("sha256", input.secret).update(canonical).digest("hex");
}

export interface VerifyInput extends SignPayloadInput {
  signature: string;
}

/** Compara assinaturas em tempo constante pra evitar timing attack. */
export function verifyCardSignature(input: VerifyInput): boolean {
  try {
    const expected = signCardPayload(input);
    if (expected.length !== input.signature.length) return false;
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(input.signature, "hex"));
  } catch {
    return false;
  }
}

/** URL completa com sig query-string. Idempotente. */
export function buildQrPayload(cardId: string, signature: string): string {
  const encoded = encodeURIComponent(cardId);
  return `${QR_BASE_URL}/${encoded}?sig=${signature}`;
}
