import { describe, it, expect } from "vitest";
import { initTrace, appendTurn, saveTrace } from "../src/trace-writer.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("trace-writer", () => {
  it("creates and saves a trace", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "motor-test-"));
    try {
      const trace = initTrace("sess-001", "paula-mendes");
      expect(trace.sessionId).toBe("sess-001");
      expect(trace.persona).toBe("paula-mendes");
      expect(trace.turns).toHaveLength(0);

      appendTurn(trace, {
        turnNumber: 0,
        sessionId: "sess-001",
        incomingMessage: "oi",
        entries: [],
        finalResponse: "Olá!",
      });

      expect(trace.turns).toHaveLength(1);
      const path = saveTrace(trace, tmpDir);
      expect(path).toContain("trace.json");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
