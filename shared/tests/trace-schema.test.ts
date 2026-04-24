import { describe, it, expect } from "vitest";
import { createSessionTrace, TRACE_SCHEMA_VERSION } from "../src/trace-schema.js";

describe("createSessionTrace", () => {
  it("creates valid trace with empty turns", () => {
    const trace = createSessionTrace("session-001", "paula");
    expect(trace.sessionId).toBe("session-001");
    expect(trace.persona).toBe("paula");
    expect(trace.turns).toHaveLength(0);
    expect(trace.meta.schemaVersion).toBe(TRACE_SCHEMA_VERSION);
  });

  it("schema version is bumped to 0.3.0 (Bloco 3)", () => {
    expect(TRACE_SCHEMA_VERSION).toBe("0.3.0");
  });

  it("accepts optional personaAge", () => {
    const trace = createSessionTrace("s1", "ryo", 13);
    expect(trace.personaAge).toBe(13);
  });

  it("personaAge undefined when not provided", () => {
    const trace = createSessionTrace("s1", "ryo");
    expect(trace.personaAge).toBeUndefined();
  });
});
