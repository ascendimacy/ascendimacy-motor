import { describe, it, expect } from "vitest";
import {
  transition,
  canEmitChallenge,
  allGates,
  defaultMatrix,
  pickFocusDimension,
  caselTargetsFor,
  isStatusValue,
  isStatusMatrix,
  CANONICAL_DIMENSIONS,
  hydrateFromDb,
  persistTransition,
} from "../src/status-matrix.js";
import type {
  StatusMatrix,
  StatusMatrixEntry,
} from "../src/status-matrix.js";
import { inMemoryStatusMatrixRepo } from "../src/status-matrix-repo-memory.js";

describe("StatusValue guards", () => {
  it("accepts brejo, baia, pasto", () => {
    expect(isStatusValue("brejo")).toBe(true);
    expect(isStatusValue("baia")).toBe(true);
    expect(isStatusValue("pasto")).toBe(true);
  });
  it("rejects other strings", () => {
    expect(isStatusValue("lake")).toBe(false);
    expect(isStatusValue("")).toBe(false);
    expect(isStatusValue(null)).toBe(false);
  });
});

describe("defaultMatrix", () => {
  it("returns baia for all canonical dimensions", () => {
    const m = defaultMatrix();
    for (const dim of CANONICAL_DIMENSIONS) {
      expect(m[dim]).toBe("baia");
    }
  });
  it("isStatusMatrix accepts defaultMatrix", () => {
    expect(isStatusMatrix(defaultMatrix())).toBe(true);
  });
});

describe("transition — invariant brejo→baia→pasto", () => {
  it("first_set: undefined current accepts any target", () => {
    const r = transition(undefined, "brejo");
    expect(r.accepted).toBe(true);
    expect(r.applied).toBe("brejo");
    expect(r.reason).toBe("first_set");
  });
  it("no_op: current equals target", () => {
    const r = transition("baia", "baia");
    expect(r.accepted).toBe(true);
    expect(r.applied).toBe("baia");
  });
  it("rejects brejo → pasto (forces baia)", () => {
    const r = transition("brejo", "pasto");
    expect(r.accepted).toBe(false);
    expect(r.applied).toBe("baia");
    expect(r.reason).toMatch(/invariant_skip/);
  });
  it("rejects pasto → brejo (forces baia)", () => {
    const r = transition("pasto", "brejo");
    expect(r.accepted).toBe(false);
    expect(r.applied).toBe("baia");
  });
  it("accepts brejo → baia", () => {
    const r = transition("brejo", "baia");
    expect(r.accepted).toBe(true);
    expect(r.applied).toBe("baia");
  });
  it("accepts baia → pasto", () => {
    const r = transition("baia", "pasto");
    expect(r.accepted).toBe(true);
    expect(r.applied).toBe("pasto");
  });
  it("accepts baia → brejo (degradation allowed)", () => {
    const r = transition("baia", "brejo");
    expect(r.accepted).toBe(true);
    expect(r.applied).toBe("brejo");
  });
  it("accepts pasto → baia (stepping down)", () => {
    const r = transition("pasto", "baia");
    expect(r.accepted).toBe(true);
    expect(r.applied).toBe("baia");
  });
});

describe("canEmitChallenge", () => {
  it("allows when all baia", () => {
    const m = defaultMatrix();
    expect(canEmitChallenge(m, "cognitive_math")).toEqual({ ok: true });
  });
  it("blocks all dimensions when emotional=brejo (except emotional itself)", () => {
    const m: StatusMatrix = { ...defaultMatrix(), emotional: "brejo" };
    expect(canEmitChallenge(m, "cognitive_math").ok).toBe(false);
    expect(canEmitChallenge(m, "social_with_parent").ok).toBe(false);
    // emotional itself — blocked because brejo-in-dim rule
    expect(canEmitChallenge(m, "emotional").ok).toBe(false);
  });
  it("blocks dimension-specific brejo", () => {
    const m: StatusMatrix = { ...defaultMatrix(), cognitive_math: "brejo" };
    const r = canEmitChallenge(m, "cognitive_math");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cognitive_math/);
  });
  it("treats missing dimension as baia (ok)", () => {
    const m: StatusMatrix = {};
    expect(canEmitChallenge(m, "cognitive_novel").ok).toBe(true);
  });
});

describe("allGates", () => {
  it("emits one entry per dimension in matrix", () => {
    const m: StatusMatrix = { emotional: "baia", cognitive_math: "pasto" };
    const gates = allGates(m);
    expect(Object.keys(gates).sort()).toEqual(["cognitive_math", "emotional"]);
    expect(gates["emotional"]?.ok).toBe(true);
  });
});

describe("pickFocusDimension — priority order", () => {
  it("picks brejo over baia over pasto", () => {
    const m: StatusMatrix = {
      emotional: "pasto",
      social_with_ebrota: "brejo",
      cognitive_math: "baia",
    };
    expect(pickFocusDimension(m)).toBe("social_with_ebrota");
  });
  it("within same status, follows CANONICAL_DIMENSIONS order (emotional wins)", () => {
    const m: StatusMatrix = {
      emotional: "brejo",
      social_with_ebrota: "brejo",
      cognitive_math: "brejo",
    };
    expect(pickFocusDimension(m)).toBe("emotional");
  });
  it("social_with_ebrota comes before social_with_parent", () => {
    const m: StatusMatrix = {
      social_with_parent: "brejo",
      social_with_ebrota: "brejo",
    };
    expect(pickFocusDimension(m)).toBe("social_with_ebrota");
  });
  it("undefined for empty matrix", () => {
    expect(pickFocusDimension({})).toBeUndefined();
  });
});

