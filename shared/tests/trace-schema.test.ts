import { describe, it, expect } from "vitest";
import { createSessionTrace } from "../src/trace-schema.js";

describe("createSessionTrace", () => {
  it("creates valid trace with empty turns", () => {
    const trace = createSessionTrace("session-001", "paula");
    expect(trace.sessionId).toBe("session-001");
    expect(trace.persona).toBe("paula");
    expect(trace.turns).toHaveLength(0);
    expect(trace.meta.schemaVersion).toBe("1.0");
  });
});
