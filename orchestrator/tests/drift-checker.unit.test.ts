import { describe, it, expect } from "vitest";
import {
  runDriftChecks,
  DEFAULT_KIDS_DRIFT_CONFIG,
  DEFAULT_ADULTS_DRIFT_CONFIG,
  type DriftCheckerSources,
} from "../src/drift-checker.js";
import type { DeclaredObjective } from "@ascendimacy/shared";

function obj(overrides: Partial<DeclaredObjective> = {}): DeclaredObjective {
  return {
    id: "obj-1",
    persona_id: "ryo",
    declared_at: "2026-05-01T10:00:00.000Z",
    declared_in_session: "sess-1",
    target_date: "2026-06-15T23:59:59.000Z",
    statement: "aprender X",
    axis: "math:fractions",
    status: "active",
    ...overrides,
  };
}

function sources(
  active: DeclaredObjective[],
  lastEvent: Record<string, string | null> = {},
): DriftCheckerSources {
  return {
    listActiveObjectives: async () => active,
    lastEventOnAxis: async (_, axis) => lastEvent[axis] ?? null,
  };
}

describe("runDriftChecks — anniversary", () => {
  it("emite event quando target_date passou", async () => {
    const events = await runDriftChecks({
      personaId: "ryo",
      now: "2026-06-20T00:00:00.000Z",
      sources: sources([obj()], {
        "math:fractions": "2026-06-19T00:00:00.000Z",
      }),
    });
    const anniv = events.filter(
      (e) => e.type === "objective_drift_check_anniversary",
    );
    expect(anniv).toHaveLength(1);
    expect(anniv[0]!.objective_id).toBe("obj-1");
  });

  it("não emite quando target_date está no futuro", async () => {
    const events = await runDriftChecks({
      personaId: "ryo",
      now: "2026-06-01T00:00:00.000Z",
      sources: sources([obj()], {
        "math:fractions": "2026-05-31T00:00:00.000Z",
      }),
    });
    expect(
      events.filter((e) => e.type === "objective_drift_check_anniversary"),
    ).toHaveLength(0);
  });
});

describe("runDriftChecks — stagnation", () => {
  it("emite stagnation kids quando 14d+ sem evento no axis", async () => {
    const events = await runDriftChecks({
      personaId: "ryo",
      now: "2026-05-20T00:00:00.000Z",
      sources: sources([obj()], {
        "math:fractions": "2026-05-01T00:00:00.000Z", // 19 dias atrás
      }),
      config: DEFAULT_KIDS_DRIFT_CONFIG,
    });
    expect(
      events.filter((e) => e.type === "objective_drift_check_stagnation"),
    ).toHaveLength(1);
  });

  it("threshold adultos 30d não dispara em 19d", async () => {
    const events = await runDriftChecks({
      personaId: "ryo",
      now: "2026-05-20T00:00:00.000Z",
      sources: sources([obj()], {
        "math:fractions": "2026-05-01T00:00:00.000Z",
      }),
      config: DEFAULT_ADULTS_DRIFT_CONFIG,
    });
    expect(
      events.filter((e) => e.type === "objective_drift_check_stagnation"),
    ).toHaveLength(0);
  });

  it("usa declared_at quando nunca houve evento no axis", async () => {
    const events = await runDriftChecks({
      personaId: "ryo",
      now: "2026-05-20T00:00:00.000Z",
      sources: sources(
        [obj({ declared_at: "2026-05-01T00:00:00.000Z" })],
        {},
      ),
      config: DEFAULT_KIDS_DRIFT_CONFIG,
    });
    expect(
      events.filter((e) => e.type === "objective_drift_check_stagnation"),
    ).toHaveLength(1);
  });

  it("objetivos sem axis são ignorados em stagnation", async () => {
    const events = await runDriftChecks({
      personaId: "ryo",
      now: "2026-05-30T00:00:00.000Z",
      sources: sources([obj({ axis: undefined })], {}),
    });
    expect(
      events.filter((e) => e.type === "objective_drift_check_stagnation"),
    ).toHaveLength(0);
  });
});

describe("runDriftChecks — conflict", () => {
  it("emite conflict quando novo objetivo no mesmo axis de ativo", async () => {
    const existing = obj({ id: "old-1" });
    const novo = obj({ id: "new-1", statement: "outro objetivo X" });
    const events = await runDriftChecks({
      personaId: "ryo",
      now: "2026-05-26T00:00:00.000Z",
      sources: sources([existing]),
      newlyDeclaredObjective: novo,
    });
    const conflicts = events.filter(
      (e) => e.type === "objective_drift_check_conflict",
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.objective_id).toBe("old-1");
  });

  it("não emite conflict pra axis diferente", async () => {
    const existing = obj({ id: "old-1", axis: "math:fractions" });
    const novo = obj({ id: "new-1", axis: "language:jp" });
    const events = await runDriftChecks({
      personaId: "ryo",
      now: "2026-05-26T00:00:00.000Z",
      sources: sources([existing]),
      newlyDeclaredObjective: novo,
    });
    expect(
      events.filter((e) => e.type === "objective_drift_check_conflict"),
    ).toHaveLength(0);
  });

  it("não emite conflict consigo mesmo (mesmo id)", async () => {
    const same = obj({ id: "x-1" });
    const events = await runDriftChecks({
      personaId: "ryo",
      now: "2026-05-26T00:00:00.000Z",
      sources: sources([same]),
      newlyDeclaredObjective: same,
    });
    expect(
      events.filter((e) => e.type === "objective_drift_check_conflict"),
    ).toHaveLength(0);
  });
});
