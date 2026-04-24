import { describe, it, expect } from "vitest";
import {
  signCardPayload,
  verifyCardSignature,
  buildQrPayload,
  buildCanonicalPayload,
  QR_BASE_URL,
} from "../src/card-authenticity.js";

const secret = "test-secret-at-least-8-chars";

describe("buildCanonicalPayload", () => {
  it("joins fields com ':'", () => {
    const p = buildCanonicalPayload({
      card_id: "abc",
      child_id: "ryo",
      issued_at: "2026-04-24T00:00:00Z",
    });
    expect(p).toBe("abc:ryo:2026-04-24T00:00:00Z");
  });
});

describe("signCardPayload", () => {
  it("produces deterministic hex signature", () => {
    const sig1 = signCardPayload({
      card_id: "abc",
      child_id: "ryo",
      issued_at: "2026-04-24T00:00:00Z",
      secret,
    });
    const sig2 = signCardPayload({
      card_id: "abc",
      child_id: "ryo",
      issued_at: "2026-04-24T00:00:00Z",
      secret,
    });
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different secret → different signature", () => {
    const s1 = signCardPayload({ card_id: "a", child_id: "b", issued_at: "c", secret: "seeeecret1" });
    const s2 = signCardPayload({ card_id: "a", child_id: "b", issued_at: "c", secret: "seeeecret2" });
    expect(s1).not.toBe(s2);
  });

  it("throws when secret too short", () => {
    expect(() =>
      signCardPayload({ card_id: "a", child_id: "b", issued_at: "c", secret: "short" }),
    ).toThrow(/secret too short/);
  });
});

describe("verifyCardSignature", () => {
  it("verifies own signature", () => {
    const sig = signCardPayload({ card_id: "a", child_id: "b", issued_at: "c", secret });
    expect(
      verifyCardSignature({ card_id: "a", child_id: "b", issued_at: "c", secret, signature: sig }),
    ).toBe(true);
  });

  it("rejects tampered card_id", () => {
    const sig = signCardPayload({ card_id: "a", child_id: "b", issued_at: "c", secret });
    expect(
      verifyCardSignature({ card_id: "x", child_id: "b", issued_at: "c", secret, signature: sig }),
    ).toBe(false);
  });

  it("rejects tampered signature", () => {
    const sig = signCardPayload({ card_id: "a", child_id: "b", issued_at: "c", secret });
    const tampered = sig.slice(0, -2) + "00";
    expect(
      verifyCardSignature({ card_id: "a", child_id: "b", issued_at: "c", secret, signature: tampered }),
    ).toBe(false);
  });

  it("rejects different secret", () => {
    const sig = signCardPayload({ card_id: "a", child_id: "b", issued_at: "c", secret });
    expect(
      verifyCardSignature({
        card_id: "a", child_id: "b", issued_at: "c",
        secret: "other-seeeecret",
        signature: sig,
      }),
    ).toBe(false);
  });

  it("malformed signature hex returns false (no throw)", () => {
    expect(
      verifyCardSignature({
        card_id: "a", child_id: "b", issued_at: "c", secret,
        signature: "not-hex",
      }),
    ).toBe(false);
  });
});

describe("buildQrPayload", () => {
  it("builds URL with card_id + sig query", () => {
    const url = buildQrPayload("abc-123", "deadbeef");
    expect(url).toBe(`${QR_BASE_URL}/abc-123?sig=deadbeef`);
  });

  it("url-encodes card_id", () => {
    const url = buildQrPayload("id with spaces", "xyz");
    expect(url).toContain("id%20with%20spaces");
  });
});
