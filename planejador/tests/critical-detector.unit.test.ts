/**
 * S3 (ops#1145) — detectCritical: 8 trigger scenarios + 3 normal scenarios.
 */

import { describe, it, expect } from "vitest";
import { detectCritical } from "../src/critical-detector.js";

describe("detectCritical — cenários críticos (is_critical=true)", () => {
  it("distress: distress_marker_high → reason=distress", () => {
    const r = detectCritical(["distress_marker_high"]);
    expect(r.is_critical).toBe(true);
    expect(r.critical_reason).toBe("distress");
  });

  it("exit: exit_marker_explicit → reason=exit", () => {
    const r = detectCritical(["exit_marker_explicit"]);
    expect(r.is_critical).toBe(true);
    expect(r.critical_reason).toBe("exit");
  });

  it("sacrifice_rejection: sacrifice_rejection → reason=sacrifice_rejection", () => {
    const r = detectCritical(["sacrifice_rejection"]);
    expect(r.is_critical).toBe(true);
    expect(r.critical_reason).toBe("sacrifice_rejection");
  });

  it("harm_self: harm_self → reason=harm_self", () => {
    const r = detectCritical(["harm_self"]);
    expect(r.is_critical).toBe(true);
    expect(r.critical_reason).toBe("harm_self");
  });

  it("harm_other: harm_other → reason=harm_other", () => {
    const r = detectCritical(["harm_other"]);
    expect(r.is_critical).toBe(true);
    expect(r.critical_reason).toBe("harm_other");
  });

  it("freeze: freeze → reason=freeze", () => {
    const r = detectCritical(["freeze"]);
    expect(r.is_critical).toBe(true);
    expect(r.critical_reason).toBe("freeze");
  });

  it("dissociation: dissociation → reason=dissociation", () => {
    const r = detectCritical(["dissociation"]);
    expect(r.is_critical).toBe(true);
    expect(r.critical_reason).toBe("dissociation");
  });

  it("shutdown: shutdown → reason=shutdown", () => {
    const r = detectCritical(["shutdown"]);
    expect(r.is_critical).toBe(true);
    expect(r.critical_reason).toBe("shutdown");
  });
});

describe("detectCritical — cenários normais (is_critical=false)", () => {
  it("signals vazio → is_critical=false, sem critical_reason", () => {
    const r = detectCritical([]);
    expect(r.is_critical).toBe(false);
    expect(r.critical_reason).toBeUndefined();
  });

  it("signals de deflection não-crítica → is_critical=false", () => {
    const r = detectCritical(["deflection_thematic", "exit_marker_implicit_soft"]);
    expect(r.is_critical).toBe(false);
    expect(r.critical_reason).toBeUndefined();
  });

  it("signals positivos → is_critical=false", () => {
    const r = detectCritical([
      "philosophical_self_acceptance",
      "voluntary_topic_deepening",
      "mood_drift_up",
    ]);
    expect(r.is_critical).toBe(false);
    expect(r.critical_reason).toBeUndefined();
  });
});

describe("detectCritical — variantes de sinal", () => {
  it("exit_marker_implicit também mapeia para exit", () => {
    const r = detectCritical(["exit_marker_implicit"]);
    expect(r.is_critical).toBe(true);
    expect(r.critical_reason).toBe("exit");
  });

  it("harm_self_ideation também mapeia para harm_self", () => {
    const r = detectCritical(["harm_self_ideation"]);
    expect(r.is_critical).toBe(true);
    expect(r.critical_reason).toBe("harm_self");
  });

  it("harm_other_ideation também mapeia para harm_other", () => {
    const r = detectCritical(["harm_other_ideation"]);
    expect(r.is_critical).toBe(true);
    expect(r.critical_reason).toBe("harm_other");
  });

  it("retorna a primeira razão crítica quando múltiplos signals presentes", () => {
    const r = detectCritical(["distress_marker_high", "harm_self"]);
    expect(r.is_critical).toBe(true);
    // first match wins
    expect(r.critical_reason).toBe("distress");
  });
});