describe("caselTargetsFor", () => {
  it("emotional → SA+SM", () => {
    expect(caselTargetsFor("emotional")).toEqual(["SA", "SM"]);
  });
  it("social_with_parent → SOC+REL", () => {
    expect(caselTargetsFor("social_with_parent")).toEqual(["SOC", "REL"]);
  });
  it("cognitive_<any> → DM", () => {
    expect(caselTargetsFor("cognitive_math")).toEqual(["DM"]);
    expect(caselTargetsFor("cognitive_novel_subject")).toEqual(["DM"]);
  });
  it("linguistic_<any> → REL", () => {
    expect(caselTargetsFor("linguistic_ja")).toEqual(["REL"]);
  });
  it("unknown → empty", () => {
    expect(caselTargetsFor("random")).toEqual([]);
  });
});

describe("hydrateFromDb", () => {
  it("returns empty matrix when user has no rows", async () => {
    const repo = inMemoryStatusMatrixRepo();
    const matrix = await hydrateFromDb("user-1", repo);
    expect(matrix).toEqual({});
  });

  it("populates matrix from existing rows for the requested user", async () => {
    const seed: StatusMatrixEntry[] = [
      {
        userId: "user-1",
        dimension: "emotional",
        status: "baia",
        lastTransitionAt: "2026-04-27T10:00:00Z",
      },
      {
        userId: "user-1",
        dimension: "cognitive_math",
        status: "pasto",
        lastTransitionAt: "2026-04-27T10:00:00Z",
      },
      {
        userId: "user-2",
        dimension: "emotional",
        status: "brejo",
        lastTransitionAt: "2026-04-27T10:00:00Z",
      },
    ];
    const repo = inMemoryStatusMatrixRepo(seed);
    const matrix = await hydrateFromDb("user-1", repo);
    expect(matrix.emotional).toBe("baia");
    expect(matrix.cognitive_math).toBe("pasto");
    expect(Object.keys(matrix)).toHaveLength(2);
  });

  it("isolates users — does not leak rows from other users", async () => {
    const repo = inMemoryStatusMatrixRepo([
      {
        userId: "user-2",
        dimension: "emotional",
        status: "brejo",
        lastTransitionAt: "2026-04-27T10:00:00Z",
      },
    ]);
    const matrix = await hydrateFromDb("user-1", repo);
    expect(matrix).toEqual({});
  });
});

describe("persistTransition", () => {
  const fixedNow = "2026-04-27T12:00:00Z";

  it("upserts new entry on first transition (first_set)", async () => {
    const repo = inMemoryStatusMatrixRepo();
    const result = await persistTransition(
      "user-1",
      "emotional",
      "baia",
      repo,
      { now: () => fixedNow },
    );
    expect(result.accepted).toBe(true);
    expect(result.applied).toBe("baia");
    expect(result.reason).toBe("first_set");

    const matrix = await hydrateFromDb("user-1", repo);
    expect(matrix.emotional).toBe("baia");
  });

  it("rejects brejo → pasto direct, persists baia (invariant)", async () => {
    const repo = inMemoryStatusMatrixRepo([
      {
        userId: "user-1",
        dimension: "emotional",
        status: "brejo",
        lastTransitionAt: "2026-04-27T10:00:00Z",
      },
    ]);
    const result = await persistTransition(
      "user-1",
      "emotional",
      "pasto",
      repo,
    );
    expect(result.accepted).toBe(false);
    expect(result.applied).toBe("baia");
    expect(result.reason).toMatch(/invariant_skip/);

    const matrix = await hydrateFromDb("user-1", repo);
    expect(matrix.emotional).toBe("baia");
  });

  it("updates lastTransitionAt on each persist", async () => {
    const repo = inMemoryStatusMatrixRepo();
    await persistTransition("user-1", "emotional", "baia", repo, {
      now: () => "2026-04-27T10:00:00Z",
    });
    await persistTransition("user-1", "emotional", "pasto", repo, {
      now: () => "2026-04-27T11:30:00Z",
    });
    const rows = await repo.loadAll("user-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pasto");
    expect(rows[0]?.lastTransitionAt).toBe("2026-04-27T11:30:00Z");
  });

  it("idempotent on no-op (current === target)", async () => {
    const repo = inMemoryStatusMatrixRepo([
      {
        userId: "user-1",
        dimension: "emotional",
        status: "baia",
        lastTransitionAt: "2026-04-27T10:00:00Z",
      },
    ]);
    const result = await persistTransition(
      "user-1",
      "emotional",
      "baia",
      repo,
    );
    expect(result.accepted).toBe(true);
    expect(result.reason).toBe("no_op");
  });

  it("persists multiple dimensions independently", async () => {
    const repo = inMemoryStatusMatrixRepo();
    await persistTransition("user-1", "emotional", "baia", repo);
    await persistTransition("user-1", "cognitive_math", "pasto", repo);
    const matrix = await hydrateFromDb("user-1", repo);
    expect(matrix.emotional).toBe("baia");
    expect(matrix.cognitive_math).toBe("pasto");
  });
});
